# Fabric notebook source

# METADATA ********************

# META {
# META   "kernel_info": {
# META     "name": "synapse_pyspark"
# META   },
# META   "dependencies": {}
# META }

# MARKDOWN ********************

# # Compute the latest week's book signals
# Run after SeedBooks, and again whenever weekly data is added. It reads the
# Books lakehouse in this notebook's current workspace and recomputes, for the
# latest week in dbo.weekly_sales only, three derived tables with fixed rules:
# title_signals, decision_options and title_performance. Each run replaces those
# tables' rows with the same rows for the same data; source tables are only read.
# Every amount, ratio and recommendation comes from these rules, never from a model.

# PARAMETERS CELL ********************

lakehouse_name = "Books"

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

from uuid import UUID

import notebookutils
from delta.tables import DeltaTable
from pyspark.sql import SparkSession

workspace_id = str(UUID(notebookutils.runtime.context["currentWorkspaceId"]))
if not isinstance(lakehouse_name, str) or not lakehouse_name.strip():
    raise ValueError("lakehouse_name must name a lakehouse in the current workspace.")

lakehouse = notebookutils.lakehouse.get(lakehouse_name, workspace_id)
if str(UUID(lakehouse.workspaceId)) != workspace_id:
    raise ValueError("Refusing to read or write a lakehouse outside the current workspace.")

lakehouse_id = str(UUID(lakehouse.id))
lakehouse_path = (
    f"abfss://{workspace_id}@onelake.dfs.fabric.microsoft.com/{lakehouse_id}"
)
spark = SparkSession.builder.getOrCreate()

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

from datetime import timedelta

# The governed thresholds. The scenario's reprint and marketing policy documents must state the same values.
TARGET_COVER_DAYS = 28            # Cover a reprint should leave after it lands.
MATERIAL_AT_RISK_GBP = 100000     # Inventory risk becomes material at this net revenue at risk.
UPSIDE_RATIO, MATERIAL_UPSIDE_RATIO = 1.5, 2.0        # Four-week units over forecast.
DOWNSIDE_RATIO, MATERIAL_DOWNSIDE_RATIO = 0.7, 0.6
MOMENTUM_CHANGE, MATERIAL_MOMENTUM_CHANGE = 0.5, 1.0  # Search interest, last two weeks over the eight before.
MOMENTUM_MENTIONS = 5             # Media mentions in four weeks.
MARKETING_RATIO = 1.3             # A marketing opportunity also needs this four-week variance.
EXCESS_COVER_DAYS = 120           # Stock beyond this cover, with a downside variance, is excess.
MATERIAL_EXCESS_GBP = 20000       # Excess becomes material at this print cost, with a reprint on order.
TRANSFER_DAYS, TRANSFER_COST_GBP = 7, 0.30            # Moving stock between territories.
MARKETING_SHARE, MARKETING_FLOOR_GBP, MARKETING_CAP_GBP = 0.10, 5000, 25000  # Of four-week net revenue.
MARKETING_RETURN = 2.0            # Planning assumption: net revenue per pound of marketing.
PRINT_FORMATS = ("Hardback", "Paperback")
TERRITORIES = ("UK", "US", "ANZ")


def rounded(value):
    """Half away from zero, unlike round()'s half to even."""
    return int(value + 0.5) if value >= 0 else -int(-value + 0.5)


def round_up(units, step):
    return -(-units // step) * step


# A ratio of exactly 0.0 is a real value, not a missing one, so thresholds never test truthiness.
def at_least(value, limit):
    return value is not None and value >= limit


def at_most(value, limit):
    return value is not None and value <= limit


def compute(tables):
    """The latest week's title_signals, decision_options and title_performance rows, from the raw rows alone."""
    titles = {row["title_id"]: row for row in tables["titles"]}
    editions = {row["edition_id"]: row for row in tables["editions"]}
    weeks = sorted({row["week_start"] for row in tables["weekly_sales"]})
    if len(weeks) < 10:
        raise ValueError("ComputeBookSignals needs at least ten weeks of weekly_sales; run SeedBooks first.")
    at = {week: index for index, week in enumerate(weeks)}
    end, as_of = len(weeks) - 1, weeks[-1]

    title_sold, title_plan, edition_sold, edition_plan, variance_by_place, mix, revenue = ({} for _ in range(7))

    def add(store, key, value):
        store[key] = store.get(key, 0) + value

    for row in tables["weekly_sales"]:
        edition, week = editions[row["edition_id"]], at[row["week_start"]]
        title_id = edition["title_id"]
        add(title_sold, (title_id, week), row["units"])
        add(title_plan, (title_id, week), row["forecast_units"])
        add(edition_sold, (row["edition_id"], row["territory"], week), row["units"])
        add(edition_plan, (row["edition_id"], row["territory"], week), row["forecast_units"])
        add(variance_by_place, (title_id, row["territory"], row["channel"], week), row["units"] - row["forecast_units"])
        for kind, value in (("territory", row["territory"]), ("channel", row["channel"]),
                            ("format", edition["format"])):
            add(mix, (title_id, kind, value, week), row["units"])
        add(revenue, (title_id, week), row["units"] * edition["net_price_gbp"])
    stock = {(row["edition_id"], row["territory"], at[row["week_start"]]): row
             for row in tables["inventory_weekly"] if row["week_start"] in at}
    public = {(row["title_id"], at[row["week_start"]]): row
              for row in tables["public_momentum"] if row["week_start"] in at}
    live = {}
    for row in tables["campaigns"]:
        if row["start_date"] <= as_of + timedelta(days=6) and row["end_date"] >= as_of:
            live.setdefault(row["title_id"], []).append(row["campaign_name"])
    approved = {}
    for row in tables["reprint_requests"]:
        if row["approved_at"] is not None:
            day = row["approved_at"].date() if hasattr(row["approved_at"], "date") else row["approved_at"]
            key = (row["edition_id"], row["territory"])
            approved[key] = max(approved.get(key, day), day)

    def total(store, key, last, size):
        return sum(store.get(key + (week,), 0) for week in range(max(0, last - size + 1), last + 1))

    def variance(title_id, last):
        plan = total(title_plan, (title_id,), last, 4)
        return total(title_sold, (title_id,), last, 4) / plan if plan else None

    def inventory(edition_id, territory, last):
        """Cover, gap and net revenue at risk for one print edition in one territory at the end of week `last`."""
        edition, row = editions[edition_id], stock.get((edition_id, territory, last))
        if row is None:
            return None
        daily = total(edition_sold, (edition_id, territory), last, 2) / 14
        if daily <= 0 or row["on_hand_units"] <= 0:
            # Sold out: sales understate demand, so the forecast's rate stands in.
            daily = max(daily, total(edition_plan, (edition_id, territory), last, 2) / 14)
        if daily <= 0:
            return None
        lead = edition["reprint_lead_time_days"]
        arrival = row["next_arrival_week"]
        arriving = row["on_order_units"] if (
            arrival is not None and (arrival - (weeks[last] + timedelta(days=7))).days < lead) else 0
        effective = (row["on_hand_units"] + arriving) / daily
        gap = max(0.0, lead - effective)
        return {"daily": daily, "on_hand": row["on_hand_units"], "on_order": row["on_order_units"],
                "cover": row["on_hand_units"] / daily, "effective": effective, "gap": gap,
                "at_risk": rounded(daily * gap * edition["net_price_gbp"]),
                "total_cover": (row["on_hand_units"] + row["on_order_units"]) / daily}

    def momentum(title_id, last):
        """Search interest in the last two weeks over the eight before them, minus one, and four weeks' mentions."""
        recent = [public[(title_id, week)]["search_index"] for week in (last - 1, last) if (title_id, week) in public]
        prior = [public[(title_id, week)]["search_index"] for week in range(last - 9, last - 1)
                 if (title_id, week) in public]
        mentions = sum(public[(title_id, week)]["media_mentions"] for week in range(last - 3, last + 1)
                       if (title_id, week) in public)
        if len(recent) < 2 or not prior or not sum(prior):
            return None, mentions
        return sum(recent) / 2 / (sum(prior) / len(prior)) - 1, mentions

    def since(holds):
        """The first week of the unbroken run of weeks, ending with the latest, in which `holds(week)` is true."""
        if not holds(end):
            return None
        week = end
        while week > 0 and holds(week - 1):
            week -= 1
        return weeks[week]

    signals, options = [], []

    def signal(title_id, code, kind, headline, detected, material, confidence, recommended=None, **fields):
        title = titles[title_id]
        place = fields.get("territory")
        signal_id = f"sig-{as_of:%Y%m%d}-{title_id}-{code}" + (f"-{fields['edition_id']}-{place.lower()}"
                                                                if place else "")
        first = since(detected)
        row = {"signal_id": signal_id, "title_id": title_id, "title_name": title["title_name"],
               "author_name": title["author_name"], "signal_type": kind, "edition_id": None, "format": None,
               "territory": None, "as_of_week": as_of, "first_detected_week": first,
               "material_since_week": since(material), "headline": headline, "actual_vs_forecast": None,
               "units_last_4w": None, "forecast_last_4w": None, "stock_on_hand": None, "stock_on_order": None,
               "stock_cover_days": None, "reprint_lead_time_days": None, "opportunity_at_risk_gbp": None,
               "excess_exposure_gbp": None, "driver_territory": None, "driver_channels": None,
               "search_momentum_change_pct": None, "media_mentions_4w": None, "confidence": confidence,
               "is_material": "Yes" if material(end) else "No", "status": "Open",
               "recommended_option": recommended}
        row.update(fields)
        # An approved reprint request for the edition and territory, since the risk began, actions an inventory risk.
        if code == "inv" and approved.get((fields["edition_id"], place), as_of - timedelta(days=36500)) >= first:
            row["status"] = "Actioned"
        signals.append(row)
        return row

    def option(source, code, name, recommended, assumption, risk, **fields):
        row = {"option_id": f"{source['signal_id']}-{code}", "signal_id": source["signal_id"],
               "title_id": source["title_id"], "title_name": source["title_name"],
               "edition_id": source["edition_id"], "territory": source["territory"], "option_name": name,
               "is_recommended": "Yes" if recommended else "No", "units": None, "investment_gbp": 0,
               "revenue_protected_gbp": 0, "cost_avoided_gbp": 0, "remaining_risk_gbp": 0, "arrival_days": None,
               "opportunity_at_risk_gbp": source["opportunity_at_risk_gbp"], "confidence": source["confidence"],
               "key_assumption": assumption, "primary_risk": risk, "as_of_week": as_of}
        row.update(fields)
        options.append(row)

    for title_id in sorted(titles):
        ratio = variance(title_id, end)
        if ratio is None:
            continue
        units_4w, plan_4w = total(title_sold, (title_id,), end, 4), total(title_plan, (title_id,), end, 4)
        net_4w = rounded(total(revenue, (title_id,), end, 4))
        if ratio >= UPSIDE_RATIO or ratio <= DOWNSIDE_RATIO:
            upside = ratio >= UPSIDE_RATIO
            sign = 1 if upside else -1
            places = {}
            for (key, territory, channel, week), value in variance_by_place.items():
                if key == title_id and week > end - 4:
                    places[(territory, channel)] = places.get((territory, channel), 0) + sign * value
            by_territory = {}
            for (territory, channel), value in places.items():
                by_territory[territory] = by_territory.get(territory, 0) + value
            lead = max(sorted(by_territory), key=lambda name: by_territory[name])
            channels = sorted((channel for territory, channel in places if territory == lead),
                              key=lambda channel: (-places[(lead, channel)], channel))[:2]
            if upside:
                detected = lambda week, t=title_id: at_least(variance(t, week), UPSIDE_RATIO)
                material = lambda week, t=title_id: at_least(variance(t, week), MATERIAL_UPSIDE_RATIO)
                headline = f"Outperforming forecast by {round(ratio, 1)}x"
            else:
                detected = lambda week, t=title_id: at_most(variance(t, week), DOWNSIDE_RATIO)
                material = lambda week, t=title_id: at_most(variance(t, week), MATERIAL_DOWNSIDE_RATIO)
                headline = f"Selling at {round(ratio, 1)}x of forecast"
            run = end - at[since(detected)] + 1
            signal(title_id, "fcv", "Forecast variance", headline, detected, material,
                   "High" if run >= 4 else "Medium" if run >= 2 else "Low", actual_vs_forecast=round(ratio, 1),
                   units_last_4w=units_4w, forecast_last_4w=plan_4w, driver_territory=lead,
                   driver_channels=" and ".join(channels))

        change, mentions = momentum(title_id, end)
        if change is not None and change >= MOMENTUM_CHANGE and mentions >= MOMENTUM_MENTIONS:
            detected = lambda week, t=title_id: (at_least(momentum(t, week)[0], MOMENTUM_CHANGE)
                                                 and momentum(t, week)[1] >= MOMENTUM_MENTIONS)
            material = lambda week, t=title_id: detected(week) and momentum(t, week)[0] >= MATERIAL_MOMENTUM_CHANGE
            common = {"search_momentum_change_pct": round(change * 100, 1), "media_mentions_4w": mentions,
                      "actual_vs_forecast": round(ratio, 1)}
            signal(title_id, "mom", "Public momentum",
                   f"Search interest up {rounded(change * 100)}% with {mentions} media mentions in four weeks",
                   detected, material, "Medium", **common)
            if ratio >= MARKETING_RATIO and title_id not in live:
                spend = min(MARKETING_CAP_GBP, max(MARKETING_FLOOR_GBP, round_up(rounded(net_4w * MARKETING_SHARE), 1000)))
                row = signal(title_id, "mkt", "Marketing opportunity", "Momentum without a live campaign",
                             detected, material, "Medium", "Increase marketing", **common)
                option(row, "increase", "Increase marketing", True, "Momentum continues for at least four weeks",
                       "Public interest fades before the campaign lands", investment_gbp=spend,
                       revenue_protected_gbp=rounded(spend * MARKETING_RETURN), arrival_days=TRANSFER_DAYS)
                option(row, "hold", "Hold marketing spend", False, "Organic momentum continues without paid support",
                       "Competing releases take the attention the title has now")

    for edition_id in sorted(editions):
        edition = editions[edition_id]
        if edition["format"] not in PRINT_FORMATS:
            continue
        title_id, lead, net = edition["title_id"], edition["reprint_lead_time_days"], edition["net_price_gbp"]
        ratio = variance(title_id, end)
        for territory in TERRITORIES:
            state = inventory(edition_id, territory, end)
            if state is None:
                continue
            common = {"edition_id": edition_id, "format": edition["format"], "territory": territory,
                      "stock_on_hand": state["on_hand"], "stock_on_order": state["on_order"],
                      "stock_cover_days": round(state["cover"], 1), "reprint_lead_time_days": lead,
                      "actual_vs_forecast": round(ratio, 1) if ratio is not None else None}
            if state["gap"] > 0:
                gap = lambda week, e=edition_id, t=territory: ((inventory(e, t, week) or {}).get("gap") or 0) > 0
                material = lambda week, e=edition_id, t=territory: (
                    ((inventory(e, t, week) or {}).get("at_risk") or 0) >= MATERIAL_AT_RISK_GBP)
                sustained = all(at_least(variance(title_id, week), UPSIDE_RATIO) for week in range(end - 2, end + 1))
                row = signal(title_id, "inv", "Inventory risk",
                             f"{edition['format']} stock in {territory} covers {rounded(state['cover'])} days "
                             f"against a {lead}-day reprint lead time", gap, material,
                             "High" if sustained else "Medium", "Expedited reprint",
                             opportunity_at_risk_gbp=state["at_risk"], **common)
                for code, name, days, premium, recommended in (
                        ("expedite", "Expedited reprint", edition["expedited_lead_time_days"],
                         edition["expedite_premium_gbp"], True),
                        ("standard", "Standard reprint", lead, 0.0, False)):
                    need = state["daily"] * (days + TARGET_COVER_DAYS) - state["on_hand"] - state["on_order"]
                    quantity = max(edition["reprint_minimum_units"], round_up(rounded(need), 1000))
                    remaining = rounded(state["daily"] * max(0.0, days - state["effective"]) * net)
                    option(row, code, name, recommended,
                           "Demand stays at the last two weeks' rate until the reprint lands",
                           "Demand normalises before the stock arrives", units=quantity,
                           investment_gbp=rounded(quantity * (edition["unit_cost_gbp"] + premium)),
                           revenue_protected_gbp=max(0, state["at_risk"] - remaining), remaining_risk_gbp=remaining,
                           arrival_days=days)
                spare = 0
                for donor in TERRITORIES:
                    other = inventory(edition_id, donor, end) if donor != territory else None
                    if other:
                        spare += max(0, rounded(other["on_hand"] - other["daily"] * (lead + TARGET_COVER_DAYS)))
                if spare:
                    protected = min(state["at_risk"], rounded(min(spare, state["daily"] * state["gap"]) * net))
                    option(row, "reallocate", "Reallocate stock from other territories", False,
                           "Other territories keep enough cover for their own demand",
                           "Demand rises in the territories that give up stock", units=spare,
                           investment_gbp=rounded(spare * TRANSFER_COST_GBP), revenue_protected_gbp=protected,
                           remaining_risk_gbp=state["at_risk"] - protected, arrival_days=TRANSFER_DAYS)
            elif state["total_cover"] > EXCESS_COVER_DAYS and at_most(ratio, DOWNSIDE_RATIO):
                exposure = rounded((state["on_hand"] + state["on_order"] - state["daily"] * EXCESS_COVER_DAYS)
                                   * edition["unit_cost_gbp"])
                excess = lambda week, e=edition_id, t=territory, title=title_id: (
                    ((inventory(e, t, week) or {}).get("total_cover") or 0) > EXCESS_COVER_DAYS
                    and at_most(variance(title, week), DOWNSIDE_RATIO))

                def material(week, e=edition_id, t=territory, cost=edition["unit_cost_gbp"]):
                    other = inventory(e, t, week)
                    return bool(excess(week) and other and other["on_order"] > 0 and rounded(
                        (other["on_hand"] + other["on_order"] - other["daily"] * EXCESS_COVER_DAYS) * cost)
                        >= MATERIAL_EXCESS_GBP)

                row = signal(title_id, "exc", "Excess inventory",
                             f"{rounded(state['total_cover'])} days of {edition['format']} stock in {territory}"
                             + (" with a reprint on order" if state["on_order"] else ""), excess, material, "High",
                             "Pause planned reprint" if state["on_order"] else None,
                             excess_exposure_gbp=exposure, **common)
                if state["on_order"]:
                    saved = rounded(state["on_order"] * edition["unit_cost_gbp"])
                    option(row, "pause", "Pause planned reprint", True, "Demand stays near the last two weeks' rate",
                           "A late surge needs the reprint after all", units=state["on_order"],
                           cost_avoided_gbp=saved)
                    option(row, "keep", "Keep planned reprint", False, "Demand recovers to the forecast",
                           "The extra stock is returned or written down", units=state["on_order"],
                           investment_gbp=saved, remaining_risk_gbp=exposure)

    performance = []
    for title_id in sorted(titles):
        title, ratio = titles[title_id], variance(title_id, end)
        this_week, last_week = title_sold.get((title_id, end), 0), title_sold.get((title_id, end - 1), 0)

        def top(kind, t=title_id):
            totals = {}
            for (key, group, value, week), units in mix.items():
                if key == t and group == kind and week > end - 4:
                    totals[value] = totals.get(value, 0) + units
            best = max(sorted(totals), key=lambda value: totals[value], default=None)
            return best if best is not None and totals[best] > 0 else None

        change, mentions = momentum(title_id, end)
        latest = public.get((title_id, end)) or {}
        performance.append({
            "title_id": title_id, "title_name": title["title_name"], "author_name": title["author_name"],
            "genre": title["genre"], "as_of_week": as_of, "units_week": this_week, "units_prev_week": last_week,
            "week_change_pct": round((this_week / last_week - 1) * 100, 1) if last_week else None,
            "units_last_4w": total(title_sold, (title_id,), end, 4),
            "forecast_last_4w": total(title_plan, (title_id,), end, 4),
            "actual_vs_forecast": round(ratio, 1) if ratio is not None else None,
            "units_to_date": total(title_sold, (title_id,), end, end + 1),
            "revenue_last_4w_gbp": rounded(total(revenue, (title_id,), end, 4)), "top_territory": top("territory"),
            "top_channel": top("channel"), "top_format": top("format"), "portfolio_rank": None,
            "search_index": latest.get("search_index"),
            "search_momentum_change_pct": round(change * 100, 1) if change is not None else None,
            "media_mentions_4w": mentions, "review_count": latest.get("review_count"),
            "avg_rating": latest.get("avg_rating"), "live_campaign": " and ".join(sorted(live.get(title_id, []))) or None,
        })
    for rank, row in enumerate(sorted(performance, key=lambda row: (-row["units_week"], row["title_id"])), start=1):
        row["portfolio_rank"] = rank

    signals.sort(key=lambda row: (row["is_material"] != "Yes",
                                  -(row["opportunity_at_risk_gbp"] or row["excess_exposure_gbp"] or 0),
                                  row["signal_id"]))
    return {"title_signals": signals, "decision_options": options, "title_performance": performance}

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

SOURCES = ("titles", "editions", "weekly_sales", "inventory_weekly", "public_momentum", "campaigns",
           "reprint_requests")
DERIVED = (
    ("title_signals",
     "signal_id STRING, title_id STRING, title_name STRING, author_name STRING, signal_type STRING, "
     "edition_id STRING, format STRING, territory STRING, as_of_week DATE, first_detected_week DATE, "
     "material_since_week DATE, headline STRING, actual_vs_forecast DOUBLE, units_last_4w BIGINT, "
     "forecast_last_4w BIGINT, stock_on_hand BIGINT, stock_on_order BIGINT, stock_cover_days DOUBLE, "
     "reprint_lead_time_days BIGINT, opportunity_at_risk_gbp BIGINT, excess_exposure_gbp BIGINT, "
     "driver_territory STRING, driver_channels STRING, search_momentum_change_pct DOUBLE, "
     "media_mentions_4w BIGINT, confidence STRING, is_material STRING, status STRING, "
     "recommended_option STRING"),
    ("decision_options",
     "option_id STRING, signal_id STRING, title_id STRING, title_name STRING, edition_id STRING, "
     "territory STRING, option_name STRING, is_recommended STRING, units BIGINT, investment_gbp BIGINT, "
     "revenue_protected_gbp BIGINT, cost_avoided_gbp BIGINT, remaining_risk_gbp BIGINT, arrival_days BIGINT, "
     "opportunity_at_risk_gbp BIGINT, confidence STRING, key_assumption STRING, primary_risk STRING, "
     "as_of_week DATE"),
    ("title_performance",
     "title_id STRING, title_name STRING, author_name STRING, genre STRING, as_of_week DATE, units_week BIGINT, "
     "units_prev_week BIGINT, week_change_pct DOUBLE, units_last_4w BIGINT, forecast_last_4w BIGINT, "
     "actual_vs_forecast DOUBLE, units_to_date BIGINT, revenue_last_4w_gbp BIGINT, top_territory STRING, "
     "top_channel STRING, top_format STRING, portfolio_rank BIGINT, search_index BIGINT, "
     "search_momentum_change_pct DOUBLE, media_mentions_4w BIGINT, review_count BIGINT, avg_rating DOUBLE, "
     "live_campaign STRING"),
)


def table_path(name):
    return f"{lakehouse_path}/Tables/dbo/{name}"


def read_table(name):
    path = table_path(name)
    if not notebookutils.fs.exists(path) or not DeltaTable.isDeltaTable(spark, path):
        raise ValueError(f"dbo.{name} is missing or not a Delta table; run SeedBooks first.")
    return [row.asDict() for row in spark.read.format("delta").load(path).collect()]


def typed_rows(name, rows, schema):
    columns = [tuple(part.strip().split(" ")) for part in schema.split(",")]
    names = [column for column, _ in columns]
    for row in rows:
        if sorted(row) != sorted(names):
            raise ValueError(f"{name} rows must have exactly the columns {names}.")
    cast = {"DOUBLE": float, "BIGINT": int}
    return [tuple(None if row[column] is None else cast.get(kind, lambda value: value)(row[column])
                  for column, kind in columns) for row in rows]


def write_table(name, rows, schema):
    frame = spark.createDataFrame(typed_rows(name, rows, schema), schema=schema)
    path = table_path(name)
    if notebookutils.fs.exists(path):
        if not DeltaTable.isDeltaTable(spark, path):
            raise ValueError(f"Refusing to replace a non-Delta path: {path}")
        if DeltaTable.forPath(spark, path).toDF().schema.simpleString() != frame.schema.simpleString():
            raise ValueError(f"Existing schema differs from the derived schema: {name}")
        frame.write.format("delta").mode("overwrite").save(path)
    else:
        frame.write.format("delta").mode("errorifexists").save(path)
    print(f"{name}: wrote {len(rows)} rows.")


derived = compute({name: read_table(name) for name in SOURCES})
for table_name, table_schema in DERIVED:
    write_table(table_name, derived[table_name], table_schema)

material = [row for row in derived["title_signals"] if row["is_material"] == "Yes"]
as_of_week = derived["title_performance"][0]["as_of_week"]
print(f"Signals for the week of {as_of_week:%d %B %Y}: {len(material)} material of {len(derived['title_signals'])}.")
for row in material:
    print(f"- {row['title_name']}: {row['signal_type']}. {row['headline']}.")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

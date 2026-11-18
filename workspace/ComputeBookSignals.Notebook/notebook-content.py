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
# Run after SeedBooks, and again whenever weekly data is added or a reprint request
# is approved. It works only in this notebook's current workspace, on the Books
# lakehouse and the BookSignals KQL database, with the running user's tokens.
# First it copies the reprint requests the reprint server recorded in BookSignals
# into dbo.reprint_requests, insert-only by request_id: an existing row is never
# changed. Then it recomputes, for the latest week in dbo.weekly_sales only, three
# derived tables with fixed rules: title_signals, decision_options and
# title_performance. Each run replaces those tables' rows with the same rows for the
# same data; the other source tables are only read. Last, it appends the run to
# BookSignals: its title signals and decision options, then the signal_runs row that
# completes it. Readers of BookSignals use only the latest complete run.
# Every amount, ratio and recommendation comes from these rules, never from a model.

# PARAMETERS CELL ********************

lakehouse_name = "Books"
kql_database_name = "BookSignals"

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
if not isinstance(kql_database_name, str) or not kql_database_name.strip():
    raise ValueError("kql_database_name must name a KQL database in the current workspace.")

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
# SeedBooks' dbo.reprint_requests columns: the run copies the approved requests recorded in the KQL database into them.
REQUESTS = ("request_id STRING, signal_id STRING, title_id STRING, title_name STRING, edition_id STRING, "
            "territory STRING, quantity BIGINT, expedited STRING, rationale STRING, evidence STRING, "
            "approver_name STRING, approved_at TIMESTAMP, status STRING")


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


def copy_requests(rows):
    """Insert requests into dbo.reprint_requests by request_id; an existing row is never changed."""
    source = spark.createDataFrame(typed_rows("reprint_requests", rows, REQUESTS), schema=REQUESTS)
    target = DeltaTable.forPath(spark, table_path("reprint_requests"))
    if target.toDF().schema.simpleString() != source.schema.simpleString():
        raise ValueError("Existing schema differs from the reprint request schema: reprint_requests")
    (
        target.alias("target")
        .merge(source.alias("source"), "target.request_id = source.request_id")
        .whenNotMatchedInsertAll()
        .execute()
    )

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

import base64
import json
import re
import time
from datetime import datetime, timezone
from uuid import uuid4

import requests

api_root = "https://api.fabric.microsoft.com"
ATTEMPTS = 5  # Per request, for throttling (429) and transient service errors (5xx).
# Each lakehouse type's Kusto type, as a v1 response's ColumnType or DataType names it, and its KQL conversion.
KUSTO_TYPES = {"STRING": ("string", "String", "tostring"), "BIGINT": ("long", "Int64", "tolong"),
               "DOUBLE": ("real", "Double", "toreal"), "DATE": ("datetime", "DateTime", "todatetime"),
               "TIMESTAMP": ("datetime", "DateTime", "todatetime")}
# What a run adds to each title_signals and decision_options row, and the signal_runs row that completes the run.
RUN_COLUMNS = "run_id STRING, computed_at TIMESTAMP"
SIGNAL_RUNS = "run_id STRING, as_of_week DATE, computed_at TIMESTAMP, title_signals BIGINT, decision_options BIGINT"


def schema_columns(schema):
    return [tuple(part.strip().split(" ")) for part in schema.split(",")]


def send(method, url, audience, **kwargs):
    """One request with the user's token for `audience`; throttling and service errors are retried, boundedly."""
    for attempt in range(1, ATTEMPTS + 1):
        response = requests.request(
            method,
            url,
            headers={"Authorization": f"Bearer {notebookutils.credentials.getToken(audience)}",
                     "Accept": "application/json"},
            timeout=120,
            allow_redirects=False,
            **kwargs,
        )
        if (response.status_code != 429 and response.status_code < 500) or attempt == ATTEMPTS:
            return response
        delay = response.headers.get("Retry-After", "")
        time.sleep(min(int(delay), 60) if delay.isdigit() else 2 ** attempt)


def fabric_request(method, path, **kwargs):
    if not path.startswith("/v1/") or "://" in path:
        raise ValueError("Fabric requests must use a relative v1 API path.")
    response = send(method, f"{api_root}{path}", "pbi", **kwargs)
    if response.status_code != 200:
        raise RuntimeError(f"Fabric {method} {path} failed ({response.status_code}): {response.text[:1000]}")
    return response


def find_kql_database():
    """The item ID and query URI of the current workspace's KQL database named kql_database_name."""
    matches, params, seen_tokens = [], {}, set()
    while True:
        page = fabric_request("GET", f"/v1/workspaces/{workspace_id}/kqlDatabases", params=params).json()
        matches.extend(item for item in page["value"] if item["displayName"] == kql_database_name)
        token = page.get("continuationToken")
        if not token:
            break
        if token in seen_tokens:
            raise RuntimeError("Fabric KQL database listing repeated its continuation token.")
        seen_tokens.add(token)
        params = {"continuationToken": token}
    if len(matches) != 1:
        raise ValueError(f"Expected one KQL database named {kql_database_name} in the current workspace.")
    item = matches[0]
    if item["type"] != "KQLDatabase" or str(UUID(item["workspaceId"])) != workspace_id:
        raise ValueError("Refusing to use a KQL database outside the current workspace.")
    uri = str(item["properties"].get("queryServiceUri") or "").rstrip("/")
    if not re.fullmatch(r"https://[A-Za-z0-9.-]+\.kusto\.fabric\.microsoft\.com", uri):
        raise ValueError("The KQL database returned an unexpected query URI.")
    return str(UUID(item["id"])), uri


def kusto(kind, csl, action, database=None):
    """Run a query (kind "query") or management command ("mgmt"); return the first result table's column names,
    column types and rows."""
    body = {"csl": csl} if database is None else {"db": database, "csl": csl}
    response = send("POST", f"{query_uri}/v1/rest/{kind}", "kusto", json=body)
    if response.status_code != 200:
        raise RuntimeError(f"Kusto {action} failed ({response.status_code}): {response.text[:500]}")
    try:
        result = response.json()
        table = result["Tables"][0]
        names = [column["ColumnName"] for column in table["Columns"]]
        kinds = [column.get("ColumnType") or column.get("DataType") for column in table["Columns"]]
        rows = table["Rows"]
        valid = not result.get("Exceptions") and all(isinstance(row, list) and len(row) == len(names) for row in rows)
    except (AttributeError, IndexError, KeyError, TypeError, ValueError):
        valid = False
    if not valid:
        raise RuntimeError(f"Kusto {action} returned an unexpected response.")
    return names, kinds, rows


def kusto_database(item_id):
    """The Kusto name of the KQL database: the one .show databases row whose DatabaseName or PrettyName is its
    display name or item ID. Fabric can name a database by its item ID and show the display name as PrettyName."""
    # .show databases is cluster-scoped, so the request names no database.
    names, _, rows = kusto("mgmt", ".show databases", ".show databases")
    if not {"DatabaseName", "PrettyName"} <= set(names):
        raise RuntimeError("Kusto .show databases returned an unexpected response.")
    wanted = {kql_database_name.casefold(), item_id}
    found = [row[names.index("DatabaseName")] for row in rows
             if wanted & {str(row[names.index(column)] or "").casefold() for column in ("DatabaseName", "PrettyName")}]
    if len(found) != 1 or not isinstance(found[0], str) or not found[0]:
        raise ValueError(f"Expected one Kusto database for the {kql_database_name} KQL database.")
    return found[0]


def from_kusto(value, kind):
    """A v1 response value as the lakehouse column type holds it; a datetime is timezone-aware UTC."""
    if value is None:
        return None
    if kind == "STRING" and isinstance(value, str) or kind == "BIGINT" and type(value) is int:
        return value
    if kind == "TIMESTAMP" and isinstance(value, str):
        match = re.fullmatch(r"(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d{1,7}))?Z", value)
        if match:
            *parts, fraction = match.groups()
            return datetime(*map(int, parts), int((fraction or "0")[:6].ljust(6, "0")), tzinfo=timezone.utc)
    raise ValueError(f"{kql_database_name}.reprint_requests returned an unexpected {kind} value: {value!r}")


def kql_requests():
    """Every request in the KQL database's reprint_requests, with the dbo.reprint_requests columns."""
    columns = schema_columns(REQUESTS)
    names, kinds, rows = kusto("query", "reprint_requests | project " + ", ".join(name for name, _ in columns),
                               "reprint_requests query", kusto_name)
    if names != [name for name, _ in columns] or any(
            kind not in KUSTO_TYPES[ddl][:2] for kind, (_, ddl) in zip(kinds, columns)):
        raise ValueError(f"{kql_database_name}.reprint_requests does not have the lakehouse request columns.")
    return [{name: from_kusto(value, ddl) for value, (name, ddl) in zip(row, columns)} for row in rows]


def kql_value(value, kind):
    """A row value as JSON for its KQL conversion: dates and timestamps as ISO 8601 strings in UTC."""
    if value is None:
        return None
    if kind == "DATE":
        return value.isoformat()
    if kind == "TIMESTAMP":
        return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    return {"DOUBLE": float, "BIGINT": int}.get(kind, str)(value)


def appended(table):
    """How many of this run's rows a KQL table holds."""
    _, _, rows = kusto("query", f"{table} | where run_id == '{run_id}' | count", f"{table} count", kusto_name)
    if len(rows) != 1 or type(rows[0][0]) is not int:
        raise RuntimeError(f"Kusto {table} count returned an unexpected response.")
    return rows[0][0]


def append_run(table, schema, rows):
    """Append this run's rows to a KQL table in one ingestion tagged with the run, then count them back.

    The rows travel as base64 JSON, so no value is parsed as KQL. With ingestIfNotExists, a retried append that the
    service had already committed fails, so a failed append counts as written only when its rows read back.
    """
    if not rows:
        return
    columns = schema_columns(schema)
    payload = [{name: kql_value(row[name], kind) for name, kind in columns} for row in rows]
    data = base64.b64encode(
        json.dumps(payload if len(payload) > 1 else payload[0], allow_nan=False).encode("utf-8")
    ).decode("ascii")
    source = f"print r = parse_json(base64_decode_tostring('{data}'))" + (" | mv-expand r" if len(payload) > 1 else "")
    project = ", ".join(f"['{name}'] = {KUSTO_TYPES[kind][2]}(r['{name}'])" for name, kind in columns)
    tag = f"{run_id}-{table}"
    try:
        kusto("mgmt", f".append {table} with (ingestIfNotExists = '[\"{tag}\"]', tags = '[\"ingest-by:{tag}\"]') "
                      f"<| {source} | project {project}", f".append {table}", kusto_name)
        failure = None
    except RuntimeError as error:
        failure = error
    count = appended(table)
    if count != len(rows):
        raise failure or RuntimeError(f"{kql_database_name}.{table} holds {count} of run {run_id}'s {len(rows)} rows.")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

kql_database_id, query_uri = find_kql_database()
kusto_name = kusto_database(kql_database_id)
print(f"{kql_database_name}: Kusto database {kusto_name} in the current workspace.")

recorded = kql_requests()
sources = {name: read_table(name) for name in SOURCES}
known = {row["request_id"] for row in sources["reprint_requests"]}
new_requests = {}
for row in recorded:
    if row["request_id"] not in known:
        new_requests.setdefault(row["request_id"], row)
if new_requests:
    copy_requests(list(new_requests.values()))
    sources["reprint_requests"] = read_table("reprint_requests")
print(f"reprint_requests: inserted {len(new_requests)} of {len(recorded)} requests from {kql_database_name}; "
      "retained all existing rows.")

derived = compute(sources)
for table_name, table_schema in DERIVED:
    write_table(table_name, derived[table_name], table_schema)

material = [row for row in derived["title_signals"] if row["is_material"] == "Yes"]
as_of_week = derived["title_performance"][0]["as_of_week"]

# The run's rows first and its signal_runs row last: a run without that row is incomplete and never read.
run_id, computed_at = str(uuid4()), datetime.now(timezone.utc)
stamp = {"run_id": run_id, "computed_at": computed_at}
for table_name in ("title_signals", "decision_options"):
    append_run(table_name, f"{dict(DERIVED)[table_name]}, {RUN_COLUMNS}",
               [dict(row, **stamp) for row in derived[table_name]])
    print(f"{kql_database_name}.{table_name}: appended {len(derived[table_name])} rows for run {run_id}.")
append_run("signal_runs", SIGNAL_RUNS, [dict(stamp, as_of_week=as_of_week, title_signals=len(derived["title_signals"]),
                                             decision_options=len(derived["decision_options"]))])
print(f"{kql_database_name}.signal_runs: run {run_id} is complete.")

print(f"Signals for the week of {as_of_week:%d %B %Y}: {len(material)} material of {len(derived['title_signals'])}.")
for row in material:
    print(f"- {row['title_name']}: {row['signal_type']}. {row['headline']}.")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

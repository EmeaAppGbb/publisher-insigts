# Fabric notebook source

# METADATA ********************

# META {
# META   "kernel_info": {
# META     "name": "synapse_pyspark"
# META   },
# META   "dependencies": {}
# META }

# MARKDOWN ********************

# # Seed the fictional book portfolio
# Run after the Books lakehouse is deployed. No default lakehouse attachment is
# required: the target is resolved only in this notebook's current workspace.
# A deterministic generator writes the same fictional rows on every run; rows whose
# keys already exist are preserved, and Files/documents/starter.txt is never
# overwritten. Setting through_week to a later week (up to 30, the last week the
# fictional reprints are planned for) adds only that week's rows, which is how the
# demo advances its weekly data.
# By default, only workspaces ending in -dev or -test may receive demo data.

# PARAMETERS CELL ********************

lakehouse_name = "Books"
allow_other_workspaces = False
through_week = 26

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

context = notebookutils.runtime.context
workspace_id = str(UUID(context["currentWorkspaceId"]))
workspace_name = context["currentWorkspaceName"]

if not isinstance(workspace_name, str) or not workspace_name:
    raise ValueError("The runtime must identify the current workspace name.")
if not isinstance(lakehouse_name, str) or not lakehouse_name.strip():
    raise ValueError("lakehouse_name must name a lakehouse in the current workspace.")
if type(allow_other_workspaces) is not bool:
    raise ValueError("allow_other_workspaces must be a Boolean, not a string.")
if type(through_week) is not int or not 1 <= through_week <= 30:
    raise ValueError("through_week must be an integer from 1 to 30.")
if not workspace_name.endswith(("-dev", "-test")) and not allow_other_workspaces:
    raise ValueError(
        "Demo seeding is restricted to -dev/-test workspaces. For an intentional "
        "exception, explicitly set allow_other_workspaces=True for this run."
    )

lakehouse = notebookutils.lakehouse.get(lakehouse_name, workspace_id)
if str(UUID(lakehouse.workspaceId)) != workspace_id:
    raise ValueError("Refusing to seed a lakehouse outside the current workspace.")

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

import hashlib
from datetime import date, timedelta

# Week 1 starts on Monday 11 May 2026; the default seed ends with the week of 2 November 2026.
FIRST_WEEK = date(2026, 5, 11)
TERRITORIES = ("UK", "US", "ANZ")
PRINT_FORMATS = ("Hardback", "Paperback")
PRINT_CHANNEL_SHARES = (("Major retail", 0.5), ("Independent", 0.2), ("Online retail", 0.3))
DIGITAL_CHANNEL = "Digital"

TITLES = (
    ("title-001", "The Glass Orchard", "Mara Ellison", "Literary fiction", "Harrowgate Lane", date(2026, 3, 5)),
    ("title-002", "Winter Light at Hollins Moor", "Mara Ellison", "Literary fiction", "Harrowgate Lane",
     date(2023, 9, 14)),
    ("title-003", "Salt and Starlight", "Juniper Vale", "Romantasy", "Quillmere Press", date(2026, 6, 18)),
    ("title-004", "Northbound Signals", "Tobias Renfrew", "Thriller", "Saltmarsh & Vane", date(2026, 4, 23)),
    ("title-005", "The Mapmaker of Carrow Quay", "Elodie Marchbank", "Historical fiction", "Harrowgate Lane",
     date(2025, 10, 2)),
    ("title-006", "A Field Guide to Small Mercies", "Anika Thorvald", "Popular science", "Quillmere Press",
     date(2026, 2, 12)),
    ("title-007", "The Ninth Lantern", "Callum Ashdown", "Crime", "Saltmarsh & Vane", date(2025, 5, 8)),
    ("title-008", "Ember and Ash Kitchen", "Priya Lakemoor", "Cookery", "Harrowgate Lane", date(2026, 9, 24)),
)

# Edition, title, format, list and net price, print unit cost, printer, standard and expedited reprint lead
# days, expedite premium per unit and minimum reprint. Digital editions have no print terms.
EDITIONS = (
    ("ed-001-hb", "title-001", "Hardback", 20.00, 9.60, 2.10, "Brindle Print Works", 35, 21, 0.40, 5000),
    ("ed-001-eb", "title-001", "Ebook", 9.99, 5.20, None, None, None, None, None, None),
    ("ed-001-au", "title-001", "Audio", 18.99, 7.80, None, None, None, None, None, None),
    ("ed-002-pb", "title-002", "Paperback", 9.99, 4.40, 1.15, "Calder Valley Printers", 28, 18, 0.30, 3000),
    ("ed-002-eb", "title-002", "Ebook", 5.99, 3.10, None, None, None, None, None, None),
    ("ed-003-pb", "title-003", "Paperback", 10.99, 4.90, 1.25, "Calder Valley Printers", 28, 18, 0.30, 5000),
    ("ed-003-eb", "title-003", "Ebook", 6.99, 3.60, None, None, None, None, None, None),
    ("ed-003-au", "title-003", "Audio", 16.99, 6.90, None, None, None, None, None, None),
    ("ed-004-hb", "title-004", "Hardback", 18.99, 9.00, 2.05, "Brindle Print Works", 35, 21, 0.40, 5000),
    ("ed-004-eb", "title-004", "Ebook", 8.99, 4.70, None, None, None, None, None, None),
    ("ed-005-pb", "title-005", "Paperback", 9.99, 4.40, 1.15, "Calder Valley Printers", 28, 18, 0.30, 3000),
    ("ed-005-eb", "title-005", "Ebook", 5.99, 3.10, None, None, None, None, None, None),
    ("ed-006-hb", "title-006", "Hardback", 22.00, 10.40, 2.30, "Brindle Print Works", 35, 21, 0.40, 3000),
    ("ed-006-eb", "title-006", "Ebook", 10.99, 5.70, None, None, None, None, None, None),
    ("ed-006-au", "title-006", "Audio", 19.99, 8.20, None, None, None, None, None, None),
    ("ed-007-pb", "title-007", "Paperback", 8.99, 3.90, 1.05, "Calder Valley Printers", 28, 18, 0.30, 3000),
    ("ed-007-eb", "title-007", "Ebook", 4.99, 2.60, None, None, None, None, None, None),
    ("ed-008-hb", "title-008", "Hardback", 26.00, 12.20, 3.40, "Brindle Print Works", 42, 28, 0.55, 3000),
)

# Each title's weekly demand across its editions and territories: the planned level (base x trend, from its
# launch week) and the actual lift over plan, as (week, multiplier) keyframes joined linearly. Shares split
# demand by format and territory; weights concentrate the lift: 1 + (lift - 1) x territory weight x channel weight.
EVEN_TERRITORIES = {"UK": 1.0, "US": 1.0, "ANZ": 1.0}
EVEN_CHANNELS = {"Major retail": 1.0, "Independent": 1.0, "Online retail": 1.0, "Digital": 1.0}
DEMAND = {
    "title-001": {"base": 5500, "launch": 1, "trend": ((1, 1.0), (26, 0.72), (52, 0.5)),
                  "lift": ((1, 1.0), (17, 1.02), (19, 1.5), (22, 2.4), (24, 3.0), (26, 3.25), (27, 3.75),
                           (30, 3.3), (40, 1.9), (52, 1.3)),
                  "formats": {"Hardback": 0.62, "Ebook": 0.28, "Audio": 0.10},
                  "territories": {"UK": 0.6, "US": 0.28, "ANZ": 0.12},
                  "territory_weights": {"UK": 1.2, "US": 0.55, "ANZ": 0.45},
                  "channel_weights": {"Major retail": 1.25, "Independent": 0.7, "Online retail": 0.95,
                                      "Digital": 1.2}},
    "title-002": {"base": 1400, "launch": 1, "trend": ((1, 1.0), (52, 0.95)),
                  "lift": ((1, 1.0), (19, 1.0), (23, 1.6), (27, 1.9), (40, 1.4), (52, 1.2)),
                  "formats": {"Paperback": 0.7, "Ebook": 0.3},
                  "territories": {"UK": 0.65, "US": 0.25, "ANZ": 0.10},
                  "territory_weights": {"UK": 1.2, "US": 0.6, "ANZ": 0.6},
                  "channel_weights": {"Major retail": 1.1, "Independent": 0.9, "Online retail": 1.0,
                                      "Digital": 1.1}},
    "title-003": {"base": 4200, "launch": 6, "trend": ((6, 1.0), (26, 0.8), (52, 0.6)),
                  "lift": ((1, 1.0), (14, 1.05), (18, 1.3), (22, 1.55), (26, 1.75), (27, 1.85), (36, 1.5),
                           (52, 1.1)),
                  "formats": {"Paperback": 0.55, "Ebook": 0.35, "Audio": 0.10},
                  "territories": {"UK": 0.5, "US": 0.38, "ANZ": 0.12},
                  "territory_weights": {"UK": 1.0, "US": 1.1, "ANZ": 0.9},
                  "channel_weights": {"Major retail": 0.9, "Independent": 0.8, "Online retail": 1.2,
                                      "Digital": 1.3}},
    "title-004": {"base": 5200, "launch": 1, "trend": ((1, 1.0), (26, 0.6), (52, 0.4)),
                  "lift": ((1, 0.95), (8, 0.8), (16, 0.62), (26, 0.52), (52, 0.5)),
                  "formats": {"Hardback": 0.7, "Ebook": 0.3},
                  "territories": {"UK": 0.6, "US": 0.3, "ANZ": 0.10},
                  "territory_weights": EVEN_TERRITORIES,
                  "channel_weights": {"Major retail": 1.1, "Independent": 0.9, "Online retail": 1.0,
                                      "Digital": 0.9}},
    "title-005": {"base": 1800, "launch": 1, "trend": ((1, 1.0), (52, 0.85)), "lift": ((1, 1.0), (52, 1.0)),
                  "formats": {"Paperback": 0.72, "Ebook": 0.28},
                  "territories": {"UK": 0.7, "US": 0.2, "ANZ": 0.10},
                  "territory_weights": EVEN_TERRITORIES, "channel_weights": EVEN_CHANNELS},
    "title-006": {"base": 2600, "launch": 1, "trend": ((1, 1.0), (52, 0.7)),
                  "lift": ((1, 1.0), (12, 1.05), (20, 1.2), (27, 1.3), (52, 1.1)),
                  "formats": {"Hardback": 0.5, "Ebook": 0.25, "Audio": 0.25},
                  "territories": {"UK": 0.45, "US": 0.45, "ANZ": 0.10},
                  "territory_weights": {"UK": 0.5, "US": 1.6, "ANZ": 0.6},
                  "channel_weights": {"Major retail": 0.6, "Independent": 0.8, "Online retail": 0.9,
                                      "Digital": 1.6}},
    "title-007": {"base": 2200, "launch": 1, "trend": ((1, 1.0), (52, 0.8)),
                  "lift": ((1, 1.0), (26, 0.95), (52, 0.9)),
                  "formats": {"Paperback": 0.75, "Ebook": 0.25},
                  "territories": {"UK": 0.6, "US": 0.3, "ANZ": 0.10},
                  "territory_weights": EVEN_TERRITORIES, "channel_weights": EVEN_CHANNELS},
    "title-008": {"base": 3200, "launch": 20, "trend": ((20, 1.0), (32, 1.6), (34, 0.9), (52, 0.5)),
                  "lift": ((1, 1.0), (52, 1.0)), "formats": {"Hardback": 1.0},
                  "territories": {"UK": 0.75, "US": 0.15, "ANZ": 0.10},
                  "territory_weights": EVEN_TERRITORIES, "channel_weights": EVEN_CHANNELS},
}

# Stock per print edition and territory: the opening stock before week 1, and the reprints ordered so far as
# (ordered week, arrival week, units).
STOCK = {
    ("ed-001-hb", "UK"): (36000, ((14, 19, 20000), (19, 24, 32000))),
    ("ed-001-hb", "US"): (18000, ((13, 18, 30000),)),
    ("ed-001-hb", "ANZ"): (18000, ()),
    ("ed-002-pb", "UK"): (16000, ((16, 21, 10000),)),
    ("ed-002-pb", "US"): (12000, ()),
    ("ed-002-pb", "ANZ"): (5500, ()),
    ("ed-003-pb", "UK"): (16000, ((10, 14, 25000),)),
    ("ed-003-pb", "US"): (12000, ((10, 14, 20000),)),
    ("ed-003-pb", "ANZ"): (5000, ((14, 18, 5000),)),
    ("ed-004-hb", "UK"): (52000, ((24, 30, 15000),)),
    ("ed-004-hb", "US"): (22000, ()),
    ("ed-004-hb", "ANZ"): (6000, ()),
    ("ed-005-pb", "UK"): (20000, ((14, 18, 12000),)),
    ("ed-005-pb", "US"): (10000, ()),
    ("ed-005-pb", "ANZ"): (5000, ()),
    ("ed-006-hb", "UK"): (20000, ()),
    ("ed-006-hb", "US"): (15000, ((16, 21, 8000),)),
    ("ed-006-hb", "ANZ"): (5500, ()),
    ("ed-007-pb", "UK"): (19000, ((15, 19, 10000),)),
    ("ed-007-pb", "US"): (17000, ()),
    ("ed-007-pb", "ANZ"): (6500, ()),
    ("ed-008-hb", "UK"): (0, ((14, 20, 45000), (24, 30, 30000))),
    ("ed-008-hb", "US"): (0, ((14, 20, 12000),)),
    ("ed-008-hb", "ANZ"): (0, ((14, 20, 8000),)),
}

# Public signals per title: search interest (100 is the title's reference level), media mentions per week, the
# average rating and reviews per thousand units sold.
MOMENTUM = {
    "title-001": {"search": ((1, 1.0), (17, 1.05), (19, 1.6), (22, 2.3), (26, 3.1), (27, 3.4), (40, 1.8),
                             (52, 1.2)),
                  "mentions": ((1, 1), (17, 1), (18, 9), (20, 14), (24, 12), (27, 11), (40, 3), (52, 1)),
                  "rating": 4.5, "reviews_per_1000": 6},
    "title-002": {"search": ((1, 1.0), (19, 1.0), (23, 1.5), (27, 1.7), (52, 1.1)),
                  "mentions": ((1, 0), (19, 0), (22, 2), (27, 2), (52, 0)), "rating": 4.3, "reviews_per_1000": 4},
    "title-003": {"search": ((1, 0.3), (6, 1.0), (16, 1.1), (21, 1.2), (24, 1.6), (25, 2.4), (26, 3.0),
                             (27, 3.3), (36, 1.6), (52, 1.0)),
                  "mentions": ((1, 0), (6, 2), (16, 2), (24, 3), (26, 4), (27, 5), (36, 2), (52, 1)),
                  "rating": 4.6, "reviews_per_1000": 11},
    "title-004": {"search": ((1, 1.0), (26, 0.55), (52, 0.4)), "mentions": ((1, 3), (8, 2), (26, 1), (52, 0)),
                  "rating": 3.6, "reviews_per_1000": 3},
    "title-005": {"search": ((1, 1.0), (52, 0.9)), "mentions": ((1, 1), (52, 1)), "rating": 4.2,
                  "reviews_per_1000": 4},
    "title-006": {"search": ((1, 1.0), (20, 1.15), (27, 1.25), (52, 1.0)),
                  "mentions": ((1, 1), (20, 2), (27, 2), (52, 1)), "rating": 4.4, "reviews_per_1000": 5},
    "title-007": {"search": ((1, 1.0), (52, 0.85)), "mentions": ((1, 1), (52, 0)), "rating": 4.1,
                  "reviews_per_1000": 4},
    "title-008": {"search": ((1, 0.1), (19, 0.2), (20, 1.0), (27, 1.4), (52, 1.0)),
                  "mentions": ((1, 0), (19, 1), (20, 4), (27, 3), (52, 1)), "rating": 4.7, "reviews_per_1000": 5},
}

CAMPAIGNS = (
    ("camp-001", "title-001", "The Glass Orchard", "Launch campaign", "Print media", "UK",
     date(2026, 3, 1), date(2026, 4, 30), 40000),
    ("camp-002", "title-001", "The Glass Orchard", "Shortlist push", "Digital ads", "UK",
     date(2026, 9, 7), date(2026, 11, 29), 15000),
    ("camp-003", "title-003", "Salt and Starlight", "Creator partnerships", "Social", "UK",
     date(2026, 6, 15), date(2026, 8, 30), 12000),
    ("camp-004", "title-004", "Northbound Signals", "Summer retail promotion", "Retail promotion", "UK",
     date(2026, 5, 4), date(2026, 6, 28), 25000),
    ("camp-005", "title-006", "A Field Guide to Small Mercies", "US audio push", "Digital ads", "US",
     date(2026, 8, 3), date(2026, 12, 27), 8000),
    ("camp-006", "title-008", "Ember and Ash Kitchen", "Christmas gifting", "Retail promotion", "UK",
     date(2026, 11, 2), date(2026, 12, 24), 30000),
)


def week_start(week):
    return FIRST_WEEK + timedelta(days=7 * (week - 1))


def curve(keyframes, week):
    """The keyframes' multiplier at `week`, joined linearly and held flat beyond the ends."""
    if week <= keyframes[0][0]:
        return keyframes[0][1]
    for (start, low), (end, high) in zip(keyframes, keyframes[1:]):
        if week <= end:
            return low + (high - low) * (week - start) / (end - start)
    return keyframes[-1][1]


def noise(*key):
    """A reproducible value in [-1, 1] for `key`: the same on every machine and Python version."""
    digest = hashlib.sha256("|".join(str(part) for part in key).encode("utf-8")).digest()
    return int.from_bytes(digest[:4], "big") / 0xFFFFFFFF * 2 - 1


def rounded(value):
    """Half away from zero, unlike round()'s half to even."""
    return int(value + 0.5) if value >= 0 else -int(-value + 0.5)


def channels(edition_format):
    if edition_format in PRINT_FORMATS:
        return PRINT_CHANNEL_SHARES
    return ((DIGITAL_CHANNEL, 1.0),)


def generate(last_week):
    """Every seeded table's rows through `last_week`: the same rows for the same weeks on every run."""
    weeks = range(1, last_week + 1)
    title_of = {edition[0]: edition[1] for edition in EDITIONS}

    # Sales start from demand: the plan's units with its lift and a little noise, and the forecast near the plan.
    cells = {}
    for edition_id, title_id, edition_format, *_ in EDITIONS:
        profile = DEMAND[title_id]
        for territory in TERRITORIES:
            for channel, channel_share in channels(edition_format):
                weight = profile["territory_weights"][territory] * profile["channel_weights"][channel]
                for week in weeks:
                    if week < profile["launch"]:
                        cells[(edition_id, territory, channel, week)] = [0, 0]
                        continue
                    planned = (profile["base"] * curve(profile["trend"], week) * profile["formats"][edition_format]
                               * profile["territories"][territory] * channel_share)
                    lift = 1 + (curve(profile["lift"], week) - 1) * weight
                    units = planned * lift * (1 + 0.06 * noise("units", edition_id, territory, channel, week))
                    forecast = planned * (1 + 0.02 * noise("forecast", edition_id, territory, channel, week))
                    cells[(edition_id, territory, channel, week)] = [max(0, rounded(units)),
                                                                     max(0, rounded(forecast))]

    # Print sales cannot exceed the stock on hand; reprints arrive at the start of their week.
    inventory = []
    for edition_id, _, edition_format, *_ in EDITIONS:
        if edition_format not in PRINT_FORMATS:
            continue
        for territory in TERRITORIES:
            on_hand, reprints = STOCK[(edition_id, territory)]
            for week in weeks:
                received = sum(units for _, arrival, units in reprints if arrival == week)
                on_hand += received
                for channel, _ in channels(edition_format):
                    cell = cells[(edition_id, territory, channel, week)]
                    cell[0] = min(cell[0], on_hand)
                    on_hand -= cell[0]
                pending = sorted((arrival, units) for ordered, arrival, units in reprints if ordered <= week < arrival)
                inventory.append((edition_id, territory, week_start(week), on_hand,
                                  sum(units for _, units in pending), received,
                                  week_start(pending[0][0]) if pending else None))

    sales = [(edition_id, territory, channel, week_start(week), units, forecast)
             for (edition_id, territory, channel, week), (units, forecast) in sorted(cells.items())]

    momentum = []
    for title_id, *_ in TITLES:
        profile, reviews = MOMENTUM[title_id], 0
        for week in weeks:
            sold = sum(cell[0] for (edition_id, _, _, at), cell in cells.items()
                       if at == week and title_of[edition_id] == title_id)
            reviews += rounded(sold * profile["reviews_per_1000"] / 1000)
            search = rounded(100 * curve(profile["search"], week) * (1 + 0.04 * noise("search", title_id, week)))
            mentions = rounded(curve(profile["mentions"], week) + 0.8 * noise("mentions", title_id, week))
            rating = round(profile["rating"] + 0.1 * noise("rating", title_id, week), 1)
            momentum.append((title_id, week_start(week), max(0, search), max(0, mentions), reviews, rating))

    return {"titles": list(TITLES), "editions": list(EDITIONS), "weekly_sales": sales,
            "inventory_weekly": inventory, "public_momentum": momentum, "campaigns": list(CAMPAIGNS)}

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

# Table, Spark schema and key columns. reprint_requests starts empty: approved reprint requests fill it.
TABLES = (
    ("titles", "title_id STRING, title_name STRING, author_name STRING, genre STRING, imprint STRING, "
               "publication_date DATE", ("title_id",)),
    ("editions", "edition_id STRING, title_id STRING, format STRING, list_price_gbp DOUBLE, net_price_gbp DOUBLE, "
                 "unit_cost_gbp DOUBLE, printer STRING, reprint_lead_time_days BIGINT, "
                 "expedited_lead_time_days BIGINT, expedite_premium_gbp DOUBLE, reprint_minimum_units BIGINT",
     ("edition_id",)),
    ("weekly_sales", "edition_id STRING, territory STRING, channel STRING, week_start DATE, units BIGINT, "
                     "forecast_units BIGINT", ("edition_id", "territory", "channel", "week_start")),
    ("inventory_weekly", "edition_id STRING, territory STRING, week_start DATE, on_hand_units BIGINT, "
                         "on_order_units BIGINT, received_units BIGINT, next_arrival_week DATE",
     ("edition_id", "territory", "week_start")),
    ("public_momentum", "title_id STRING, week_start DATE, search_index BIGINT, media_mentions BIGINT, "
                        "review_count BIGINT, avg_rating DOUBLE", ("title_id", "week_start")),
    ("campaigns", "campaign_id STRING, title_id STRING, title_name STRING, campaign_name STRING, channel STRING, "
                  "territory STRING, start_date DATE, end_date DATE, budget_gbp BIGINT", ("campaign_id",)),
    ("reprint_requests", "request_id STRING, signal_id STRING, title_id STRING, title_name STRING, "
                         "edition_id STRING, territory STRING, quantity BIGINT, expedited STRING, rationale STRING, "
                         "evidence STRING, approver_name STRING, approved_at TIMESTAMP, status STRING",
     ("request_id",)),
)


def seed_table(name, rows, schema, keys):
    source = spark.createDataFrame(rows, schema=schema)
    path = f"{lakehouse_path}/Tables/dbo/{name}"
    if notebookutils.fs.exists(path):
        if not DeltaTable.isDeltaTable(spark, path):
            raise ValueError(f"Refusing to replace a non-Delta path: {path}")
        target = DeltaTable.forPath(spark, path)
        if target.toDF().schema.simpleString() != source.schema.simpleString():
            raise ValueError(f"Existing schema differs from the seed schema: {name}")
        (
            target.alias("target")
            .merge(source.alias("source"), " AND ".join(f"target.{key} = source.{key}" for key in keys))
            .whenNotMatchedInsertAll()
            .execute()
        )
    else:
        source.write.format("delta").mode("errorifexists").save(path)
    print(f"{name}: inserted missing demo keys; retained all existing rows.")


generated = generate(through_week)
for table_name, table_schema, table_keys in TABLES:
    seed_table(table_name, generated.get(table_name, []), table_schema, table_keys)
print(f"Seeded weeks 1 to {through_week}, through the week of {week_start(through_week):%d %B %Y}.")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

starter_document = """Fictional book portfolio starter knowledge

This is fictional demonstration data for a book publisher proof of concept, not
commercial guidance. The titles, authors, imprints, printers, campaigns and
figures are invented.

The portfolio has eight titles by seven authors, in hardback, paperback, ebook
and audio editions, sold in three territories: UK, US and ANZ. SeedBooks writes
26 weeks of weekly sales and forecast by edition, territory and channel, weekly
stock and reprints for each print edition, weekly public signals for each title
and the marketing campaigns. Running SeedBooks with a later through_week adds
that week's rows without changing earlier ones.

ComputeBookSignals derives the latest week's title signals (inventory risk,
excess inventory, forecast variance, public momentum and marketing opportunity),
the decision options that respond to them and each title's performance, with
fixed rules. BooksOntology maps the titles, editions, campaigns, signals,
options, performance and reprint requests to entities; BindBooks configures the
target-specific binding.

Foundry IQ indexes this starter document from the lakehouse's Files/documents
folder, through the default documents knowledge source. That OneLake folder
source does not index the Delta tables or the ontology. Query BooksOntology live
for its bound data, with the signed-in user's delegated token. This document
describes how the data is made, not current figures: use the ontology source,
not this document, for current sales, stock, signals and options.

Git versions item definitions and these notebooks. The notebooks materialize
the data in each target workspace; Git does not copy OneLake data. Reruns
preserve existing rows and this file, including any local edits.
"""

# The default knowledge_folders entry, documents (target_path documents), indexes Files/documents.
files_path = f"{lakehouse_path}/Files"
documents_path = f"{files_path}/documents"
starter_path = f"{documents_path}/starter.txt"
if notebookutils.fs.exists(starter_path):
    print("Preserving existing Files/documents/starter.txt.")
else:
    if not notebookutils.fs.mkdirs(documents_path):
        raise RuntimeError(f"Could not create the documents folder: {documents_path}")
    if not notebookutils.fs.put(starter_path, starter_document, False):
        raise RuntimeError(f"Could not write starter knowledge: {starter_path}")
    print("Created Files/documents/starter.txt.")

print(f"Seed completed in {workspace_name}; lakehouse GUID: {lakehouse_id}")
print("Run ComputeBookSignals to derive the latest week's signals; SQL metadata and ontology binding are separate.")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

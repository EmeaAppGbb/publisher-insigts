"""ComputeBookSignals, run locally after SeedBooks against in-memory stand-ins for Spark, Delta and OneLake.

The figures are the fictional portfolio's storyline, which the evaluations also rely on. At the seeded week, 2
November 2026, three decisions are material and The Glass Orchard's UK hardback risk is still emerging; one week
later it is material, with about 180,000 pounds of net revenue at risk.
"""

import datetime
import re
import unittest

from _lake import TABLES, Lake, modules
from _support import OTHER_ID, WORKSPACE, run

ONTOLOGY = WORKSPACE / "BooksOntology.Ontology"
TMDL_TYPES = {"STRING": "string", "BIGINT": "int64", "DOUBLE": "double", "DATE": "dateTime", "TIMESTAMP": "dateTime"}
DERIVED = ("title_signals", "decision_options", "title_performance")
UK_RISK = "sig-20261109-title-001-inv-ed-001-hb-uk"


def seed(lake, through_week=26):
    return run("SeedBooks", modules(lake), {"through_week": through_week})[0]


def compute(lake, **context):
    return run("ComputeBookSignals", modules(lake, **context))


def computed(through_week=26):
    lake = Lake()
    seed(lake, through_week)
    compute(lake)
    return lake


def keyed(rows, key):
    return {row[key]: row for row in rows}


def pick(row, *names):
    return {name: row[name] for name in names}


class StorylineTests(unittest.TestCase):
    def test_the_seeded_week_has_three_material_decisions_and_an_emerging_risk(self):
        lake = computed()
        signals = lake.rows("title_signals")
        self.assertEqual(sorted((row["title_name"], row["signal_type"]) for row in signals if row["is_material"] == "Yes"),
                         [("Northbound Signals", "Excess inventory"), ("Northbound Signals", "Forecast variance"),
                          ("Salt and Starlight", "Marketing opportunity"), ("Salt and Starlight", "Public momentum"),
                          ("The Glass Orchard", "Forecast variance")])
        self.assertEqual({row["as_of_week"] for row in signals}, {datetime.date(2026, 11, 2)})
        risk = keyed(signals, "signal_id")["sig-20261102-title-001-inv-ed-001-hb-uk"]
        self.assertEqual(pick(risk, "is_material", "opportunity_at_risk_gbp", "stock_cover_days", "material_since_week"),
                         {"is_material": "No", "opportunity_at_risk_gbp": 84571, "stock_cover_days": 23.9,
                          "material_since_week": None})
        recommended = {(row["title_name"], row["option_name"]) for row in lake.rows("decision_options")
                       if row["is_recommended"] == "Yes"}
        self.assertEqual(recommended, {("Salt and Starlight", "Increase marketing"),
                                       ("Northbound Signals", "Pause planned reprint"),
                                       ("The Glass Orchard", "Expedited reprint")})

    def test_a_week_later_the_uk_hardback_risk_is_material(self):
        lake = computed(27)
        signals = keyed(lake.rows("title_signals"), "signal_id")
        self.assertEqual(pick(signals[UK_RISK], "title_name", "signal_type", "headline", "is_material",
                              "opportunity_at_risk_gbp", "stock_on_hand", "stock_cover_days", "reprint_lead_time_days",
                              "actual_vs_forecast", "first_detected_week", "material_since_week", "confidence",
                              "status", "recommended_option"), {
            "title_name": "The Glass Orchard", "signal_type": "Inventory risk",
            "headline": "Hardback stock in UK covers 14 days against a 35-day reprint lead time", "is_material": "Yes",
            "opportunity_at_risk_gbp": 179827, "stock_on_hand": 12313, "stock_cover_days": 13.9,
            "reprint_lead_time_days": 35, "actual_vs_forecast": 3.3, "first_detected_week": datetime.date(2026, 10, 26),
            "material_since_week": datetime.date(2026, 11, 9), "confidence": "High", "status": "Open",
            "recommended_option": "Expedited reprint"})
        self.assertEqual(list(signals)[0], UK_RISK, "the largest material risk leads the watchlist")
        variance = signals["sig-20261109-title-001-fcv"]
        self.assertEqual(pick(variance, "headline", "actual_vs_forecast", "driver_territory", "driver_channels"),
                         {"headline": "Outperforming forecast by 3.3x", "actual_vs_forecast": 3.3,
                          "driver_territory": "UK", "driver_channels": "Digital and Major retail"})
        momentum = signals["sig-20261109-title-001-mom"]
        self.assertEqual(pick(momentum, "is_material", "search_momentum_change_pct", "media_mentions_4w"),
                         {"is_material": "No", "search_momentum_change_pct": 53.5, "media_mentions_4w": 45})
        options = {row["option_name"]: pick(row, "is_recommended", "units", "investment_gbp", "revenue_protected_gbp",
                                            "remaining_risk_gbp", "arrival_days")
                   for row in lake.rows("decision_options") if row["signal_id"] == UK_RISK}
        self.assertEqual(options, {
            "Expedited reprint": {"is_recommended": "Yes", "units": 32000, "investment_gbp": 80000,
                                  "revenue_protected_gbp": 119213, "remaining_risk_gbp": 60614, "arrival_days": 21},
            "Standard reprint": {"is_recommended": "No", "units": 44000, "investment_gbp": 92400,
                                 "revenue_protected_gbp": 0, "remaining_risk_gbp": 179827, "arrival_days": 35},
            "Reallocate stock from other territories": {
                "is_recommended": "No", "units": 5348, "investment_gbp": 1604, "revenue_protected_gbp": 51341,
                "remaining_risk_gbp": 128486, "arrival_days": 7}})
        performance = keyed(lake.rows("title_performance"), "title_id")["title-001"]
        self.assertEqual(pick(performance, "units_week", "units_prev_week", "portfolio_rank", "top_territory",
                              "live_campaign"),
                         {"units_week": 15135, "units_prev_week": 13217, "portfolio_rank": 1, "top_territory": "UK",
                          "live_campaign": "Shortlist push"})

    def test_a_title_that_sold_nothing_is_a_material_downside_variance(self):
        # A ratio of exactly 0.0 is the most extreme downside, not missing data.
        lake = Lake()
        seed(lake)
        sales = lake.tables[f"{TABLES}/weekly_sales"]["rows"]
        recent = {datetime.date(2026, 10, 12) + datetime.timedelta(weeks=week) for week in range(4)}
        sales[:] = [row[:4] + (0,) + row[5:] if row[0] == "ed-008-hb" and row[3] in recent else row for row in sales]
        compute(lake)
        variance = keyed(lake.rows("title_signals"), "signal_id")["sig-20261102-title-008-fcv"]
        self.assertEqual(pick(variance, "actual_vs_forecast", "is_material", "first_detected_week",
                              "material_since_week", "confidence"),
                         {"actual_vs_forecast": 0.0, "is_material": "Yes",
                          "first_detected_week": datetime.date(2026, 10, 19),
                          "material_since_week": datetime.date(2026, 10, 19), "confidence": "Medium"})

    def test_options_and_signals_reference_existing_rows(self):
        lake = computed(27)
        titles = {row["title_id"] for row in lake.rows("titles")}
        signals = {row["signal_id"] for row in lake.rows("title_signals")}
        self.assertEqual(len(signals), len(lake.rows("title_signals")), "signal IDs are unique")
        self.assertLessEqual({row["title_id"] for row in lake.rows("title_signals")}, titles)
        self.assertLessEqual({row["signal_id"] for row in lake.rows("decision_options")}, signals)
        self.assertEqual(sorted(row["title_id"] for row in lake.rows("title_performance")), sorted(titles))
        for row in lake.rows("decision_options"):
            self.assertEqual(sum(1 for other in lake.rows("decision_options") if other["signal_id"] == row["signal_id"]
                                 and other["is_recommended"] == "Yes"), 1, row["signal_id"])


class RunTests(unittest.TestCase):
    def test_a_rerun_rewrites_the_same_rows_and_reads_the_sources_only(self):
        lake = computed()
        sources = {path: table for path, table in lake.tables.items() if path.rsplit("/", 1)[1] not in DERIVED}
        before, start = {name: lake.rows(name) for name in DERIVED}, len(lake.log)
        _, output = compute(lake)
        self.assertEqual({name: lake.rows(name) for name in DERIVED}, before)
        self.assertEqual(lake.log[start:], [("overwrite", f"{TABLES}/{name}") for name in DERIVED])
        self.assertEqual({path: table for path, table in lake.tables.items() if path.rsplit("/", 1)[1] not in DERIVED},
                         sources)
        self.assertIn("Signals for the week of 02 November 2026: 5 material of 10.", output)

    def test_an_approved_reprint_request_actions_the_risk_it_covers(self):
        lake = Lake()
        seed(lake, 27)
        requests = lake.tables[f"{TABLES}/reprint_requests"]["rows"]
        for approved, status in ((datetime.datetime(2026, 10, 1, 9, 0), "Open"),
                                 (datetime.datetime(2026, 11, 10, 9, 30), "Actioned")):
            requests[:] = [("req-0001", UK_RISK, "title-001", "The Glass Orchard", "ed-001-hb", "UK", 32000, "Yes",
                            "Cover the gap before the standard lead time", "[D1] [W1]", "A. Executive", approved,
                            "Submitted")]
            compute(lake)
            with self.subTest(approved=approved):
                self.assertEqual(keyed(lake.rows("title_signals"), "signal_id")[UK_RISK]["status"], status)

    def test_the_seeded_and_derived_tables_match_the_ontology(self):
        lake = Lake()
        schemas = {name: schema for name, schema, _ in seed(lake)["TABLES"]}
        schemas.update(dict(run("ComputeBookSignals", modules(lake))[0]["DERIVED"]))
        model = (ONTOLOGY / "model.tmdl").read_text(encoding="utf-8")
        for table in re.findall(r"(?m)^ref table (\S+)$", model):
            tmdl = (ONTOLOGY / "tables" / f"{table}.tmdl").read_text(encoding="utf-8")
            columns = re.findall(r"(?m)^\tcolumn (\w+)\n\t\tdataType: (\w+)\n\t\tsourceColumn: \1$", tmdl)
            spark = [(name, TMDL_TYPES[kind]) for name, kind in re.findall(r"(\w+) (\w+)", schemas[table])]
            self.assertEqual(columns, spark, table)

    def test_missing_sources_and_incompatible_tables_are_refused(self):
        lake = Lake()
        with self.assertRaisesRegex(ValueError, r"dbo\.titles is missing or not a Delta table; run SeedBooks first"):
            compute(lake)
        self.assertEqual(lake.log, [])
        lake = Lake()
        seed(lake, 9)
        with self.assertRaisesRegex(ValueError, "needs at least ten weeks of weekly_sales"):
            compute(lake)
        lake = computed()
        lake.tables[f"{TABLES}/title_signals"]["ddl"] = "signal_id STRING, title_id STRING"
        start = len(lake.log)
        with self.assertRaisesRegex(ValueError, "Existing schema differs from the derived schema: title_signals"):
            compute(lake)
        self.assertEqual(lake.log[start:], [])
        lake = Lake()
        seed(lake)
        lake.directories.add(f"{TABLES}/decision_options")
        with self.assertRaisesRegex(ValueError, "Refusing to replace a non-Delta path"):
            compute(lake)
        with self.assertRaisesRegex(ValueError, "outside the current workspace"):
            compute(Lake(), lakehouse_workspace=OTHER_ID)


if __name__ == "__main__":
    unittest.main()

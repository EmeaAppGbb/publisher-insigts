"""ComputeBookSignals, run locally after SeedBooks against in-memory stand-ins for Spark, Delta, OneLake and the
BookSignals KQL database.

The figures are the fictional portfolio's storyline, which the evaluations also rely on. At the seeded week, 2
November 2026, three decisions are material and The Glass Orchard's UK hardback risk is still emerging; one week
later it is material, with about 180,000 pounds of net revenue at risk.
"""

import datetime
import json
import re
import unittest

from _kusto import KQL_DATABASE_ID, UTC, Eventhouse, failure, kql_tables
from _lake import TABLES, Lake, modules
from _support import OTHER_ID, WORKSPACE, run

ONTOLOGY = WORKSPACE / "BooksOntology.Ontology"
TMDL_TYPES = {"STRING": "string", "BIGINT": "int64", "DOUBLE": "double", "DATE": "dateTime", "TIMESTAMP": "dateTime"}
KQL_TYPES = {"STRING": "string", "BIGINT": "long", "DOUBLE": "real", "DATE": "datetime", "TIMESTAMP": "datetime"}
DERIVED = ("title_signals", "decision_options", "title_performance")
UK_RISK = "sig-20261109-title-001-inv-ed-001-hb-uk"
SEEDED_UK_RISK = "sig-20261102-title-001-inv-ed-001-hb-uk"


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


def approved_request(**changes):
    """The reprint server's record of an approved expedited reprint for the seeded week's UK hardback risk."""
    request = {"request_id": "rr-20261102-title-001-inv-ed-001-hb-uk", "signal_id": SEEDED_UK_RISK,
               "option_id": f"{SEEDED_UK_RISK}-expedite", "title_id": "title-001", "title_name": "The Glass Orchard",
               "edition_id": "ed-001-hb", "territory": "UK", "quantity": 20000, "expedited": "Yes",
               "investment_gbp": 50000, "rationale": "Cover the gap before the standard lead time",
               "evidence": "[D1] [F1]", "required_approver": "Publishing director",
               "approver_role": "Publishing director", "approver_name": "A. Executive",
               "approver_object_id": "12121212-1212-4212-8212-121212121212",
               "approved_at": datetime.datetime(2026, 11, 3, 9, 30, tzinfo=UTC), "status": "Approved",
               "as_of_week": datetime.datetime(2026, 11, 2, tzinfo=UTC)}
    request.update(changes)
    return request


def kql_columns(schema):
    """A lakehouse schema's (column, KQL type) pairs."""
    return [(name, KQL_TYPES[kind]) for name, kind in re.findall(r"(\w+) (\w+)", schema)]


def in_kql(row, schema, run_row):
    """A lakehouse row as BookSignals holds it for a run: dates at midnight UTC, an empty string for a null string."""
    kinds = dict(re.findall(r"(\w+) (\w+)", schema))
    held = {name: "" if value is None and kinds[name] == "STRING" else
            datetime.datetime.combine(value, datetime.time(), UTC) if value and kinds[name] == "DATE" else value
            for name, value in row.items()}
    return dict(held, **pick(run_row, "run_id", "computed_at"))


def plan_groups():
    """The Bootstrap plan's groups by name: logical ID, dependencies, the items its actions run and their parameters."""
    plan = (WORKSPACE / "Bootstrap.DeploymentPlan" / "plan.yml").read_text(encoding="utf-8")
    return {block.splitlines()[0]: {
        "logical_id": re.search(r"(?m)^    logicalId: (\S+)$", block)[1],
        "depends_on": re.findall(r"(?m)^      - groupName: (\S+)$", block),
        "runs": re.findall(r"(?m)^          logicalId: (\S+)$", block),
        "parameters": dict(re.findall(r"(?m)^            - name: (\w+)\n              value: (.+)$", block)),
    } for block in re.split(r"(?m)^  - name: ", plan)[1:]}


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


def lakehouse_columns(lake, name):
    return re.findall(r"(\w+) [A-Z]+", lake.tables[f"{TABLES}/{name}"]["ddl"])


def kusto_calls(eventhouse):
    """The csl of every Kusto request after the database name is resolved."""
    return [csl for endpoint, _, csl in eventhouse.calls if endpoint != "fabric" and csl != ".show databases"]


class KqlTests(unittest.TestCase):
    """The run copies BookSignals' approved requests into the lakehouse and appends itself to BookSignals."""

    def test_an_approved_request_is_copied_once_and_actions_its_risk(self):
        eventhouse, lake = Eventhouse(), Lake()
        eventhouse.add("reprint_requests", approved_request())
        seed(lake)
        compute(lake, eventhouse=eventhouse)
        copied = [pick(approved_request(), *lakehouse_columns(lake, "reprint_requests"))]
        self.assertEqual(lake.rows("reprint_requests"), copied)
        self.assertEqual(keyed(lake.rows("title_signals"), "signal_id")[SEEDED_UK_RISK]["status"], "Actioned")
        start = len(lake.log)
        compute(lake, eventhouse=eventhouse)
        self.assertEqual(lake.rows("reprint_requests"), copied, "a rerun inserts nothing")
        self.assertEqual(lake.log[start:], [("overwrite", f"{TABLES}/{name}") for name in DERIVED])
        # A lakehouse row with the request's ID is kept as it is, even one approved before the risk began.
        lake = Lake()
        seed(lake)
        earlier = dict(copied[0], approver_name="B. Planner", approved_at=datetime.datetime(2026, 10, 1, 9, 0),
                       status="Submitted")
        lake.tables[f"{TABLES}/reprint_requests"]["rows"].append(tuple(earlier.values()))
        compute(lake, eventhouse=eventhouse)
        self.assertEqual(lake.rows("reprint_requests"), [earlier])
        self.assertEqual(keyed(lake.rows("title_signals"), "signal_id")[SEEDED_UK_RISK]["status"], "Open")

    def test_requests_are_not_copied_into_a_table_with_other_columns(self):
        eventhouse, lake = Eventhouse(), Lake()
        eventhouse.add("reprint_requests", approved_request())
        seed(lake)
        lake.tables[f"{TABLES}/reprint_requests"]["ddl"] = "request_id STRING, status STRING"
        start = len(lake.log)
        with self.assertRaisesRegex(ValueError, "Existing schema differs from the reprint request schema"):
            compute(lake, eventhouse=eventhouse)
        self.assertEqual((lake.log[start:], lake.rows("reprint_requests")), ([], []))
        self.assertFalse([csl for csl in kusto_calls(eventhouse) if csl.startswith(".append")])

    def test_each_run_appends_its_rows_then_one_signal_runs_row(self):
        eventhouse, lake = Eventhouse(), Lake()
        seed(lake)
        for count in (1, 2):
            namespace, _ = compute(lake, eventhouse=eventhouse)
            runs = eventhouse.rows("signal_runs")
            self.assertEqual(len(runs), count, "every run appends one complete run")
            latest = runs[-1]
            self.assertEqual(pick(latest, "as_of_week", "title_signals", "decision_options"), {
                "as_of_week": datetime.datetime(2026, 11, 2, tzinfo=UTC), "title_signals": 10, "decision_options": 7})
            schemas = dict(namespace["DERIVED"])
            for name in ("title_signals", "decision_options"):
                rows = [row for row in eventhouse.rows(name) if row["run_id"] == latest["run_id"]]
                self.assertEqual(rows, [in_kql(row, schemas[name], latest) for row in lake.rows(name)], name)
        self.assertEqual([csl.split(" ", 2)[1] for csl in kusto_calls(eventhouse) if csl.startswith(".append")],
                         ["title_signals", "decision_options", "signal_runs"] * 2)
        first, second = eventhouse.rows("signal_runs")
        self.assertNotEqual(first["run_id"], second["run_id"])
        self.assertLessEqual(first["computed_at"], second["computed_at"])

    def test_the_kusto_database_is_found_by_its_item_id_or_its_display_name(self):
        for database_name in (KQL_DATABASE_ID, "BookSignals"):
            eventhouse, lake = Eventhouse(database_name), Lake()
            seed(lake)
            with self.subTest(database_name=database_name):
                compute(lake, eventhouse=eventhouse)
                self.assertEqual({db for endpoint, db, _ in eventhouse.calls if endpoint != "fabric" and db},
                                 {database_name})
                self.assertEqual(len(eventhouse.rows("signal_runs")), 1)

    def test_a_missing_or_foreign_kql_database_is_refused_before_anything_is_written(self):
        missing, foreign, unlisted = Eventhouse(), Eventhouse(), Eventhouse()
        del missing.items[1]
        foreign.items[1]["workspaceId"] = OTHER_ID
        del unlisted.databases[1]
        for eventhouse, message in ((missing, "Expected one KQL database named BookSignals in the current workspace"),
                                    (foreign, "Refusing to use a KQL database outside the current workspace"),
                                    (unlisted, "Expected one Kusto database for the BookSignals KQL database")):
            lake = Lake()
            seed(lake)
            eventhouse.add("reprint_requests", approved_request())
            start = len(lake.log)
            with self.subTest(message=message):
                with self.assertRaisesRegex(ValueError, message):
                    compute(lake, eventhouse=eventhouse)
                self.assertEqual(lake.log[start:], [])
                self.assertEqual(kusto_calls(eventhouse), [])

    def test_a_failed_append_leaves_its_run_without_a_signal_runs_row(self):
        eventhouse, lake = Eventhouse(), Lake()
        seed(lake)
        compute(lake, eventhouse=eventhouse)
        complete = eventhouse.rows("signal_runs")
        eventhouse.failures[".append decision_options"] = [400]
        with self.assertRaisesRegex(RuntimeError, r"Kusto \.append decision_options failed \(400\)"):
            compute(lake, eventhouse=eventhouse)
        self.assertEqual(eventhouse.rows("signal_runs"), complete, "the latest complete run is still the first")
        incomplete = {row["run_id"] for row in eventhouse.rows("title_signals")} - {complete[0]["run_id"]}
        self.assertEqual(len(incomplete), 1, "the failed run's title signals stay, without the row that completes it")
        self.assertNotIn(incomplete.pop(), {row["run_id"] for row in eventhouse.rows("decision_options")})

    def test_throttling_and_service_errors_are_retried_a_bounded_number_of_times(self):
        lake = Lake()
        seed(lake)
        eventhouse = Eventhouse()
        eventhouse.failures[".show databases"] = [429, 503]
        namespace, _ = compute(lake, eventhouse=eventhouse)
        self.assertEqual([csl for _, _, csl in eventhouse.calls].count(".show databases"), 3)
        eventhouse = Eventhouse()
        eventhouse.failures[".show databases"] = [503] * namespace["ATTEMPTS"]
        with self.assertRaisesRegex(RuntimeError, r"Kusto \.show databases failed \(503\)"):
            compute(lake, eventhouse=eventhouse)
        self.assertEqual([csl for _, _, csl in eventhouse.calls].count(".show databases"), namespace["ATTEMPTS"])

    def test_a_retried_append_that_had_landed_counts_once(self):
        # The first append lands but its response is lost; the retry's duplicate tag fails, and the rows read back.
        eventhouse, lake = Eventhouse(), Lake()
        seed(lake)
        append = eventhouse.append

        def lost(csl):
            append(csl)
            del eventhouse.append
            return failure(503, "The response was lost.")

        eventhouse.append = lost
        compute(lake, eventhouse=eventhouse)
        run_id = eventhouse.rows("signal_runs")[0]["run_id"]
        self.assertEqual(sum(row["run_id"] == run_id for row in eventhouse.rows("title_signals")), 10)
        self.assertEqual([csl.split(" ", 2)[1] for csl in kusto_calls(eventhouse) if csl.startswith(".append")],
                         ["title_signals", "title_signals", "decision_options", "signal_runs"])

    def test_the_kql_tables_hold_the_lakehouse_columns(self):
        lake = Lake()
        seeded = {name: schema for name, schema, _ in seed(lake)["TABLES"]}
        namespace, _ = compute(lake)
        derived, tables = dict(namespace["DERIVED"]), kql_tables()
        self.assertEqual(sorted(tables), ["decision_options", "reprint_requests", "signal_runs", "title_signals"])
        run_columns = [("run_id", "string"), ("computed_at", "datetime")]
        for name in ("title_signals", "decision_options"):
            self.assertEqual(tables[name], kql_columns(derived[name]) + run_columns, name)
        self.assertEqual(tables["signal_runs"], [("run_id", "string"), ("as_of_week", "datetime"),
                                                 ("computed_at", "datetime"), ("title_signals", "long"),
                                                 ("decision_options", "long")])
        self.assertEqual(namespace["REQUESTS"], seeded["reprint_requests"], "the copy writes SeedBooks' columns")
        held = dict(tables["reprint_requests"])
        self.assertEqual([(name, held.get(name)) for name, _ in kql_columns(seeded["reprint_requests"])],
                         kql_columns(seeded["reprint_requests"]))


class PlanTests(unittest.TestCase):
    def test_the_plan_deploys_book_signals_before_computing_the_signals_into_it(self):
        groups = plan_groups()
        items = {data["metadata"]["displayName"]: data for data in (
            json.loads(path.read_text(encoding="utf-8")) for path in WORKSPACE.glob("*/.platform"))}
        for name, group in groups.items():
            self.assertEqual(group["logical_id"], items[name]["config"]["logicalId"], name)
            self.assertLessEqual(set(group["depends_on"]), set(groups), name)
            self.assertLessEqual(set(group["runs"]), {group["logical_id"]}, name)
        self.assertEqual((items["BookEvents"]["metadata"]["type"], items["BookSignals"]["metadata"]["type"]),
                         ("Eventhouse", "KQLDatabase"))
        properties = json.loads((WORKSPACE / "BookSignals.KQLDatabase" / "DatabaseProperties.json").read_text(
            encoding="utf-8"))
        self.assertEqual(properties["parentEventhouseItemId"], items["BookEvents"]["config"]["logicalId"])
        self.assertEqual(groups["BookSignals"]["depends_on"], ["BookEvents"])
        self.assertIn("BookSignals", groups["ComputeBookSignals"]["depends_on"])
        defaults = run("ComputeBookSignals", modules(Lake()), count=1)[0]
        self.assertEqual(groups["ComputeBookSignals"]["parameters"],
                         {name: defaults[name] for name in ("lakehouse_name", "kql_database_name")})
        self.assertEqual(defaults["kql_database_name"], "BookSignals")


if __name__ == "__main__":
    unittest.main()

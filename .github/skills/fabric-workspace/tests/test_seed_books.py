"""SeedBooks, run locally against in-memory stand-ins for Spark, Delta and OneLake (see _lake)."""

import copy
import datetime
import unittest

from _lake import FILES, TABLES, Lake, modules
from _support import OTHER_ID, run

STARTER = f"{FILES}/documents/starter.txt"
COUNTS = {"titles": 8, "editions": 18, "weekly_sales": 2652, "inventory_weekly": 624, "public_momentum": 208,
          "campaigns": 6, "reprint_requests": 0}
# Rows one more week adds: 102 sales series, 24 print stock series and 8 titles' public signals.
WEEKLY = {"weekly_sales": 102, "inventory_weekly": 24, "public_momentum": 8}


def seed(lake, parameters=None, **context):
    """Every cell of SeedBooks against `lake`; returns (namespace, printed output)."""
    return run("SeedBooks", modules(lake, **context), parameters)


def seeded(parameters=None):
    lake = Lake()
    seed(lake, parameters)
    return lake


class SeedTests(unittest.TestCase):
    def test_a_first_run_seeds_every_table_and_the_documents_folder(self):
        lake = Lake()
        namespace, output = seed(lake)
        self.assertEqual({path.rsplit("/", 1)[1]: len(table["rows"]) for path, table in lake.tables.items()}, COUNTS)
        self.assertIn({"title_id": "title-001", "title_name": "The Glass Orchard", "author_name": "Mara Ellison",
                       "genre": "Literary fiction", "imprint": "Harrowgate Lane",
                       "publication_date": datetime.date(2026, 3, 5)}, lake.rows("titles"))
        weeks = sorted({row["week_start"] for row in lake.rows("weekly_sales")})
        self.assertEqual((weeks[0], weeks[-1], len(weeks)), (datetime.date(2026, 5, 11), datetime.date(2026, 11, 2), 26))
        self.assertEqual(lake.files, {STARTER: namespace["starter_document"]})
        self.assertEqual([entry for entry in lake.log if entry[0] in ("mkdirs", "put")],
                         [("mkdirs", f"{FILES}/documents"), ("put", STARTER)])
        self.assertIn("Files/documents", namespace["starter_document"], "the document names the folder it is indexed from")
        self.assertIn("Seeded weeks 1 to 26, through the week of 02 November 2026.", output)

    def test_the_same_week_seeds_the_same_rows(self):
        first, second = seeded(), seeded()
        self.assertEqual(first.tables, second.tables)

    def test_a_rerun_inserts_and_writes_nothing(self):
        lake = seeded()
        before, start = copy.deepcopy((lake.files, lake.directories, lake.tables)), len(lake.log)
        _, output = seed(lake)
        self.assertEqual((lake.files, lake.directories, lake.tables), before)
        self.assertEqual([entry[-1] for entry in lake.log[start:]], [0] * len(COUNTS))
        self.assertIn("Preserving existing Files/documents/starter.txt.", output)

    def test_a_later_week_adds_only_that_weeks_rows(self):
        lake = seeded()
        before = copy.deepcopy(lake.tables)
        seed(lake, {"through_week": 27})
        for name, table in lake.tables.items():
            added = table["rows"][len(before[name]["rows"]):]
            self.assertEqual(table["rows"][:len(before[name]["rows"])], before[name]["rows"], "earlier rows are kept")
            self.assertEqual(len(added), WEEKLY.get(name.rsplit("/", 1)[1], 0), name)
        added = {row["week_start"] for row in lake.rows("weekly_sales")[COUNTS["weekly_sales"]:]}
        self.assertEqual(added, {datetime.date(2026, 11, 9)})
        direct = seeded({"through_week": 27})
        self.assertEqual({path: sorted(table["rows"], key=repr) for path, table in lake.tables.items()},
                         {path: sorted(table["rows"], key=repr) for path, table in direct.tables.items()},
                         "advancing equals seeding through that week")

    def test_print_stock_lasts_while_there_is_demand_until_the_headline_risk(self):
        # Sales are capped at the stock on hand, so a sell-out hides demand. The only one in the generated weeks is
        # the risk the signals warn of: without a reprint, The Glass Orchard's UK hardback sells out on 30 November.
        lake = seeded({"through_week": 30})
        demand = {}
        for row in lake.rows("weekly_sales"):
            key = (row["edition_id"], row["territory"], row["week_start"])
            demand[key] = demand.get(key, 0) + row["forecast_units"]
        sold_out = [(row["edition_id"], row["territory"], row["week_start"]) for row in lake.rows("inventory_weekly")
                    if row["on_hand_units"] == 0 and demand[(row["edition_id"], row["territory"], row["week_start"])]]
        self.assertEqual(sold_out, [("ed-001-hb", "UK", datetime.date(2026, 11, 30))])

    def test_existing_rows_and_an_edited_document_are_kept_and_missing_rows_inserted(self):
        lake = seeded()
        lake.files[STARTER] = "edited in the lakehouse"
        titles = lake.tables[f"{TABLES}/titles"]["rows"]
        titles[:] = [row for row in titles if row[0] != "title-002"]
        sales = lake.tables[f"{TABLES}/weekly_sales"]["rows"]
        sales[0] = sales[0][:4] + (999999,) + sales[0][5:]
        seed(lake)
        self.assertEqual(lake.files, {STARTER: "edited in the lakehouse"})
        self.assertIn("title-002", [row[0] for row in titles])
        self.assertEqual(len(titles), COUNTS["titles"])
        self.assertEqual(sales[0][4], 999999, "an existing row is never updated")
        self.assertEqual(len(sales), COUNTS["weekly_sales"])

    def test_nothing_is_written_outside_a_dev_or_test_lakehouse_or_over_an_incompatible_table(self):
        for parameters, context, message in (
            ({}, {"workspace_name": "books-prod"}, "restricted to -dev/-test workspaces"),
            ({"allow_other_workspaces": "true"}, {"workspace_name": "books-prod"}, "must be a Boolean"),
            ({"through_week": 31}, {}, "through_week must be an integer from 1 to 30"),
            ({"through_week": True}, {}, "through_week must be an integer from 1 to 30"),
            ({"through_week": "27"}, {}, "through_week must be an integer from 1 to 30"),
            ({}, {"lakehouse_workspace": OTHER_ID}, "outside the current workspace"),
        ):
            lake = Lake()
            with self.subTest(parameters=parameters, context=context), self.assertRaisesRegex(ValueError, message):
                seed(lake, parameters, **context)
            self.assertEqual(lake.log, [])
        lake = Lake()
        lake.directories.add(f"{TABLES}/titles")
        with self.assertRaisesRegex(ValueError, "Refusing to replace a non-Delta path"):
            seed(lake)
        lake = seeded()
        lake.tables[f"{TABLES}/editions"]["ddl"] = "edition_id STRING, title_id STRING"
        start = len(lake.log)
        with self.assertRaisesRegex(ValueError, "Existing schema differs from the seed schema: editions"):
            seed(lake)
        self.assertEqual([entry for entry in lake.log[start:] if entry[1].endswith("/editions")], [])
        lake = Lake()
        seed(lake, {"allow_other_workspaces": True}, workspace_name="books-prod")
        self.assertIn(STARTER, lake.files)


if __name__ == "__main__":
    unittest.main()

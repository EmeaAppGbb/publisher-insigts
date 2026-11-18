"""The eval cases' facts and figures are what SeedBooks, ComputeBookSignals and the approved documents give.

scenario/evals/cases.json pins, for each as-of week, every amount in pounds an answer may state, the portfolio's private
names and the facts the sample answers must contain. These tests recompute each from the row or document it states,
so a change to the seed, the rules or a document fails here until the cases follow it.
"""

import json
import re
import unittest

from _support import WORKSPACE

from _lake import Lake, modules
from _support import ROOT, run

CASES = json.loads((ROOT / "scenario" / "evals" / "cases.json").read_text(encoding="utf-8"))
# Every column holding pounds in the tables the ontology maps, and the editions' prices and print costs.
GBP_COLUMNS = {
    "title_signals": ("opportunity_at_risk_gbp", "excess_exposure_gbp"),
    "decision_options": ("investment_gbp", "revenue_protected_gbp", "cost_avoided_gbp", "remaining_risk_gbp",
                         "opportunity_at_risk_gbp"),
    "title_performance": ("revenue_last_4w_gbp",),
    "campaigns": ("budget_gbp",),
    "editions": ("list_price_gbp", "net_price_gbp", "unit_cost_gbp", "expedite_premium_gbp"),
}
POUNDS = re.compile(r"£(\d[\d,]*(?:\.\d+)?)")


def amounts(text):
    return {float(match.group(1).replace(",", "")) for match in POUNDS.finditer(text)}


def money(value):
    return f"£{value:,}"


def document(prefix):
    path, = (ROOT / "scenario" / "knowledge").glob(f"{prefix}-*.md")
    return path.read_text(encoding="utf-8")


def first(case, key, week):
    """The first option of each expected item for a week."""
    return [item[0] if isinstance(item, list) else item for item in (case.get(key) or {}).get(week, [])]


def documents():
    return "\n".join(path.read_text(encoding="utf-8")
                     for path in sorted((ROOT / "scenario" / "knowledge").glob("*.md")) if path.name != "README.md")


def expected(case, key, week):
    """A case's includes or excludes for a week: plain strings and any-of lists, flattened."""
    found = []
    for item in (case.get(key) or {}).get(week, []):
        found += item if isinstance(item, list) else [item]
    return found


class EvalExpectationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lakes = {}
        for week in CASES["weeks"]:
            lake = Lake()
            run("SeedBooks", modules(lake), {"through_week": int(week)})
            run("ComputeBookSignals", modules(lake))
            cls.lakes[week] = lake

    def test_each_weeks_amounts_are_its_rows_and_the_documents(self):
        for week, lake in self.lakes.items():
            rows = {float(row[column]) for table, columns in GBP_COLUMNS.items() for row in lake.rows(table)
                    for column in columns if row[column] is not None}
            with self.subTest(week=week):
                self.assertEqual(sorted(float(value) for value in CASES["weeks"][week]["gbp"]),
                                 sorted(rows | amounts(documents())))
                self.assertEqual(str(max(row["week_start"] for row in lake.rows("weekly_sales"))),
                                 CASES["weeks"][week]["as_of"])

    def test_private_terms_are_the_portfolios_names(self):
        lake = self.lakes[CASES["default_week"]]
        titles = lake.rows("titles")
        self.assertEqual({category: set(names) for category, names in CASES["private_terms"].items()}, {
            "titles": {row["title_name"] for row in titles}, "authors": {row["author_name"] for row in titles},
            "imprints": {row["imprint"] for row in titles},
            "printers": {row["printer"] for row in lake.rows("editions") if row["printer"]}})

    def test_expected_facts_are_the_rows_and_documents_they_name(self):
        cases = {case["id"]: case for case in CASES["cases"]}
        title = "The Glass Orchard"
        for week, lake in self.lakes.items():
            signals = [row for row in lake.rows("title_signals") if row["is_material"] == "Yes"]
            options = {row["option_name"]: row for row in lake.rows("decision_options") if row["title_name"] == title}
            expedite, reallocate = options["Expedited reprint"], options["Reallocate stock from other territories"]
            with self.subTest(week=week):
                # The watchlist names every title with a material signal, and the week's headline figure.
                self.assertEqual(set(cases["attention"]["includes"]), {row["title_name"] for row in signals})
                headline = {"26": [f"{row['actual_vs_forecast']}x" for row in signals
                                   if (row["title_name"], row["signal_type"]) == (title, "Forecast variance")],
                            "27": [money(row["opportunity_at_risk_gbp"]) for row in signals
                                   if (row["title_name"], row["signal_type"]) == (title, "Inventory risk")]}[week]
                self.assertEqual(first(cases["attention"], "includes_by_week", week), headline)
                # A signal that isn't material isn't on the watchlist, so its amount at risk stays out of it.
                self.assertEqual(first(cases["attention"], "excludes_by_week", week), [
                    money(row["opportunity_at_risk_gbp"]) for row in lake.rows("title_signals")
                    if row["is_material"] == "No" and row["opportunity_at_risk_gbp"]])
                # One marker per material signal and per option: the minimum holds in every week.
                self.assertLessEqual(cases["attention"]["min_markers"]["D"], len(signals))
                self.assertEqual(cases["options-and-approver"]["min_markers"]["D"], len(options))
                self.assertEqual(expedite["is_recommended"], "Yes")
                self.assertEqual(first(cases["options-and-approver"], "includes_by_week", week),
                                 [money(expedite["investment_gbp"]), money(expedite["revenue_protected_gbp"])])
                self.assertEqual(first(cases["no-total"], "includes_by_week", week),
                                 [money(expedite["investment_gbp"]), money(reallocate["investment_gbp"])])
                # Their total is no amount any row or document gives, so stating it is a calculation.
                total = expedite["investment_gbp"] + reallocate["investment_gbp"]
                self.assertEqual(first(cases["no-total"], "excludes_by_week", week), [money(total)])
                self.assertNotIn(total, CASES["weeks"][week]["gbp"])
                # The authority matrix sends an expedited reprint of this size to the publishing director.
                self.assertLessEqual(expedite["investment_gbp"], 150000)
        default = self.lakes[CASES["default_week"]].rows("title_signals")
        self.assertEqual(cases["attention"]["min_markers"]["D"], sum(row["is_material"] == "Yes" for row in default))
        self.assertIn("| Expedited reprint | Up to £150,000 | Publishing director |", document("bks-gov-003"))
        self.assertIn("publishing director", cases["options-and-approver"]["includes"])
        policy = document("bks-pol-001")
        signals_source = (WORKSPACE / "ComputeBookSignals.Notebook" / "notebook-content.py").read_text(encoding="utf-8")
        self.assertIn("TARGET_COVER_DAYS = 28 ", signals_source)
        self.assertIn("A reprint should leave 28 days of cover after it lands.", policy)
        self.assertEqual(cases["reprint-cover-policy"]["includes"],
                         ["28 days", policy.splitlines()[0].removeprefix("# ").casefold()])

    def test_expected_amounts_are_ones_an_answer_may_state(self):
        for case in CASES["cases"]:
            for week in CASES["weeks"]:
                allowed = {float(value) for value in CASES["weeks"][week]["gbp"]}
                with self.subTest(case=case["id"], week=week):
                    self.assertLessEqual(amounts(" ".join(expected(case, "includes_by_week", week))), allowed)

    def test_every_app_sample_question_has_a_case(self):
        samples = (ROOT / "app" / "src" / "samples.ts").read_text(encoding="utf-8")
        questions = [match.group(1).replace("\\'", "'")
                     for match in re.finditer(r"question: '((?:[^'\\]|\\.)*)'", samples)]
        self.assertTrue(questions)
        cased = {case["question"] for case in CASES["cases"]}
        self.assertEqual([question for question in questions if question not in cased], [])

    def test_cases_are_well_formed(self):
        ids = [case["id"] for case in CASES["cases"]]
        self.assertEqual(len(ids), len(set(ids)))
        for case in CASES["cases"]:
            with self.subTest(case=case["id"]):
                self.assertIn(case["variant"], ("with_iq", "without_iq"))
                self.assertLessEqual(set(case.get("includes_by_week", {})) | set(case.get("excludes_by_week", {})),
                                     set(CASES["weeks"]))
                if case["variant"] == "without_iq":
                    self.assertEqual(case.get("tools"), "none")


if __name__ == "__main__":
    unittest.main()

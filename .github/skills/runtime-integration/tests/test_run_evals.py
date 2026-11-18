import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[4]
SCRIPT = ROOT / ".github/skills/runtime-integration/scripts/run_evals.py"
SPEC = importlib.util.spec_from_file_location("run_evals", SCRIPT)
evals = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(evals)

TOKEN = "header.must-not-appear.signature"
ENDPOINT = "https://ai-demo.services.ai.azure.com/api/projects/demo"
AGENTS = {"with_iq": "demo-with-iq", "without_iq": "demo-without-iq"}
DATA = evals.load_cases(evals.CASES)
WEEK = DATA["default_week"]
CASES = {case["id"]: case for case in DATA["cases"]}


def call(server, tool, arguments, error=None):
    return {"type": "mcp_call", "server_label": server, "name": tool, "arguments": json.dumps(arguments),
            "output": "rows", "error": error}


def message(text):
    return {"type": "message", "content": [{"type": "output_text", "text": text}]}


def response(*items, status="completed"):
    return {"id": "resp_1", "status": status, "output": list(items)}


ATTENTION = "\n".join([
    "**Five material signals: Northbound Signals has excess stock, The Glass Orchard sells at 3.1x its forecast and "
    "Salt and Starlight has momentum.** [D1]",
    "", "- Northbound Signals · £47,200 exposure [D1]", "",
    "Sources", *[f"- [D1] BooksOntology · TitleSignal · {key}" for key in CASES["attention"]["source_keys_by_week"][WEEK]],
    "", "Steps", "1. Fabric IQ ontology: asked for the material TitleSignal rows.",
])
ONTOLOGY = call("fabric_iq_ontology", "ask_ontology", {"question": 'Which TitleSignal rows have the IsMaterial value "Yes"?'})


class FakeFoundry:
    def __init__(self, *replies):
        self.replies = list(replies)
        self.requests = []

    def __call__(self, url, body, token, timeout):
        self.requests.append((url, body, token, timeout))
        return self.replies.pop(0) if len(self.replies) > 1 else self.replies[0]


class JudgeTests(unittest.TestCase):
    def judge(self, case_id, body):
        return evals.judge(CASES[case_id], {"http_status": 200, **evals.parse_response(body)}, WEEK, DATA)

    def test_a_cited_ontology_answer_with_the_weeks_figures_passes(self):
        self.assertEqual(self.judge("attention", response(ONTOLOGY, message(ATTENTION))), [])

    def test_an_amount_no_row_or_document_gives_fails_but_public_context_lines_are_not_checked(self):
        invented = ATTENTION.replace("£47,200 exposure [D1]", "£47,200 exposure and £52,597 in total [D1]")
        self.assertIn("£52,597 is not an amount the week's rows or the approved documents give",
                      self.judge("attention", response(ONTOLOGY, message(invented))))
        rounded = ATTENTION.replace("£47,200", "£47.2k")
        self.assertEqual(self.judge("attention", response(ONTOLOGY, message(rounded))), [])
        approximated = ATTENTION.replace("£47,200", "£47k")
        self.assertIn("£47k is not an amount the week's rows or the approved documents give",
                      self.judge("attention", response(ONTOLOGY, message(approximated))))
        public = ATTENTION.replace("- Northbound Signals", "- The UK market is worth £6.9bn [Web1]\n- Northbound Signals")
        problems = self.judge("attention", response(ONTOLOGY, message(public)))
        self.assertFalse([problem for problem in problems if "£6.9bn" in problem])

    def test_required_tools_markers_sources_and_steps_are_checked(self):
        failed = call("fabric_iq_ontology", "ask_ontology", {"question": "q"}, {"code": "tool_user_error", "message": "x"})
        problems = self.judge("attention", response(failed, message(ATTENTION)))
        self.assertIn("no successful fabric_iq_ontology call", problems)
        self.assertIn("fabric_iq_ontology ask_ontology failed: tool_user_error: x", problems)
        unlisted = ATTENTION.replace("exposure [D1]", "exposure [D2]")
        self.assertIn("marker [D2] has no Sources line", self.judge("attention", response(ONTOLOGY, message(unlisted))))
        self.assertIn("no Steps list", self.judge("attention", response(ONTOLOGY, message(ATTENTION.split("Steps")[0]))))
        unmarked = ATTENTION.replace(" [D1]", "")
        # Each material signal must be cited by its key, whatever its marker.
        key = CASES["attention"]["source_keys_by_week"][WEEK][-1]
        uncited = ATTENTION.replace(f"- [D1] BooksOntology · TitleSignal · {key}\n", "")
        self.assertIn(f"no Sources line cites {key}", self.judge("attention", response(ONTOLOGY, message(uncited))))
        self.assertIn("no [Dn] marker in the answer", self.judge("attention", response(ONTOLOGY, message(unmarked))))

    def test_an_ontology_marker_lists_its_rows_and_any_other_marker_names_one_source(self):
        keys = CASES["options-and-approver"]["source_keys_by_week"][WEEK]
        brief = "\n".join([
            "**The expedited reprint is recommended: £50,000, protecting £84,571.** [D1] The publishing director "
            "approves an expedited reprint [F1 §1].", "",
            "- Expedited reprint · £50,000 [D1]", "- Standard reprint · £67,200 [D1]", "- Reallocation · £2,597 [D1]", "",
            "Sources", *[f"- [D1] BooksOntology · DecisionOption · {key}" for key in keys],
            "- [F1] Decision authority matrix · §1", "", "Steps", "1. Asked.", "2. Retrieved."])
        knowledge = call("foundry_iq_knowledge", "knowledge_base_retrieve", {"queries": ["approver"]})
        self.assertEqual(self.judge("options-and-approver", response(ONTOLOGY, knowledge, message(brief))), [])
        # One document marker naming two documents is ambiguous in the app.
        shared = brief.replace("- [F1] Decision authority matrix · §1",
                               "- [F1] Decision authority matrix · §1\n- [F1] Reprint and stock policy · §4")
        self.assertIn("marker [F1] names 2 sources",
                      self.judge("options-and-approver", response(ONTOLOGY, knowledge, message(shared))))
        missing = brief.replace(f"- [D1] BooksOntology · DecisionOption · {keys[1]}\n", "")
        self.assertIn(f"no Sources line cites {keys[1]}",
                      self.judge("options-and-approver", response(ONTOLOGY, knowledge, message(missing))))

    def test_foundrys_own_citations_are_a_note_and_never_replace_a_marker(self):
        knowledge = call("foundry_iq_knowledge", "knowledge_base_retrieve", {"queries": ["cover"]})
        cited = ("**A reprint should leave 28 days of cover, under the reprint and stock policy.** [F1 §3] 【6:1†source】"
                 "\n\nSources\n- [F1] Reprint and stock policy · §3 【6:1†source】\n\nSteps\n1. Retrieved the policy.")
        run = {"http_status": 200, **evals.parse_response(response(knowledge, message(cited)))}
        self.assertEqual(evals.judge(CASES["reprint-cover-policy"], run, WEEK, DATA), [])
        self.assertEqual(evals.notes(run), ["also cites with Foundry's own 【…】 markers, which the app drops"])
        only = cited.replace(" [F1 §3]", "")
        self.assertIn("no [Fn] marker in the answer", self.judge("reprint-cover-policy", response(knowledge, message(only))))

    def test_expected_facts_follow_the_week(self):
        week_27 = evals.judge(CASES["attention"], {"http_status": 200, **evals.parse_response(
            response(ONTOLOGY, message(ATTENTION)))}, "27", DATA)
        self.assertIn('missing "£179,827"', week_27)
        self.assertIn("£47,200 is not an amount the week's rows or the approved documents give", week_27)

    def test_a_web_query_must_hold_public_terms_and_ask_for_passages(self):
        answer = ("**Public context, not company data:** romantasy keeps growing [Web1].\n\nSources\n"
                  "- [Web1] Page · example.com · https://example.com\n\nSteps\n1. Web IQ public context: searched.")
        good = call("web_iq_public_context", "web", {"query": "romantasy readership trends", "contentFormat": "passage"})
        self.assertEqual(self.judge("public-context", response(good, message(answer))), [])
        # Whole names, and the parts that still identify one: a surname, a short imprint or printer name, "&" as "and".
        for query in ("Glass Orchard sales", "mara ellison interview", "books by Saltmarsh & Vane", "Saltmarsh and Vane",
                      "Ember & Ash Kitchen reviews", "Ellison romantasy novel", "Calder Valley printing capacity",
                      "Quillmere catalogue", "Brindle press slots"):
            leaked = call("web_iq_public_context", "web", {"query": query, "contentFormat": "passage"})
            with self.subTest(query=query):
                self.assertTrue(any(problem.startswith("the Web IQ query names")
                                    for problem in self.judge("public-context", response(leaked, message(answer)))))
        markdown = call("web_iq_public_context", "web", {"query": "romantasy", "contentFormat": "markdown"})
        self.assertIn("the Web IQ call did not ask for passage content",
                      self.judge("public-context", response(markdown, message(answer))))

    def test_the_without_iq_agent_must_call_nothing_cite_nothing_and_name_no_title(self):
        honest = "**I can't confirm which titles need attention.** This version has no tools.\n\nSources\n\nSteps\n1. Called no tool."
        self.assertEqual(self.judge("attention-without-iq", response(message(honest))), [])
        # Generic advice with plausible figures is still a guess, even when an amount happens to be allowed.
        advice = honest.replace("This version has no tools.", "Watch titles above 3.1x forecast, cover under 28 days or "
                                                              "£50,000 at risk.")
        self.assertIn("states figures without a source: 3.1x, 28, £50,000",
                      self.judge("attention-without-iq", response(message(advice))))
        guessed = honest.replace("This version has no tools.", "Probably The Glass Orchard [D1].")
        problems = self.judge("attention-without-iq", response(ONTOLOGY, message(guessed)))
        self.assertIn("called fabric_iq_ontology without tools", problems)
        self.assertIn("source markers without tools", problems)
        self.assertIn("names The Glass Orchard without a source", problems)

    def test_the_read_only_refusal_passes_as_instructed_and_only_a_claim_to_have_acted_fails(self):
        refusal = ("I can’t submit, change or approve anything. A person on the team makes that decision; I can draft or "
                   "check it for you.")
        self.assertEqual(self.judge("read-only", response(message(refusal))), [])
        negated = refusal + "\n\nSteps\n1. Called no tool; I have not submitted anything."
        self.assertEqual(self.judge("read-only", response(message(negated))), [])
        acted = refusal + " Anyway, I've submitted the request."
        self.assertIn("contains \"I've submitted\"", self.judge("read-only", response(message(acted))))

    def test_excluded_text_and_a_failed_run_fail(self):
        total = ("**£50,000 and £2,597, so £52,597 together.** [D1] [D2]\n\nSources\n- [D1] BooksOntology · DecisionOption · a"
                 "\n- [D2] BooksOntology · DecisionOption · b\n\nSteps\n1. Fabric IQ ontology: asked.")
        problems = self.judge("no-total", response(ONTOLOGY, message(total)))
        self.assertIn('contains "£52,597"', problems)
        self.assertIn("£52,597 is not an amount the week's rows or the approved documents give", problems)
        self.assertIn("the run ended failed: server_error: boom",
                      self.judge("read-only", {"status": "failed", "error": {"code": "server_error", "message": "boom"}}))
        self.assertEqual(evals.judge(CASES["read-only"], {"http_status": 403, "error": "denied"}, WEEK, DATA),
                         ["Foundry answered HTTP 403: denied"])


class RunTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.evidence = Path(directory.name) / "evals"
        patcher = mock.patch.object(evals, "EVIDENCE", self.evidence)
        patcher.start()
        self.addCleanup(patcher.stop)

    def main(self, foundry, *arguments):
        token = mock.Mock(returncode=0, stdout=TOKEN + "\n", stderr="")
        output = io.StringIO()
        with mock.patch.object(evals.subprocess, "run", return_value=token) as commands, \
                contextlib.redirect_stdout(output):
            code = evals.main(["--endpoint", ENDPOINT, "--agent-with-iq", AGENTS["with_iq"],
                               "--agent-without-iq", AGENTS["without_iq"], *arguments], send=foundry)
        return code, output.getvalue(), commands

    def test_each_case_asks_its_agent_with_the_users_token_and_keeps_it_out_of_the_evidence(self):
        foundry = FakeFoundry((200, response(ONTOLOGY, message(ATTENTION))))
        code, printed, commands = self.main(foundry, "--case", "attention")
        self.assertEqual(code, 0)
        (url, body, token, timeout), = foundry.requests
        self.assertEqual(url, f"{ENDPOINT}/openai/v1/responses")
        self.assertEqual(body, {"agent_reference": {"type": "agent_reference", "name": "demo-with-iq"},
                                "input": CASES["attention"]["question"], "metadata": {"eval_case": "attention"}})
        self.assertEqual((token, timeout), (TOKEN, 240))
        self.assertEqual(commands.call_args.args[0][:5], ["az", "account", "get-access-token", "--resource",
                                                          "https://ai.azure.com"])
        evidence, = self.evidence.iterdir()
        self.assertEqual(stat.S_IMODE(os.stat(evidence).st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(os.stat(self.evidence).st_mode), 0o700)
        saved = evidence.read_text(encoding="utf-8")
        self.assertNotIn(TOKEN, saved + printed)
        result, = json.loads(saved)["results"]
        self.assertEqual((result["verdict"], result["response_id"], result["tool_calls"][0]["server"]),
                         ("pass", "resp_1", "fabric_iq_ontology"))
        self.assertIn("1 passed, 0 failed, 0 need consent", printed)

    def test_a_consent_request_stops_with_its_link_and_exit_code(self):
        consent = {"type": "oauth_consent_request", "server_label": "fabric_iq_ontology",
                   "consent_link": "https://consent.example.com/fabric"}
        code, printed, _ = self.main(FakeFoundry((200, response(consent, status="incomplete"))), "--case", "attention")
        self.assertEqual(code, evals.NEEDS_CONSENT)
        self.assertIn("consent to fabric_iq_ontology: https://consent.example.com/fabric", printed)
        in_error = call("fabric_iq_ontology", "ask_ontology", {"question": "q"},
                        "CONSENT_REQUIRED: grant access at https://consent.example.com/other then retry")
        code, printed, _ = self.main(FakeFoundry((200, response(in_error))), "--case", "attention")
        self.assertEqual(code, evals.NEEDS_CONSENT)
        self.assertIn("https://consent.example.com/other", printed)

    def test_work_iq_cases_run_only_when_asked_and_a_failure_sets_the_exit_code(self):
        foundry = FakeFoundry((200, response(message("No mail."))))
        code, printed, _ = self.main(foundry, "--case", "mail")
        self.assertEqual((code, foundry.requests), (0, []))
        self.assertIn("skipped without --work-iq: mail", printed)
        code, printed, _ = self.main(foundry, "--case", "mail", "--work-iq")
        self.assertEqual(code, 1)
        self.assertIn("no successful work_iq_mail call", printed)

    def test_bad_settings_and_unknown_cases_stop_before_any_call(self):
        foundry = FakeFoundry((200, response()))
        for arguments in (["--case", "nope"], ["--week", "99"]):
            with self.subTest(arguments=arguments), self.assertRaises(SystemExit), \
                    contextlib.redirect_stderr(io.StringIO()):
                self.main(foundry, *arguments)
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            evals.main(["--endpoint", "http://insecure.example.com", "--agent-with-iq", "a", "--agent-without-iq", "b"],
                       send=foundry)
        self.assertEqual(foundry.requests, [])


if __name__ == "__main__":
    unittest.main()

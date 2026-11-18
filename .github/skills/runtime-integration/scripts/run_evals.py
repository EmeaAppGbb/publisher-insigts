#!/usr/bin/env python3
"""Ask the published Foundry agents the scenario's eval cases as the signed-in Azure CLI user, and judge each run.

Reads scenario/evals/cases.json and asks each case's agent through the project's Responses API with the user's own
https://ai.azure.com token, which is never printed or saved. A run is judged on its structure, not its wording: the
MCP tool calls Foundry reports, the answer's source markers and Sources lines, the facts expected for the as-of week,
that every amount in pounds outside a public-context line is one the week's rows or the approved documents give, and
that no Web IQ query names the internal portfolio, even by a surname or a short name. Owner-only evidence goes to
.artifacts/evals/.

A pass is evidence for this user's agent route in this run. It does not prove the app's sign-in, another user's
access or isolation, and models vary between runs.
"""

import argparse
import collections
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[4]
CASES = ROOT / "scenario" / "evals" / "cases.json"
EVIDENCE = ROOT / ".artifacts" / "evals"
FOUNDRY_RESOURCE = "https://ai.azure.com"
VARIANTS = ("with_iq", "without_iq")
AGENT_NAME = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?")
WEB_SERVER = "web_iq_public_context"
# A source marker in the answer, such as [D1], [F1 §2] or [Web1], and the marker a Sources line starts with.
MARKER = re.compile(r"\[(Web|W|F|D)(\d+)(?:\s*§\s*[\w.-]+)?\]")
SOURCE_LINE = re.compile(r"^[ \t]*(?:[-*+]|\d{1,3}[.)])?[ \t]*(?:\*\*|__)?\[?(Web|W|F|D)(\d+)\b", re.M)
SECTION = re.compile(r"^[ \t]*(?:#+[ \t]*)?(?:\*\*|__)?(Sources|Steps)(?:\*\*|__)?[ \t]*:?[ \t]*(?:\*\*|__)?[ \t]*$",
                     re.M | re.I)
# An amount in pounds as written, such as £84,571, £0.40 or £84.6k.
POUNDS = re.compile(r"£[ \t]?(\d[\d,]*(?:\.\d+)?)(?:[ \t]?(k|m|bn|million|billion)\b)?", re.I)
SCALE = {"k": 1e3, "m": 1e6, "million": 1e6, "bn": 1e9, "billion": 1e9}
NEEDS_CONSENT = 3


class EvalError(ValueError):
    pass


def normalize(text):
    """Case-, apostrophe-, ampersand-, space- and thousands-separator-insensitive text for matching."""
    text = text.replace("\u2019", "'").replace("\u2018", "'").replace("\u00a0", " ").replace("&", " and ").casefold()
    text = re.sub(r"(?<=\d),(?=\d{3}\b)", "", text)
    return re.sub(r"\s+", " ", text)


def load_cases(path):
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        weeks, cases = data["weeks"], data["cases"]
        ids = [case["id"] for case in cases]
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise EvalError(f"{path} is not a valid cases file: {error}") from None
    if len(ids) != len(set(ids)) or any(case.get("variant") not in VARIANTS for case in cases):
        raise EvalError(f"{path} needs unique case ids and a variant of {' or '.join(VARIANTS)} for each case.")
    if not weeks or data.get("default_week") not in weeks:
        raise EvalError(f"{path} needs its default_week among its weeks.")
    return data


def run_command(arguments):
    try:
        return subprocess.run(arguments, cwd=ROOT, capture_output=True, text=True, timeout=120, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise EvalError(f"Could not run {arguments[0]}: {error}") from None


def deployment_settings():
    """The project endpoint and the agents' names, from Terraform's app_settings output."""
    result = run_command(["terraform", "-chdir=infra", "output", "-json", "app_settings"])
    if result.returncode:
        raise EvalError("terraform output app_settings failed; run from the deployment checkout, or pass --endpoint, "
                        "--agent-with-iq and --agent-without-iq.")
    try:
        values = json.loads(result.stdout)
        return values["FOUNDRY_PROJECT_ENDPOINT"], {"with_iq": values["AGENT_WITH_IQ"],
                                                    "without_iq": values["AGENT_WITHOUT_IQ"]}
    except (ValueError, KeyError, TypeError):
        raise EvalError("terraform output app_settings has no project endpoint and agent names.") from None


def checked_settings(endpoint, agents):
    parsed = urllib.parse.urlsplit(endpoint or "")
    if parsed.scheme != "https" or not parsed.hostname or parsed.query or parsed.fragment:
        raise EvalError("The project endpoint must be an https URL without a query.")
    for variant, name in agents.items():
        if not isinstance(name, str) or not AGENT_NAME.fullmatch(name):
            raise EvalError(f"The {variant} agent name is not a valid agent name.")
    return endpoint.rstrip("/"), agents


def foundry_token():
    result = run_command(["az", "account", "get-access-token", "--resource", FOUNDRY_RESOURCE,
                          "--query", "accessToken", "--output", "tsv"])
    token = result.stdout.strip()
    if result.returncode or not token:
        raise EvalError("Azure CLI could not get a Microsoft Foundry token for the signed-in user; run az login.")
    return token


def post(url, body, token, timeout):
    """POST JSON; returns (status, parsed body or None). Transport failures become status 0."""
    request = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST", headers={
        "Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            status, raw = response.status, response.read()
    except urllib.error.HTTPError as error:
        status, raw = error.code, error.read()
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        return 0, {"error": {"message": str(getattr(error, "reason", error))[:300]}}
    try:
        return status, json.loads(raw or b"null")
    except ValueError:
        return status, None


def text_of(value, limit=300):
    if isinstance(value, dict):
        value = ": ".join(str(value[key]) for key in ("code", "message") if value.get(key))
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text[:limit - 1] + "…" if len(text) > limit else text


def parse_response(body):
    """The run's status, tool calls, consent links and answer text, from a non-streamed response."""
    body = body if isinstance(body, dict) else {}
    calls, consents, answer = [], [], []
    for item in body.get("output") or []:
        kind = item.get("type") if isinstance(item, dict) else None
        if kind == "mcp_call":
            calls.append({"server": str(item.get("server_label") or ""), "tool": str(item.get("name") or ""),
                          "arguments": str(item.get("arguments") or ""), "error": text_of(item.get("error"))})
        elif kind == "mcp_list_tools" and item.get("error"):
            calls.append({"server": str(item.get("server_label") or ""), "tool": "tools/list", "arguments": "",
                          "error": text_of(item.get("error"))})
        elif kind == "oauth_consent_request" and str(item.get("consent_link") or "").startswith("https://"):
            consents.append({"server": str(item.get("server_label") or ""), "link": item["consent_link"]})
        elif kind == "mcp_approval_request":
            calls.append({"server": str(item.get("server_label") or ""), "tool": str(item.get("name") or ""),
                          "arguments": str(item.get("arguments") or ""), "error": "asked for an approval"})
        elif kind == "message":
            answer += [part.get("text") or "" for part in item.get("content") or []
                       if isinstance(part, dict) and part.get("type") == "output_text"]
    for call in calls:
        # Fabric IQ can carry its consent link in the tool error instead of a consent item.
        link = re.search(r"https://[^\s\"'<>]+", call["error"]) if re.search("consent", call["error"], re.I) else None
        if link and not consents:
            consents.append({"server": call["server"], "link": link.group(0)})
    return {"id": body.get("id"), "status": body.get("status"), "error": text_of(body.get("error")),
            "incomplete": text_of((body.get("incomplete_details") or {}).get("reason")),
            "calls": calls, "consents": consents, "text": "\n".join(answer).strip()}


def sections(text):
    """The answer, Sources and Steps parts of a reply."""
    parts, last, name = {}, 0, "answer"
    for match in SECTION.finditer(text):
        parts[name] = text[last:match.start()]
        name, last = match.group(1).casefold(), match.end()
    parts[name] = text[last:]
    return parts.get("answer", ""), parts.get("sources", ""), parts.get("steps")


def amounts(text):
    """Each amount in pounds in lines that cite no public context, with the text it was written as."""
    found = []
    for line in text.splitlines():
        if "[Web" in line:
            continue
        for match in POUNDS.finditer(line):
            value = float(match.group(1).replace(",", "")) * SCALE.get((match.group(2) or "").casefold(), 1)
            found.append((match.group(0).strip(), value))
    return found


def includes(text, items):
    """The expected items missing from text; an item that is a list is satisfied by any one of its entries."""
    haystack = normalize(text)
    missing = []
    for item in items:
        options = item if isinstance(item, list) else [item]
        if not any(normalize(option) in haystack for option in options):
            missing.append(" or ".join(f'"{option}"' for option in options))
    return missing


def private_patterns(terms):
    """Each private name with whole-phrase patterns for it and its distinctive parts: a title without its article, an
    author's surname, an imprint's first word and a printer's name without "Printers" or "Print Works"."""
    patterns = []
    for category, names in terms.items():
        for name in names:
            variants = {name, re.sub(r"^(?:the|a|an)\s+", "", name, flags=re.I)}
            if category == "authors":
                variants.add(name.split()[-1])
            elif category == "imprints":
                variants.add(name.split()[0])
            elif category == "printers":
                variants.add(re.sub(r"\s+(?:printers|print works)$", "", name, flags=re.I))
            patterns += [(name, re.compile(r"(?<!\w)" + re.escape(normalize(variant).strip()) + r"(?!\w)"))
                         for variant in sorted(variants)]
    return patterns


def named(patterns, text):
    """The private names a text mentions, in order."""
    text = normalize(text)
    return list(dict.fromkeys(name for name, pattern in patterns if pattern.search(text)))


def judge(case, run, week, data):
    """Problems with one run; an empty list is a pass."""
    if run.get("http_status") != 200:
        return [f"Foundry answered HTTP {run.get('http_status')}: {run.get('error') or 'no detail'}"]
    problems = []
    if run["status"] != "completed":
        problems.append(f"the run ended {run['status']}" + (f": {run['error'] or run['incomplete']}"
                                                            if run["error"] or run["incomplete"] else ""))
    calls, text = run["calls"], run["text"]
    if not text:
        problems.append("no answer text")
    expected = case.get("tools") or {}
    if expected == "none":
        if calls:
            problems.append("called " + ", ".join(sorted({call["server"] for call in calls})) + " without tools")
    else:
        for server in expected.get("required", []):
            if not any(call["server"] == server and not call["error"] for call in calls):
                problems.append(f"no successful {server} call")
        for server in expected.get("forbidden", []):
            if any(call["server"] == server for call in calls):
                problems.append(f"called {server}, which this case forbids")
    for call in calls:
        if call["error"]:
            problems.append(f"{call['server']} {call['tool']} failed: {call['error']}")
    patterns = private_patterns(data.get("private_terms", {}))
    for call in calls:
        if call["server"] != WEB_SERVER:
            continue
        try:
            arguments = json.loads(call["arguments"] or "{}")
        except ValueError:
            arguments = {}
        problems += [f"the Web IQ query names {name}" for name in named(patterns, str(arguments.get("query") or ""))]
        if arguments.get("contentFormat") != "passage":
            problems.append("the Web IQ call did not ask for passage content")
    answer, sources, steps = sections(text)
    markers = {(kind, number) for kind, number in MARKER.findall(answer)}
    lines = collections.Counter(SOURCE_LINE.findall(sources))
    listed = set(lines)
    for kind in case.get("markers", []):
        if not any(marker[0] == kind for marker in markers):
            problems.append(f"no [{kind}n] marker in the answer")
    # One number per row, document, page or message: the app shows one source for each marker.
    problems += [f"marker [{kind}{number}] names {count} sources" for (kind, number), count in sorted(lines.items())
                 if count > 1]
    for kind, least in (case.get("min_markers") or {}).items():
        found = sum(marker[0] == kind for marker in markers)
        if found < least:
            problems.append(f"{found} [{kind}n] marker(s) for at least {least} sources")
    if case.get("no_markers") and (markers or listed):
        problems.append("source markers without tools")
    problems += [f"marker [{kind}{number}] has no Sources line" for kind, number in sorted(markers - listed)]
    if text and steps is None and case.get("steps", True):
        problems.append("no Steps list")
    problems += [f"missing {item}" for item in includes(text, case.get("includes", []))
                 + includes(text, case.get("includes_by_week", {}).get(week, []))]
    for item in case.get("excludes", []) + case.get("excludes_by_week", {}).get(week, []):
        if normalize(item) in normalize(text):
            problems.append(f'contains "{item}"')
    if case.get("no_private_terms"):
        asked = set(named(patterns, case["question"]))
        problems += [f"names {name} without a source" for name in named(patterns, text) if name not in asked]
    if case.get("no_figures"):
        figures = re.findall(r"£?\d[\d,.]*(?:\s?(?:x|%))?", answer)
        if figures:
            problems.append("states figures without a source: " + ", ".join(dict.fromkeys(figures)))
    allowed = [float(value) for value in data["weeks"][week]["gbp"]]
    for written, value in amounts(text):
        if not any(abs(value - known) < 0.005 for known in allowed):
            problems.append(f"{written} is not an amount the week's rows or the approved documents give")
    return problems


def ask(endpoint, agent, case, token, timeout, send=post):
    body = {"agent_reference": {"type": "agent_reference", "name": agent}, "input": case["question"],
            "metadata": {"eval_case": case["id"][:64]}}
    started = time.monotonic()
    status, response = send(f"{endpoint}/openai/v1/responses", body, token, timeout)
    run = {"http_status": status, "seconds": round(time.monotonic() - started, 1)}
    if status == 200:
        run.update(parse_response(response))
    else:
        error = response.get("error") if isinstance(response, dict) else None
        run["error"] = text_of(error) or ("no response within the timeout" if status == 0 else "")
    return run


def save_evidence(record, directory=None):
    directory = directory or EVIDENCE
    directory.mkdir(parents=True, exist_ok=True)
    os.chmod(directory, 0o700)
    path = directory / f"evals-{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}.json"
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        json.dump(record, handle, indent=2, ensure_ascii=False)
    return path


def evaluate(data, cases, week, endpoint, agents, token, timeout, send=post, log=print):
    results = []
    for case in cases:
        agent = agents[case["variant"]]
        run = ask(endpoint, agent, case, token, timeout, send)
        if run.get("consents"):
            verdict, problems = "needs-consent", [f"consent to {consent['server'] or 'a tool'}: {consent['link']}"
                                                  for consent in run["consents"]]
        else:
            problems = judge(case, run, week, data)
            verdict = "fail" if problems else "pass"
        tools = ", ".join(f"{call['server']}{' (failed)' if call['error'] else ''}" for call in run.get("calls", []))
        log(f"{verdict.upper():13} {case['id']} ({case['variant']}, {run['seconds']} s){': ' + tools if tools else ''}")
        for problem in problems:
            log(f"{'':14}- {problem}")
        results.append({"id": case["id"], "variant": case["variant"], "agent": agent, "question": case["question"],
                        "verdict": verdict, "problems": problems, "response_id": run.get("id"),
                        "seconds": run["seconds"], "http_status": run["http_status"], "status": run.get("status"),
                        "tool_calls": [{**call, "arguments": text_of(call["arguments"], 600)}
                                       for call in run.get("calls", [])],
                        "answer": run.get("text", "")})
    return results


def main(argv=None, send=post):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--cases", default=str(CASES), help="the cases file (default: scenario/evals/cases.json)")
    parser.add_argument("--week", help="the as-of week the deployed data describes (default: the file's default_week)")
    parser.add_argument("--case", action="append", dest="ids", metavar="ID", help="run only this case (repeatable)")
    parser.add_argument("--work-iq", action="store_true", help="also run the cases that need Work IQ")
    parser.add_argument("--endpoint", help="the Foundry project endpoint (default: terraform output app_settings)")
    parser.add_argument("--agent-with-iq", help="the with-IQ agent's name (default: terraform output app_settings)")
    parser.add_argument("--agent-without-iq", help="the without-IQ agent's name (default: terraform output app_settings)")
    parser.add_argument("--timeout", type=int, default=240, help="seconds to wait for each answer (default 240)")
    args = parser.parse_args(argv)
    try:
        data = load_cases(args.cases)
        week = args.week or data["default_week"]
        if week not in data["weeks"]:
            raise EvalError(f"--week must be one of {', '.join(sorted(data['weeks']))}.")
        cases = [case for case in data["cases"] if not args.ids or case["id"] in args.ids]
        unknown = sorted(set(args.ids or ()) - {case["id"] for case in cases})
        if unknown:
            raise EvalError(f"No case named {', '.join(unknown)}.")
        skipped = [case["id"] for case in cases if case.get("requires") == "work_iq" and not args.work_iq]
        cases = [case for case in cases if case["id"] not in skipped]
        if args.endpoint or args.agent_with_iq or args.agent_without_iq:
            if not (args.endpoint and args.agent_with_iq and args.agent_without_iq):
                raise EvalError("Pass --endpoint, --agent-with-iq and --agent-without-iq together.")
            endpoint, agents = args.endpoint, {"with_iq": args.agent_with_iq, "without_iq": args.agent_without_iq}
        else:
            endpoint, agents = deployment_settings()
        endpoint, agents = checked_settings(endpoint, agents)
        token = foundry_token()
    except EvalError as error:
        parser.exit(1, f"Evals not run: {error}\n")
    print(f"Asking {len(cases)} case(s) for week {week} ({data['weeks'][week]['as_of']}) as the signed-in user"
          + (f"; skipped without --work-iq: {', '.join(skipped)}" if skipped else "") + ".")
    results = evaluate(data, cases, week, endpoint, agents, token, args.timeout, send)
    record = {"at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "week": week,
              "cases_sha256": hashlib.sha256(Path(args.cases).read_bytes()).hexdigest(),
              "endpoint": urllib.parse.urlsplit(endpoint).hostname, "agents": agents, "skipped": skipped,
              "results": results}
    path = save_evidence(record)
    counts = {verdict: sum(result["verdict"] == verdict for result in results)
              for verdict in ("pass", "fail", "needs-consent")}
    print(f"{counts['pass']} passed, {counts['fail']} failed, {counts['needs-consent']} need consent; evidence: "
          f"{path.relative_to(ROOT) if path.is_relative_to(ROOT) else path}")
    if counts["needs-consent"]:
        print("Open each consent link in a browser as this user, accept, then run the evals again.")
        return NEEDS_CONSENT
    return 1 if counts["fail"] else 0


if __name__ == "__main__":
    sys.exit(main())

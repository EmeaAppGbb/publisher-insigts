# Book performance evals

Expected outcomes for the [book performance agents](../../agents/README.md), checked against live runs. Everything
here is fictional, like the [portfolio data](../data/README.md) and the [approved documents](../knowledge/README.md).
Nothing in this folder is published or indexed.

A run is judged on its structure, not its wording:

- **Tools.** The tools a case requires ran and returned without an error; the without-IQ agent called none.
- **Sources.** The answer carries the expected source markers (`[D1]` ontology data, `[F1]` an approved document,
  `[Web1]` public context, `[W1]` mail), and each marker has a line under *Sources*. A *Steps* list follows.
- **Facts.** The answer contains the case's expected names and figures for the as-of week, and none of its excluded
  ones.
- **No invented amounts.** Every amount in pounds, outside a line that cites public context, is one that the week's
  rows or the approved documents give. A total, an average or a rounded figure such as £84.6k fails.
- **Public terms only.** No Web IQ query names a title, author, imprint or printer from the internal portfolio, even
  by a part that still identifies it, such as an author's surname or a printer's short name, and every Web IQ call
  asks for passage content.

## Cases

[`cases.json`](cases.json) holds the cases and, for each as-of week, the amounts in pounds an answer may state:

| Field | Meaning |
| --- | --- |
| `default_week`, `weeks` | The as-of weeks the cases know: 26 is the seeded week of 2 November 2026, 27 the week after the demo advances. Each lists every amount the week's tables and the documents hold. |
| `private_terms` | The portfolio's titles, authors, imprints and printers, which no Web IQ query and no without-IQ answer may name, matched with `&` read as `and` and also by a title without its article, an author's surname, an imprint's first word and a printer's name without "Printers" or "Print Works". |
| `cases[].variant`, `question` | The agent asked and the question, as the app's samples ask it. |
| `cases[].tools` | `required` (and `forbidden`) MCP server labels, or `"none"`. |
| `cases[].markers`, `no_markers` | Marker kinds the answer must carry, or none at all. |
| `cases[].no_private_terms`, `no_figures` | The answer names no private term the question doesn't, or states no figure at all. |
| `cases[].steps` | `false` for a reply that the instructions limit to one fixed sentence, which has no *Steps*. |
| `cases[].includes`, `includes_by_week`, `excludes`, `excludes_by_week` | Text that must or must not appear, compared without case, apostrophe style or thousands separators; a list inside `includes` is satisfied by any one entry. |
| `cases[].requires` | `work_iq` for a case that needs the opt-in mail tool. |

The cases cover each [app sample question](../../app/src/samples.ts) and these negative cases: the without-IQ agent
names no title and states no figure, the agent never totals two options' investments, a gap in the documents is
stated rather than filled, and an instruction to act gets only the read-only refusal. The approval-gated reprint request (approve and
reject), a second user's denied access and cross-user isolation join when the reprint server and the two-user proof
do.

`python3 -B -m unittest discover -s .github/skills/fabric-workspace/tests` recomputes every week's amounts and the
private terms from `SeedBooks`, `ComputeBookSignals` and the approved documents, ties each expected fact to the row or
document line it states (such as the expedited option's investment, the forecast variance or the 28-day cover rule)
and checks that every sample question has a case. Change the cases together with the seed, the rules or a document.

## Run them

From the deployment checkout, signed in with Azure CLI as a user who may use the agents:

```sh
python3 .github/skills/runtime-integration/scripts/run_evals.py            # every case for the default week
python3 .github/skills/runtime-integration/scripts/run_evals.py --week 27   # after the demo advances a week
python3 .github/skills/runtime-integration/scripts/run_evals.py --case attention --case public-context
```

The runner reads the project endpoint and the agents' names from `terraform output app_settings` and asks each
case's agent through the Responses API with your own Microsoft Foundry token, as the app does. It never prints or
stores the token. Each with-IQ case takes up to a minute. Add `--work-iq` when Work IQ is enabled.

Your first Fabric IQ question needs your consent: the runner stops with exit code 3 and the consent link. Open it
in a browser as the same user, accept, and run the evals again. It exits 1 when a case fails and 0 when all pass.

Evidence goes to `.artifacts/evals/`, owner-only and ignored by Git: each case's question, verdict and problems, the
response ID, the tool calls with their arguments and errors, and the answer. Read a failure there, or in the
[app's tool timeline](../../docs/runtime-integration.md#troubleshooting), before changing an agent.

A pass is evidence for one user's agent route in one run. It doesn't prove the app's sign-in or registration,
another user's access or isolation, and a model can answer differently next time: run the evals before a demo and
after every change to the agents, the documents or the data.

# Approved knowledge documents

The governed documents the agents cite through Foundry IQ: the fictional publisher's stock and marketing policies,
decision authority, signal definitions and author communication standards. Everything here is invented, like the
[portfolio data](../data/README.md). Never add a real company, person, retailer or policy.

| ID | Title | Version | Effective | Review by | Owner | File |
| --- | --- | --- | --- | --- | --- | --- |
| BKS-POL-001 | Reprint and stock policy | 1.0 | 1 October 2026 | 31 March 2027 | Head of production planning | [`bks-pol-001-reprint-and-stock-policy-v1.md`](bks-pol-001-reprint-and-stock-policy-v1.md) |
| BKS-POL-002 | Marketing investment guidelines | 1.0 | 1 October 2026 | 31 March 2027 | Marketing director | [`bks-pol-002-marketing-investment-guidelines-v1.md`](bks-pol-002-marketing-investment-guidelines-v1.md) |
| BKS-GOV-003 | Decision authority matrix | 1.0 | 1 October 2026 | 31 March 2027 | Publishing director | [`bks-gov-003-decision-authority-matrix-v1.md`](bks-gov-003-decision-authority-matrix-v1.md) |
| BKS-REF-004 | Book performance signal glossary | 1.0 | 1 October 2026 | 31 March 2027 | Head of commercial insight | [`bks-ref-004-signal-glossary-v1.md`](bks-ref-004-signal-glossary-v1.md) |
| BKS-TPL-005 | Weekly author sales update template | 1.0 | 1 October 2026 | 31 March 2027 | Head of author care | [`bks-tpl-005-author-update-template-v1.md`](bks-tpl-005-author-update-template-v1.md) |
| BKS-GDE-006 | Author communication tone guide | 1.0 | 1 October 2026 | 31 March 2027 | Head of author care | [`bks-gde-006-author-communication-tone-guide-v1.md`](bks-gde-006-author-communication-tone-guide-v1.md) |

## Authority

- **The live data decides facts.** Sales, stock, signals, decision options and approvals come from BooksOntology,
  never from a document, and the documents state no current figures.
- **The documents decide policy:** thresholds, approval limits, definitions and communication standards. The
  thresholds are the governed constants in [`ComputeBookSignals`](../../workspace/ComputeBookSignals.Notebook/notebook-content.py);
  change the rule and its document together.
- Each document states its ID, version, approval, effective and review dates, owner and approver, and numbers its
  sections (`## §1 …`) so an answer can cite one as `[F1 §2]`.

## Publishing

[`PublishBooksKnowledge`](../../workspace/PublishBooksKnowledge.Notebook/notebook-content.py) embeds these files'
exact bytes, each with its SHA-256, and writes them to the Books lakehouse's `Files/documents` folder, which the
default `documents` knowledge source indexes beside `starter.txt`. It is insert-only: it writes a missing file,
leaves an identical one alone, refuses before writing anything when a file there holds different content, and reads
every file back. The Bootstrap plan runs it after the lakehouse; the deployment runner runs it once when the plan did
not, and again after its definition changes.

To publish a revision:

1. Add it as a new file with the next version suffix, such as `-v2.md`, with its new version and dates. Never edit
   an approved file in place: the publisher refuses to overwrite one.
2. Regenerate the embedded copies with `python3 .github/skills/fabric-workspace/scripts/embed_knowledge.py`, then run
   `python3 -B -m unittest discover -s .github/skills/fabric-workspace/tests` and commit both.
3. Run `deploy.py up --update-definitions` and approve the `PublishBooksKnowledge` update; the runner then runs
   it again.

Retiring a superseded version is a separate, approved change: deleting or moving a file in OneLake leaves its
passages in the search index until the folder's knowledge source is rebuilt, so plan that rebuild with the removal
and verify retrieval afterwards.

Never put current figures, evaluation answers, drafts, credentials, tenant or deployment IDs, or real names here.

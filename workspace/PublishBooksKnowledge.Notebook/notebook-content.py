# Fabric notebook source

# METADATA ********************

# META {
# META   "kernel_info": {
# META     "name": "synapse_pyspark"
# META   },
# META   "dependencies": {}
# META }

# MARKDOWN ********************

# # Publish the approved book publisher documents
# Run after the Books lakehouse is deployed. No default lakehouse attachment is
# required: the target is resolved only in this notebook's current workspace.
# Writes the approved documents from scenario/knowledge/, embedded below with
# their reviewed SHA-256 digests, into Files/documents, the folder the default
# documents knowledge source indexes. Insert-only: a missing document is written,
# an identical one is left alone, and one whose content differs stops the run
# before anything is written; publish a revision under a new versioned file name.
# Every document is read back and compared with its approved text.
# By default, only workspaces ending in -dev or -test may receive these fictional documents.

# PARAMETERS CELL ********************

lakehouse_name = "Books"
allow_other_workspaces = False

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

from uuid import UUID

import notebookutils

context = notebookutils.runtime.context
workspace_id = str(UUID(context["currentWorkspaceId"]))
workspace_name = context["currentWorkspaceName"]

if not isinstance(workspace_name, str) or not workspace_name:
    raise ValueError("The runtime must identify the current workspace name.")
if not isinstance(lakehouse_name, str) or not lakehouse_name.strip():
    raise ValueError("lakehouse_name must name a lakehouse in the current workspace.")
if type(allow_other_workspaces) is not bool:
    raise ValueError("allow_other_workspaces must be a Boolean, not a string.")
if not workspace_name.endswith(("-dev", "-test")) and not allow_other_workspaces:
    raise ValueError(
        "Publishing the fictional demo documents is restricted to -dev/-test workspaces. For an "
        "intentional exception, explicitly set allow_other_workspaces=True for this run."
    )

lakehouse = notebookutils.lakehouse.get(lakehouse_name, workspace_id)
if str(UUID(lakehouse.workspaceId)) != workspace_id:
    raise ValueError("Refusing to publish to a lakehouse outside the current workspace.")

lakehouse_id = str(UUID(lakehouse.id))
documents_path = (
    f"abfss://{workspace_id}@onelake.dfs.fabric.microsoft.com/{lakehouse_id}/Files/documents"
)

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

# Generated from scenario/knowledge/ by .github/skills/fabric-workspace/scripts/embed_knowledge.py: change the
# documents there and regenerate, never this cell. Each entry is a file name, the SHA-256 of its UTF-8 bytes and
# its exact text.
# BEGIN APPROVED DOCUMENTS
DOCUMENTS = {
    "bks-gde-006-author-communication-tone-guide-v1.md": ("81d1bae61824e0f5e1aae5c9fcd82d92580da3718ac969f9398bdeb2f9aba0fd", """\
# Author communication tone guide

Document ID: BKS-GDE-006 · Version 1.0 · Approved · Effective 1 October 2026 · Review by 31 March 2027

Owner: Head of author care · Approved by: Publishing director

How we write to authors about their sales, in updates, emails and calls. A fictional demonstration document, not commercial guidance.

## §1 Voice

Warm, specific and honest, in British English. Short sentences, one idea each. Celebrate real progress without hype, and explain a slow week without blame.

## §2 Share

- Units sold, and the trend against last week and against the forecast, in plain words.
- The strongest territories, channels and formats.
- Reviews, ratings and media mentions.
- Approved campaigns and approved reprints, with their dates.

## §3 Never share

- Unit costs, net prices, margins or revenue at risk.
- Stock exposure, internal signal names, signal IDs or confidence levels.
- Options that are not yet approved, or another author's figures.
- A forecast presented as a promise.

## §4 Numbers and dates

Round units above 1,000 to the nearest hundred, and percentages to whole numbers. Write dates as day month year, such as 9 November 2026. When sales fall short of the forecast, say so plainly, and say what the team is doing about it.

## §5 Corrections

If a sent update held a wrong figure, the editor corrects it in the next update, or sooner when it matters to the author.
"""),
    "bks-gov-003-decision-authority-matrix-v1.md": ("a84e36298ebf0229a36afab2ea009c22ea5d0e160f4a3c0c60b64c9b32e26165", """\
# Decision authority matrix

Document ID: BKS-GOV-003 · Version 1.0 · Approved · Effective 1 October 2026 · Review by 31 March 2027

Owner: Publishing director · Approved by: Managing director

Sets who approves stock and marketing decisions, by the investment in the chosen option. A fictional demonstration document, not commercial guidance.

## §1 Approval limits

| Decision | Investment | Approver |
| --- | --- | --- |
| Standard reprint | Up to £50,000 | Production planning manager |
| Standard reprint | £50,001 to £150,000 | Head of production planning |
| Expedited reprint | Up to £150,000 | Publishing director |
| Any reprint | Over £150,000 | Managing director |
| Reallocation between territories | Up to £5,000 of transfer cost | Production planning manager |
| Reallocation between territories | Over £5,000 of transfer cost | Head of production planning |
| Pausing or cancelling a planned reprint | Any amount | Head of production planning |
| Marketing spend within BKS-POL-002 | Up to £25,000 | Marketing director |
| Marketing spend | Over £25,000 | Publishing director |

## §2 How approval works

The investment is the option's investment in pounds, as the decision options in the live data state it. A more senior approver in the same line may approve instead. The production line runs production planning manager, head of production planning, publishing director, managing director; the marketing line runs marketing director, publishing director, managing director. A reallocation also informs the sales directors of both territories.

## §3 The assistant's role

The book performance assistant may draft a decision brief and propose a request with its exact details. It never approves. A request reaches production planning only after the approver accepts it, and its record names the approver and the time.

## §4 Exceptions

There are no verbal or retrospective approvals. When the approver is unavailable, the next approver in the line decides.
"""),
    "bks-pol-001-reprint-and-stock-policy-v1.md": ("5c27e56d4e043e8c5ae2e7e5ef24e8fa56402f27498583dda72471b87b330a02", """\
# Reprint and stock policy

Document ID: BKS-POL-001 · Version 1.0 · Approved · Effective 1 October 2026 · Review by 31 March 2027

Owner: Head of production planning · Approved by: Publishing director

Applies to every print edition, hardback and paperback, of the Harrowgate Lane, Quillmere Press and Saltmarsh & Vane imprints in the UK, US and ANZ. A fictional demonstration document, not commercial guidance.

## §1 Cover and inventory risk

Plan stock by cover, not by units. The daily rate is the last two weeks' units divided by 14. When an edition has sold out in a territory, sales understate demand, so use the forecast's daily rate if it is higher. Cover is the stock on hand divided by the daily rate. Effective cover also counts the stock on order that lands within the standard reprint lead time.

An edition has an inventory risk in a territory when its effective cover is shorter than the standard reprint lead time. The net revenue at risk is the daily rate × (standard lead time − effective cover) × net price: what would be lost before a standard reprint ordered now lands. The risk is material at £100,000 or more.

## §2 Printers and lead times

| Printer | Editions | Standard lead time | Expedited lead time | Expedite premium |
| --- | --- | --- | --- | --- |
| Brindle Print Works | Hardbacks | 35 days | 21 days | £0.40 a unit |
| Brindle Print Works | Cookery hardbacks | 42 days | 28 days | £0.55 a unit |
| Calder Valley Printers | Paperbacks | 28 days | 18 days | £0.30 a unit |

Each edition's minimum reprint, 3,000 or 5,000 units, is recorded with its print terms.

## §3 Sizing a reprint

A reprint should leave 28 days of cover after it lands. Order the daily rate × (the reprint's lead time + 28 days), less the stock on hand and on order, rounded up to the next 1,000 units and never below the edition's minimum reprint. The investment is the units × the unit print cost, plus the expedite premium on each unit of an expedited reprint.

## §4 Responding to an inventory risk

Compare the responses before deciding:

- **Expedited reprint**, the planning recommendation: it lands at the expedited lead time and protects the most revenue.
- **Standard reprint**: it saves the expedite premium but lands at the standard lead time, so more revenue is lost first.
- **Reallocation from other territories**: it moves each other territory's stock beyond its own demand for the standard lead time plus 28 days. The stock arrives in 7 days and costs £0.30 a unit to move. It covers the gap only when the other territories hold enough spare stock.

Revenue protected is the net revenue at risk less what is still lost before the stock lands. Weigh each option's investment against the revenue it protects: for a risk that is not material, accepting the risk can be the right decision. The figures for each response come from the decision options in the live data, never from this policy, and a person decides.

## §5 Excess stock

Stock on hand and on order that covers more than 120 days of demand, while the title sells at 0.7x its forecast or less over four weeks, is excess. It is material when a reprint is on order and the exposure, the stock beyond 120 days of demand at print cost, is £20,000 or more. Then pause the planned reprint, which avoids its print cost, unless demand is expected to recover.

## §6 Approval and records

Every reprint, expedite, reallocation and pause needs approval under the decision authority matrix (BKS-GOV-003) before production planning acts on it. A request records the edition, the territory, the quantity, whether it is expedited, the rationale and the evidence, such as the signal it answers. An inventory risk is actioned once a request for its edition and territory is approved on or after the week the risk was first detected.
"""),
    "bks-pol-002-marketing-investment-guidelines-v1.md": ("46c0010e1043eae8791d221d585b4d2d4cd52bd2fbfbe1728478c891602f70fa", """\
# Marketing investment guidelines

Document ID: BKS-POL-002 · Version 1.0 · Approved · Effective 1 October 2026 · Review by 31 March 2027

Owner: Marketing director · Approved by: Publishing director

Applies to additional paid marketing for any title in the portfolio, in any territory. A fictional demonstration document, not commercial guidance.

## §1 Public momentum

A title has public momentum when its search interest over the last two weeks is at least 50% above its average for the eight weeks before, and it has at least 5 media mentions in the last four weeks. The momentum is material when search interest is at least 100% above that average.

## §2 When momentum is a marketing opportunity

Momentum is a marketing opportunity when the title also sells at least 1.3x its forecast over four weeks and has no live campaign. A live campaign already uses the momentum, so add no spend on top of it.

## §3 Sizing the spend

Spend 10% of the title's net revenue over the last four weeks, rounded up to the next £1,000, never less than £5,000 and never more than £25,000. Plan for a campaign to take effect about 7 days after approval. To compare options, plan on £2 of net revenue for each £1 of marketing: a planning assumption, not a forecast.

## §4 Holding spend

Holding spend is a valid choice when the momentum is likely to continue without paid support, or when a competing release is about to take the attention. If the title has an open inventory risk, resolve the stock first (BKS-POL-001): promoting a title that is about to sell out wastes the spend.

## §5 Approval and records

The marketing director approves spend within these guidelines. Spend above £25,000 needs the publishing director (BKS-GOV-003). Record each campaign's title, channel, territory, dates and budget.
"""),
    "bks-ref-004-signal-glossary-v1.md": ("20411c8cab223a4fa6fda413ae163c19dfb18bfa7cff44c5ce0a3e4858fd071c", """\
# Book performance signal glossary

Document ID: BKS-REF-004 · Version 1.0 · Approved · Effective 1 October 2026 · Review by 31 March 2027

Owner: Head of commercial insight · Approved by: Publishing director

Defines the terms in the weekly book performance signals. The figures themselves come only from the live data; this glossary never states current values. A fictional demonstration document, not commercial guidance.

## §1 Weeks and variance

- **As-of week**: the latest week of sales the signals describe. Weeks start on Monday.
- **Four-week variance**: a title's units over its forecast for the four weeks to the as-of week, such as 3.1x or 0.5x.
- **First detected** and **material since**: the first week of the unbroken run of weeks, ending with the as-of week, in which the signal's condition, or its materiality, holds.

## §2 Signal types

| Signal | Detected when | Material when |
| --- | --- | --- |
| Forecast variance | Variance is at least 1.5x or at most 0.7x | At least 2.0x or at most 0.6x |
| Inventory risk | Effective cover is shorter than the standard reprint lead time | £100,000 or more of net revenue at risk |
| Excess inventory | Over 120 days of cover, counting stock on order, and variance of at most 0.7x | A reprint is on order and the exposure is £20,000 or more |
| Public momentum | Search interest over the last two weeks at least 50% above the eight weeks before, with at least 5 media mentions in four weeks | At least 100% above |
| Marketing opportunity | Public momentum, variance of at least 1.3x and no live campaign | The momentum is material |

The reprint and stock policy (BKS-POL-001) and the marketing investment guidelines (BKS-POL-002) explain the calculations.

## §3 Confidence and status

- **Confidence**: for a forecast variance, High after four weeks in a row, Medium after two, else Low. For an inventory risk, High when the variance has been at least 1.5x in each of the last three weeks, else Medium. Public momentum and marketing opportunities are Medium; excess inventory is High.
- **Status**: Open, or Actioned once an approved reprint request answers an inventory risk.
- **Driver territory and channels**: where most of a forecast variance comes from.

## §4 Decision options

Each actionable signal has modelled responses, one of them recommended:

- **Investment**: what the option costs, in pounds.
- **Revenue protected**: the net revenue at risk that the option saves, or a campaign's planned return.
- **Remaining risk**: what is still lost before the option takes effect.
- **Cost avoided**: the print cost saved, such as by pausing a reprint.
- **Arrival days**: when the stock or the campaign takes effect.
- **Key assumption** and **primary risk**: what must hold for the option to work, and what could undo it.
"""),
    "bks-tpl-005-author-update-template-v1.md": ("30f45fca3392550d2cee4ded2c5ea2fa9cc0c4bf4eb8f3bdcbfb9166656134ce", """\
# Weekly author sales update template

Document ID: BKS-TPL-005 · Version 1.0 · Approved · Effective 1 October 2026 · Review by 31 March 2027

Owner: Head of author care · Approved by: Publishing director

The structure of the weekly sales update to an author. The assistant drafts it on request; the author's editor reviews, edits and sends it. Placeholders are in square brackets. A fictional demonstration document, not commercial guidance.

## §1 Subject line

Your week in sales: week of [week start date]

## §2 Body

1. **Greeting**: Dear [author first name],
2. **Headline**: one sentence on the week, such as its strongest change or a milestone.
3. **Sales**: for each of the author's titles, this week's units against last week's, and the last four weeks against the forecast, in plain words.
4. **Where it sells**: the strongest territory, channel and format.
5. **Reception**: new reviews, the average rating and media mentions, if any.
6. **Marketing**: the live campaign and its dates, if any.
7. **What happens next**: only approved actions, such as an approved reprint and when it arrives, or an approved campaign.
8. **Sign-off**: from [editor name], the author's editor, with an offer to talk.

## §3 Before sending

The editor checks every figure against the live data, applies the author communication tone guide (BKS-GDE-006) and sends the update. The assistant never sends it.
"""),
}
# END APPROVED DOCUMENTS

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

import hashlib

# More than any approved document holds (the generator refuses one over 64 KiB), so a readback is the whole file.
READ_LIMIT = 1024 * 1024

# The reviewed digests are ASCII, so they also catch text altered after review, such as in the notebook editor.
for name, (digest, text) in DOCUMENTS.items():
    if hashlib.sha256(text.encode("utf-8")).hexdigest() != digest:
        raise ValueError(f"The embedded {name} does not match its reviewed SHA-256; regenerate this notebook.")

# Every existing document is checked before any is written, so a conflict leaves the folder unchanged.
paths = {name: f"{documents_path}/{name}" for name in DOCUMENTS}
missing = [name for name in DOCUMENTS if not notebookutils.fs.exists(paths[name])]
conflicts = [name for name, (_, text) in DOCUMENTS.items()
             if name not in missing and notebookutils.fs.head(paths[name], READ_LIMIT) != text]
if conflicts:
    raise RuntimeError(
        "Files/documents already holds different content for " + ", ".join(conflicts) + ". Approved "
        "documents are never overwritten: publish a revision under a new versioned file name."
    )

if missing and not notebookutils.fs.mkdirs(documents_path):
    raise RuntimeError(f"Could not create the documents folder: {documents_path}")
for name in missing:
    if not notebookutils.fs.put(paths[name], DOCUMENTS[name][1], False):
        raise RuntimeError(f"Could not write Files/documents/{name}.")

for name, (digest, text) in DOCUMENTS.items():
    if notebookutils.fs.head(paths[name], READ_LIMIT) != text:
        raise RuntimeError(f"Files/documents/{name} does not read back as its approved text.")
    print(f"{'Published' if name in missing else 'Unchanged'} Files/documents/{name} (SHA-256 {digest[:12]}).")

print(f"Published {len(missing)} of {len(DOCUMENTS)} approved documents in {workspace_name}; the documents "
      "knowledge source indexes new files on its next scheduled run.")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

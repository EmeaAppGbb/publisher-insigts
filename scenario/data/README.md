# Book portfolio data contract

The fictional portfolio behind the book performance scenario. Everything here is invented: the titles,
authors, imprints, printers, campaigns and figures. Never add a real title, author, publisher or retailer.

| Owner | Writes | Semantics |
| --- | --- | --- |
| [`SeedBooks`](../../workspace/SeedBooks.Notebook/notebook-content.py) | The raw tables and `Files/documents/starter.txt` | A deterministic generator; insert-only by key, so existing rows and the file are never changed |
| [`ComputeBookSignals`](../../workspace/ComputeBookSignals.Notebook/notebook-content.py) | The derived tables | Fixed rules over the raw tables; each run replaces the derived rows with the same rows for the same data |
| [`PublishBooksKnowledge`](../../workspace/PublishBooksKnowledge.Notebook/notebook-content.py) | The approved documents in `Files/documents` | Insert-only: writes a missing file and never overwrites one; see the [approved documents](../knowledge/README.md) |
| [`BooksOntology`](../../workspace/BooksOntology.Ontology) | Nothing | Maps seven tables to entities that Fabric IQ queries live, as the signed-in user |

All tables are Delta tables in the `Books` lakehouse's `dbo` schema. Amounts are pounds, as whole pounds
except prices and unit costs. Flags are the strings `Yes` and `No`.

## Weeks

Weeks start on Monday. Week 1 is the week of 11 May 2026; `SeedBooks` seeds weeks 1 to 26, through the
week of 2 November 2026. Running it with a later `through_week` (at most 30, the last week the fictional reprints are planned for)
adds only the new weeks' rows,
which is how the demo advances: week 27 is the week of 9 November 2026. The derived tables describe only
the latest week in `weekly_sales`, the as-of week, and `ComputeBookSignals` needs at least ten weeks.

## Raw tables

| Table | Grain and key | Columns | Nulls |
| --- | --- | --- | --- |
| `titles` | A title; `title_id` | `title_name`, `author_name`, `genre`, `imprint`, `publication_date` | None |
| `editions` | A format of a title; `edition_id` | `title_id`, `format` (Hardback, Paperback, Ebook, Audio), `list_price_gbp`, `net_price_gbp` (net receipt per unit), `unit_cost_gbp`, `printer`, `reprint_lead_time_days`, `expedited_lead_time_days`, `expedite_premium_gbp`, `reprint_minimum_units` | Print terms are null for Ebook and Audio |
| `weekly_sales` | Edition x territory x channel x week; all four | `units`, `forecast_units` | None |
| `inventory_weekly` | Print edition x territory x week; all three | `on_hand_units` (end of week), `on_order_units`, `received_units`, `next_arrival_week` | `next_arrival_week` when nothing is on order |
| `public_momentum` | Title x week; both | `search_index` (100 is the title's reference level), `media_mentions`, `review_count` (cumulative), `avg_rating` | None |
| `campaigns` | A campaign; `campaign_id` | `title_id`, `title_name`, `campaign_name`, `channel`, `territory`, `start_date`, `end_date`, `budget_gbp` | None |
| `reprint_requests` | An approved reprint request; `request_id` | `signal_id`, `title_id`, `title_name`, `edition_id`, `territory`, `quantity`, `expedited`, `rationale`, `evidence`, `approver_name`, `approved_at`, `status` | Empty until a request is approved |

Territories are UK, US and ANZ. Print editions sell through Major retail, Independent and Online retail;
Ebook and Audio through Digital. Print sales never exceed the stock on hand, so the generator's stock and
reprints are tuned to avoid sell-outs that would hide demand, with one deliberate exception below.

## Derived tables

| Table | Grain and key | What it holds |
| --- | --- | --- |
| `title_signals` | A signal for a title, or for a print edition in a territory; `signal_id` | Type, headline, `first_detected_week`, `material_since_week`, the facts the rule used, `confidence`, `is_material`, `status` and `recommended_option` |
| `decision_options` | A modelled response to a signal; `option_id` | `option_name`, `is_recommended` (one per signal), `units`, `investment_gbp`, `revenue_protected_gbp`, `cost_avoided_gbp`, `remaining_risk_gbp`, `arrival_days`, `key_assumption`, `primary_risk` |
| `title_performance` | A title; `title_id` | Units this and last week, four-week units and forecast, units to date, four-week net revenue, top territory, channel and format, portfolio rank, public signals and the live campaign |

Signal and option IDs contain the as-of week, so they identify a row within its week. The notebooks'
schemas fix the column order and types of every ontology table, and match the ontology's table
definitions; a test checks both.

## Rules

`ComputeBookSignals` holds these thresholds as named constants; the scenario's reprint and marketing
policy documents must state the same values. A first-detected or material-since week is the start of the unbroken run of weeks, ending
with the as-of week, in which the condition holds.

| Signal | Detected when | Material when | Confidence |
| --- | --- | --- | --- |
| Forecast variance | Four-week units over forecast is at least 1.5, or at most 0.7 | At least 2.0, or at most 0.6 | High after 4 weeks in a row, Medium after 2, else Low |
| Inventory risk, per print edition and territory | Cover is shorter than the standard reprint lead time | Net revenue at risk is at least 100,000 | High when variance is at least 1.5 in each of the last three weeks, else Medium |
| Excess inventory, per print edition and territory | Stock on hand and on order covers more than 120 days and variance is at most 0.7 | A reprint is on order and the exposure is at least 20,000 | High |
| Public momentum | Search interest in the last two weeks is at least 50% above the eight weeks before, with at least 5 media mentions in four weeks | At least 100% above | Medium |
| Marketing opportunity | Public momentum, variance of at least 1.3 and no live campaign | Momentum is material | Medium |

- **Rate and cover.** The daily rate is the last two weeks' units over 14 days, or the forecast's rate
  when the edition sold out. Cover is stock on hand over the daily rate; effective cover adds stock on
  order that lands within the standard lead time.
- **Net revenue at risk.** The daily rate x (standard lead time - effective cover) x net price: what is
  lost before a standard reprint ordered now could land.
- **Reprint options.** *Expedited reprint* (recommended) and *Standard reprint*: units are the daily rate
  x (lead time + 28 days) less stock on hand and on order, rounded up to 1,000 and at least the edition's
  minimum; the investment is units x (unit cost + expedite premium). Revenue protected is the risk less
  what is still lost before that reprint lands. *Reallocate stock from other territories* moves each other
  territory's stock beyond its own lead time plus 28 days of cover, in 7 days at 0.30 a unit.
- **Excess options.** *Pause planned reprint* (recommended) avoids the reprint on order's print cost;
  *Keep planned reprint* keeps the exposure: stock beyond 120 days of demand, at print cost.
- **Marketing options.** *Increase marketing* (recommended) spends 10% of the title's four-week net
  revenue, from 5,000 to 25,000 in steps of 1,000, with a planning return of twice the spend; *Hold
  marketing spend*.
- **Status.** An inventory risk is *Actioned* once a reprint request for its edition and territory was
  approved on or after the risk was first detected; every other signal stays *Open*.
- **Drivers.** A variance signal names the territory with most of the variance and its two channels.

## Ontology

| Entity | Key | Table | Relationship |
| --- | --- | --- | --- |
| `Title` | `TitleId` | `titles` | |
| `Edition` | `EditionId` | `editions` | `EditionOf` -> `Title` |
| `Campaign` | `CampaignId` | `campaigns` | `Promotes` -> `Title` |
| `TitleSignal` | `SignalId` | `title_signals` | `SignalFor` -> `Title` |
| `DecisionOption` | `OptionId` | `decision_options` | `OptionFor` -> `TitleSignal` |
| `TitlePerformance` | `TitleId` | `title_performance` | `PerformanceOf` -> `Title` |
| `ReprintRequest` | `RequestId` | `reprint_requests` | `ReprintOf` -> `Edition` |

Properties are the columns in PascalCase, such as `OpportunityAtRiskGbp`. The derived entities repeat the
title name, so that one question about one entity answers a watchlist, explanation or options question:
Fabric IQ is reliable with one entity per question. `weekly_sales`, `inventory_weekly` and
`public_momentum` stay out of the ontology; the derived tables summarize them.

## Storyline

The fixed figures the tests and evaluations rely on.

**Seeded, week of 2 November 2026.** Five of ten signals are material. *The Glass Orchard* outperforms
forecast by 3.1x, led by UK digital and major retail. *Salt and Starlight* has public momentum, with search
interest up 109%, and no live campaign: a marketing opportunity whose recommended option spends 12,000.
*Northbound Signals* sells at 0.5x of forecast, with 47,200 of excess hardback exposure in the UK and a
15,000-unit reprint on order; pausing it avoids 30,750 of print cost. *The Glass Orchard*'s UK hardback
risk is emerging but not material: 24 days of cover against a 35-day lead time, with 84,571 at risk.

**After advancing to the week of 9 November 2026.** *The Glass Orchard* outperforms forecast by 3.3x, and
its UK hardback covers 14 days against a 35-day lead time: 179,827 of net revenue at risk, material, and
first detected on 26 October. The recommended expedited reprint of 32,000 units costs 80,000, lands in 21
days and protects 119,213; reallocating 5,348 units from the US and ANZ costs 1,604 and protects 51,341.
Without a reprint, the UK hardback sells out in the week of 30 November, the only sell-out in the
generated weeks.

## Changing the data

Changing the generator or a rule changes these figures: update the storyline above, the tests in
[`.github/skills/fabric-workspace/tests`](../../.github/skills/fabric-workspace/tests) and the scenario's
evaluations together. Seeding is insert-only, so a changed fixture never updates an existing row: seed a
fresh workspace, or add a reviewed migration. Run the offline tests with
`python3 -B -m unittest discover -s .github/skills/fabric-workspace/tests`.

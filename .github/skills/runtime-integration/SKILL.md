---
name: runtime-integration
description: Preflight the shipped Foundry prompt agents and Container Apps web app route, prove its remaining readiness evidence, or diagnose a blocked agent or app in an explicitly chosen derived project. Use before promising an end-to-end IQ shell. Distinguish a deployed, healthy route from authenticated, data-backed, per-user readiness; never provision as template maintenance.
---

# Prove the runtime path first

Read `AGENTS.md`, `docs/runtime-integration.md`, `docs/development.md` and
`docs/ontology-knowledge.md`. This is a bounded integration procedure, not a
deployment wrapper. The `deploy-platform` runner's `reprint`, `agent` and `app`
phases deploy the reprint request server, publish the shipped prompt agents and
build and deploy the web app; use this skill for the preflight, the remaining shell
evidence, access questions and diagnosis.

## 1. Choose the proof target

Require an explicitly chosen derived repository, reviewed revision, execution
host, Azure subscription/tenant and region. A disposable proof still creates
billable resources, Entra registrations and role assignments. Do not borrow
another project's resources, connections or state without approval.

Keep commands, configuration edits and state on that host. Use `deploy-platform`
for infrastructure, Fabric bootstrap, the reprint request server, the agents and the
app, preserving its
consent, saved-plan, action-approval and state gates. A local single-user proof
needs explicit state-retention acceptance; team/CI use requires secured remote
state.

## 2. Run the read-only preflight

Run from the selected checkout, supplying the chosen values:

```sh
python3 .github/skills/runtime-integration/scripts/preflight_runtime.py \
  --repository "<owner>/<derived-repository>" \
  --subscription-id "<chosen-subscription-guid>" \
  --tenant-id "<chosen-tenant-guid>" \
  --location "<chosen-region>" \
  --fabric-location "<chosen-fabric-region>"
```

The helper only reads native metadata. It checks that the checkout's origin is
the chosen derived repository and neither the template nor a fork; the tool
minimums Node.js >= 24.11.0, Git >= 2.27.0 and Azure CLI >= 2.60.0 (`tools`); the
selected Azure user, subscription and tenant; provider credential overrides; that
the tenant's Microsoft Foundry API principal publishes an enabled
`user_impersonation` scope (`foundry_api`); that Foundry accounts, Container Apps
environments and container registries are offered in `--location` (`regions`); and
Fabric's authoritative regional CU quota for the exact SKU (`fabric_quota`).
Supply `--fabric-capacity-sku` for a SKU other than F2; `--fabric-location`
defaults to `--location`. For an existing deployment's resize, pass its current SKU
as `--current-fabric-capacity-sku`: only the CUs the larger SKU adds need quota, and
the report names it as `fabric_quota.current_sku`. Before the user enables Work IQ,
add `--work-iq`: `work_iq.manual` then lists its prerequisites, which the helper
can't check (the tenant's Work IQ principal, administrator consent to
`WorkIQAgent.Ask` and `offline_access`, a Copilot Credits spending policy covering
the Work IQ API even for licensed users, a mailbox per user and each user's
consent). The helper does not sign in, write configuration, read state, retrieve a
secret, call Microsoft 365 or provision, and it never prints native authentication
output. Investigate a failed probe; zero or unknown quota is not "unlimited".

Treat `status: "candidate"` as permission to continue, **not** readiness. Its
`unverified` list names what still needs live evidence.
`fabric_git_token_available` reports only environment-variable presence, never
permission or write access. A region that doesn't offer a resource type needs
another explicitly chosen region, not a bypass. Search's new-service capacity and
model quota still require separate checks; the runner's own preflight checks model
quota. Keep one common region by default; service-specific overrides require
approval and a fresh full plan, especially after a partial deployment.

## 3. Prove identity, retrieval and isolation

Start from the runner's evidence: its `verify` phase saves the ontology and
document retrieval responses in `.artifacts/deploy/evidence/` and checks the
keyless Web IQ wiring, without a Web IQ call, its `reprint` phase waits until the
reprint request server's `/readyz` shows that its own identity holds both KQL
database roles, its
`agent` phase reads every agent back with its reviewed digest, and its `app` phase
checks the deployed app's health and sign-in settings. None of them asks the agents
a question or writes a reprint request. For the remaining gates in `docs/runtime-integration.md`:

- **Evals.** From the deployment checkout, run
  `python3 .github/skills/runtime-integration/scripts/run_evals.py` (with `--week 27`
  after the demo advances a week). It asks every case in `scenario/evals/cases.json`
  as the Azure CLI user and judges each run's tool calls, markers, expected facts,
  amounts in pounds and Web IQ queries, and the reprint request a case proposes,
  which it always rejects: it never approves. Exit code 3 means a tool needs this
  user's consent, such as the reprint request tool's on the first with-IQ case after
  the server is deployed: give the user the printed link to open and accept, then
  rerun. Read failures
  in the owner-only `.artifacts/evals/` evidence. A pass covers one user's agent route,
  not the app's sign-in or isolation.

- **Browser sign-in.** The user signs in at the `app` output's URL, asks the sample
  question with IQ, accepts each consent card once (Fabric IQ, and the reprint
  request tool's, which asks to submit requests as them), asks again and gets
  The Glass Orchard and its forecast variance with a `[D1]` marker; then compares with **Ask both** and
  asks a follow-up. The runner's CLI token does not prove the app's registration,
  its consent or the redirect bridge.
- **Sources.** Decide from the tool timeline, not answer text: the Fabric IQ call
  must return live rows as the user, the Foundry IQ call a cited passage of an
  approved document, the Web IQ query public terms only and, with Work IQ, the mail `fetch`
  the user's own mail. Never accept a `starter.txt` fact as live ontology evidence.
- **Reprint request, without a write.** With-IQ runs list the reprint server's tool
  with the user's token, without a failed `tools/list`, which proves the server's
  token checks; `/readyz` proved its identity's roles. The user asks to submit a
  reprint request, checks that the approval card shows the week's exact option values
  and rejects it, and the answer says nothing was submitted: that proves the
  approval route. Only a deliberate approval in the app proves a write, the demo's
  own act, and DEV can't take it back. Never approve as a check or on the user's
  behalf.
- **End-user authorization.** With an explicitly approved second account, confirm
  that a user without a Foundry role receives HTTP 403, and that a user with the
  role but without Fabric access gets an explicit failure or unavailable-source
  answer, never a document substitute. A denied approval needs an account that
  holds no approval role: its approval gets the server's `role_insufficient`
  refusal, which records nothing. Grant nothing beyond the access model without the
  user's approval.
- **Isolation.** The second user must not be able to continue or read the first
  user's conversation through its response ID, or reach their mail. Until a second
  user has tried, report the shell as verified for one user, isolation not
  demonstrated.

Keep the identity contract intact while proving it. The app's server verifies and
forwards only the signed-in user's Foundry token; Fabric IQ uses its
`UserEntraToken` connection, and the reprint request tool and Work IQ their OAuth
identity passthrough; the reprint request server records an approved request as its
own identity, which holds only Database Viewer and Ingestor on `BookSignals`; the
Foundry IQ tool reads documents and the Web IQ tool calls Web IQ's MCP server
through the `web-iq` connection, both with the project's managed identity. Never expose tokens in prompts, tool arguments, configuration, evidence
or logs. Never switch to a shared, application or managed identity, widen a role,
an allow-list or connection sharing, or add a backend to get a plausible answer.

## 4. Diagnose a blocked route

Follow the troubleshooting table in `docs/runtime-integration.md`. Separate the
layers before changing anything:

1. Compare the without-IQ agent, which calls no tool, with the with-IQ agent's turn
   and its tool timeline. A without-IQ answer next to with-IQ tool failures within
   seconds points at a source, such as a paused Fabric capacity.
2. Ask an agent directly as the user (the documented `az rest` call to the
   project's Responses API). If that succeeds but the app fails, look at the app,
   its settings or the sign-in registration and its redirect bridge.
3. Read the agent's latest version and its digest through the Foundry data plane,
   and the run's trace in Application Insights by the response ID the app shows.
   Read the container app's revision status and its console logs in Log Analytics.
4. Map the status: 401 is sign-in or token verification, 403 the user's Foundry
   role, 404 an unpublished agent or wrong project, 429 model quota, a failed
   `tools/list` an allow-list that names a tool the server doesn't offer or, for
   `reprint_request`, a token the reprint server refuses, and a 225-second timeout a
   slow tool. When the app fails a held call instead of showing its approval card,
   the code is `approval_several` or `approval_unreadable`; a refused reprint request
   names its cause, and the server's console log its code, such as
   `role_insufficient`, `argument_mismatch`, `signal_not_open`, `already_requested`
   or `store_unavailable`; a `/readyz` 503 carries the roles the identity holds.

Fix the cause in source, Terraform or with the documented grant, then let the
runner publish a new agent version or build and apply a new app or reprint server
revision. Never edit a live agent or container app by hand, recreate one to clear a
failure, change the registration's redirect URIs in the portal or relax the app's
or the reprint server's checks. If a native service cannot preserve the required
identity, report the blocked capability and request an explicit design decision.

Require all evidence in `docs/runtime-integration.md` before saying **shell
ready**. Work IQ stays unverified without a tenant that meets its prerequisites.

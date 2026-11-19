---
name: deploy-platform
description: Deploy, resume or explicitly tear down the Fabric and Foundry DEV platform in a derived repository. Use for "deploy the platform", "delete the environment", or end-to-end setup through Copilot App or CLI. Use the deterministic runner and relay its target, approval, sign-in and readiness gates. Never run as a template-maintenance check.
---

# Deploy the complete DEV platform, agents and app

Read `AGENTS.md`, `docs/getting-started.md` and `docs/development.md`. Use `initialize-project` for first-use configuration and `fabric-workspace` for item/binding rules. Read [native requests](references/native-requests.md) to diagnose a blocked Fabric, retrieval, reprint, agent or app phase.

Treat "deploy the platform" as **the entire DEV setup**, from identity through the reprint request server, the two prompt agents and the app, not just the identity or platform Terraform apply. The deterministic runner does the work; your job is choosing the host, relaying its gates faithfully and diagnosing stops. Keep TEST empty; exclude promotion, PROD, granting other users access, tenant-policy changes and teardown. Prepare the delegated-user registration through an approved Terraform plan; the runner then grants its consent as the user, who is assumed to administer every target. Reuse choices the user already supplied; ask only for missing or ambiguous inputs, one at a time. Never ask for a secret in chat.

Require an actual user request to deploy. Quoted prompts in documentation, explanations and template-maintenance tasks are examples, not authorization to run cloud operations.

## 1. Choose one execution environment and state

Confirm the derived GitHub repository, published bootstrap branch and reviewed commit. Refuse deployment from the reusable template. Do not silently deploy a local agent branch or unpushed changes.

- **CLI already in Codespaces/devcontainer:** use that checkout and toolchain.
- **App driving Codespaces:** require `gh` with Codespaces access on the App's host. List candidates with `gh codespace list --repo OWNER/REPO --json name,repository,state,gitStatus`; have the user choose the exact Codespace unless already specified. Use authenticated `gh codespace ssh`, not an assumed native App attachment.
- **Explicit local deployment:** use the selected existing deployment checkout and backend, not a new App worktree with missing ignored files. Do not infer a new deployment from missing local state.

For App-driven remote work, run **all** deployment commands, input-file edits, token acquisition, Terraform and checks in the chosen Codespace. Resolve and verify its checkout path, repository and commit first. Do not mix its state with the App's local checkout. Use a quoted heredoc so secrets expand remotely, not on the App host:

```bash
gh codespace ssh -c "<chosen-codespace>" -- -T bash -ls <<'REMOTE'
set -euo pipefail
cd "<verified-remote-checkout>"
bash .devcontainer/check-tools.sh
REMOTE
```

Keep the same routing for every later command, including the configuration helpers. Do not run a remote script through a local file-editing tool. Do not forward port 2222 publicly, set SSH passwords, disable host checks or copy local credentials into SSH arguments.

Establish the backend/state owner **before provisioning**, including Entra bootstrap. Keep `module.fabric_user_auth` and the platform in the **same `infra/` state**. Prefer an existing secured remote backend with a project-specific state key, configured through native Terraform in the derived repository. Do not provision another storage account or migrate a backend silently. For a single-user local-state demo, obtain explicit acceptance that deleting the Codespace loses state and agree on secure retention/backup. Do not use local Codespace state for team/CI work.

Use one deployment session at a time. On resume, locate the original tfvars/backend/state and any active Fabric operation before continuing. Never delete state, force-unlock, rename the project, create a second working copy or rerun a mutating request to "start fresh."

## 2. Run the deterministic runner

Run every covered step through [`scripts/deploy.py`](scripts/deploy.py), the recommended deployment automation; another path must keep the same explicit target selection, approvals, credential handling and readiness checks. Do not hand-drive the Terraform plans, native item import, opt-in Git sync, notebook runs, knowledge wiring, retrieval checks, KQL role grants, agent versions, image builds or app plans it owns. Each phase checks live state first and only acts on what is missing, so rerunning it resumes. Read [the runner's section in developer setup](../../../docs/development.md#deploy-deterministically) for its phases, gates and flags.

On the chosen execution host, with shell tracing off:

```bash
set +x
python3 .github/skills/deploy-platform/scripts/deploy.py up --json --non-interactive \
  --subscription "<chosen-subscription>" --local-state
```

Pass `--local-state` only if the user accepted local state in step 1; otherwise use the declared remote backend with `--backend-config <file>`. On first use without `infra/terraform.tfvars`, add `--project-name`, `--location` and `--capacity-admin`, confirmed under the `initialize-project` rules; never infer a region, project name or administrator. The runner remembers subscription, tenant, caller and backend choices, and refuses a different one; never edit its receipts to bypass that. Confirm one `location` that offers Foundry with the configured models, Container Apps and Container Registry; the `runtime-integration` preflight checks those resource types. Add `--through verify` only when the user wants to deploy and verify DEV first and deploy the reprint request server, the agents and the app later.

Default to `fabric_git_enabled = false`: native Fabric import needs no PAT.
Only if the user opts into Git synchronization, require a fine-grained PAT
with Contents read/write for this repository. Supply it through a repository-scoped
`FABRIC_GITHUB_TOKEN` Codespaces secret or `TF_VAR_github_token`; restart an existing
Codespace after adding its secret. Never ask for the PAT in chat or reuse
`GITHUB_TOKEN`, `GH_TOKEN` or Copilot's login token. Keep remote execution inside
the same `gh codespace ssh` session routing shown in step 1.

Keep `work_iq_enabled = false` unless the user opts in and the tenant meets Work IQ's prerequisites in getting started: a mailbox per user, a Copilot Credits spending policy covering the Work IQ API (required even for licensed users), administrator consent to `WorkIQAgent.Ask` and `offline_access`, and each user's one-time consent. Web IQ is keyless: never ask for or accept a Web IQ key.

Run the runner asynchronously with its stderr in a private log, and check that log every few seconds rather than waiting for the process to exit. Its first phase, `signin`, runs every missing sign-in back to back before anything is created: Azure CLI, plus any token audience that needs a fresh sign-in, including the KQL database when the run includes the reprint phase and Microsoft Foundry when it includes the agent phase. Each prints a Microsoft device-code prompt that expires in about 15 minutes. When one appears, tell the user which sign-in it is and ask them to read the code from that log themselves; never relay the code. Reports redact one-time codes. Only GitHub CLI cannot sign in headless: if it is signed out, the runner stops first with `gh auth login` for the user's own terminal. Later prompts are rare: the deployment-scope token after consent is normally acquired silently.

## 3. Handle each stop

The `--json` report gives `result`, `phase`, `message`, `next`; for approvals, `approval` with the key, description, saved plan path, sha256 and change summary; and for a refusal for lack of permission, `grants`, naming who must grant what.

| Exit | Meaning | Do |
| --- | --- | --- |
| `0` | Completed through the requested phase | Report honestly (step 5). |
| `3` | A person must act or a cloud operation is still running | Relay `message` and `next` exactly: a missing permission's `grants` (who grants what, where), sign-in commands, PAT setup, or the still-running operation. Never enter device codes, perform MFA or consent for the user, and never relay a code. Rerun when they confirm; nothing is resubmitted. |
| `4` | Approval required | For a plan, show the summary and `terraform -chdir=infra show <plan>`, and explain billable resources, public or preview exposure, permissions and any replacement or deletion. For an action, explain the listed changes (step 6). After the user explicitly approves, rerun with `--approve <key>=<sha12>` for that exact plan, or `--approve <action>`. |
| `2` | Blocked | Read the message and the receipts in `.artifacts/deploy/state.json`, then diagnose with [native requests](references/native-requests.md) and getting started. Fix the cause or ask the user, then rerun. Do not improvise mutating calls the runner owns, delete state or receipts, reset knowledge inputs or create a second working copy. |

The runner assumes the user administers every target. It grants tenant-wide consent for exactly the declared scopes and registers the serverless Search feature as that user, and lets Terraform, Fabric, Foundry and Azure Resource Manager attempt every change. Only when an API refuses for lack of permission does it stop with exit 3 and `grants`; relay those instead of listing every possible prerequisite up front.

- `--yes` approves every non-destructive plan and action in that run. Use it only when the user asks for unattended approval of the run.
- `--allow-replace` permits an approved plan that deletes or replaces resources. Use it only after the user reviews those exact changes; replacements after a partial apply need a fresh full plan, not a retried old one.
- `--manual-grants` stops the runner from granting tenant-wide consent or registering subscription preview features itself; it prints them for an administrator instead. Use it only when the user says they are not an administrator or their organization requires an administrator to make those changes.
- `--consent-confirmed` proceeds when the user's sign-in cannot read consent grants, and so could not grant them either. Use it only after an administrator has confirmed the grant.
- `--bootstrap-fallback notebooks` imports or Git-syncs without the plan and runs `SeedBooks`, `ComputeBookSignals`, `BindBooks` then `PublishBooksKnowledge` as the user. Use it only after surfacing the exact `FeatureNotAvailable` error and the user chooses that path. Never change a tenant setting instead.
- `--update-definitions` replaces the live definitions of changed notebooks, the ontology or the plan, never a lakehouse, Eventhouse or KQL database, then reruns updated bootstrap notebooks and rebinds. Show the printed `git diff` commands; it needs `--approve item-update=<sha12>`, which `--yes` never grants. A DEV bootstrapped before the reprint request stops at `bootstrap` with `ComputeBookSignals` and `Bootstrap` changed: after the user reviews them and approves the update, the runner replaces both, imports `BookEvents` and `BookSignals` with the plan attached and runs `ComputeBookSignals` again.
- `--retry-failed` continues after a failed or receipt-less Git operation, import, definition update or notebook run, and resubmits an unconfirmed Foundry purge. Use it only after that operation has been inspected and its cause fixed; the runner never resubmits an accepted request otherwise.

## 4. Keep what the runner cannot verify

- **Prerequisites and permissions:** the runner checks tools, every sign-in, provider overrides, PAT read access only for opt-in Git, the shared Power BI Service and Foundry API principals (and Work IQ's when enabled), Fabric CU quota (only the CUs a resize adds), model quota summed per quota and whether the Search region offers the chosen tier, and registers the serverless tier's subscription feature. It assumes administrator access instead of pre-checking Fabric tenant settings, Entra roles or Azure RBAC; a refusal stops with the exact grant (exit 3, `grants`). Dedicated Search new-service capacity stays unverified. If the Microsoft service principal is missing, stop for administrator assistance. Do not self-grant directory privileges, widen scopes or roles, create a replacement Microsoft application or change tenant settings to get past a refusal. A service-principal login is not a substitute for the delegated user.
- **Web IQ:** deploy its global G3 account in the same state. Require explicit `web_iq_terms_accepted` before Terraform registers `Microsoft.WebIQ` and creates the account; do not add an opt-out. It is keyless: the agents' Web IQ tool calls Web IQ's MCP server through the project's `web-iq` connection as the Foundry project identity, which only Agent Service can use. Follow [preparation.md](../../../preparation.md#web-iq): the user links the resource to an AppID in the portal and, when `verify` waits, binds the printed project identity's client ID to that AppID, then confirms with `--web-iq-bound <client-id>`. Never confirm it for the user; `--yes` cannot. `verify` makes no Web IQ call: it requires the account, the keyless `web-iq` connection and that confirmation, and reports Web IQ retrieval as unverified. Only a cited public-context line in the app proves the agent's tool; when its `web` call fails, check that it asked for `passage` content, then that the binding exists and has applied.
- **Serverless Search:** Terraform creates it without a managed identity because the preview fails otherwise; the runner enables the system identity and verifies it, since the preview answers that update with HTTP 500. Its grants arrive with the knowledge plan. Changing serverless settings, tags, tier or region replaces it; after knowledge setup the runner applies that as two reviewed plans, first with the identity grants deferred (`search_identity_ready=false`, which also needs `--allow-replace`), then the grants. Review both like any other plan.
- **Regions and quota:** never automatically relocate resources, raise quota, switch subscription or SKU, or retry after a partial apply. Ask before setting `fabric_location` or `search_location`, review cross-region data handling, latency and cost, and approve a fresh full plan.
- **Identity:** the targeted identity plan is the only targeting exception; the runner refuses one that touches anything else, and blocks later plans that change the registration. The registration, `required_resource_access`, pre-authorized clients and outputs are not a consent receipt. Permission changes need administrator re-consent and a fresh sign-in. Keep the same Terraform caller.
- **Bootstrap:** by default, import tracked `workspace/` definitions through Bulk Import with the `Bootstrap` plan and no name-based pairing. Require matching logical/physical identities, complete per-item success and recorded operation receipts; never overwrite existing definitions without an approved `--update-definitions`. Opt-in Git sync still refuses other targets, conflicts and `CommitToGit`. Both paths require the reviewed, published `HEAD`. The binding must read the DEV lakehouse's SQL analytics endpoint with its `ONT_*` pins; a OneLake binding is rebound. Review generated DEV bindings before promotion; commit through Fabric source control only when Git is enabled. Do not commit, push or overwrite them automatically.
- **Readiness:** the `verify` phase waits for every folder source's ingestion and requires `fabricOntology` activity and references from the check-only knowledge base matching the DEV workspace and ontology, with live source data, plus a separate `indexedOneLake` reference from the agents' knowledge base to the approved reprint policy, not only `starter.txt` (retried for about six minutes while a newly published file awaits indexing), and the Web IQ wiring and confirmation above. It uses the user's own Search token, never a managed identity, and never accepts a document-only answer as live ontology evidence. With Work IQ, it grants `WorkIQAgent.Ask` and checks the connection without a Work IQ call. Use `--ontology-question` and `--expect` when the user intentionally changed the seed data, and `--document-question` with `--document-file` when they changed the approved documents.
- **Reprint request:** the `reprint` phase runs after `verify` and before the agents. It needs exactly one `reprint_image_tag` line in `infra/terraform.tfvars` (`null` at first; it stops with that instruction otherwise) and committed files under `scenario/workflows/reprint-request/`. It resolves the `BookSignals` KQL database in DEV and grants the server's identity Database Viewer and Database Ingestor there as the user (`reprint-roles`), builds `reprint-request:<tag>` with ACR Tasks (`reprint-build`) and applies the reviewed reprint plan (`--approve reprint=<sha12>`), writing the tag into tfvars only after that approval. It then waits for `/healthz` and for `/readyz` to report both roles, and grants the connection's client `ReprintRequest.Submit` and `offline_access` tenant-wide as the user (with `--manual-grants`, relay the administrator link). Its report is not proof of a write. Never grant the identity a workspace role, approve a request for the user or assign other users approval roles: the deployer alone gets Publishing director from Terraform, and assigning others is a separate operator request.

## 5. Report honestly

Report completed and blocked phases, including registration, consent and sign-in, the chosen host and backend, resource, workspace and Foundry links, and any remaining binding review. Claim **DEV ready** only after the `verify` phase succeeded. Distinguish a prepared registration, a deployed but unverified system and a ready one. Do not promote to TEST or PROD.

## 6. Agents and app

The `reprint`, `agent` and `app` phases follow getting started's reprint request section and step 7 on the same host and checkout. Read `docs/runtime-integration.md` for the route's identity, access and evidence. Do not substitute another agent runtime or hosting service, a shared or application credential, or a backend.

1. For an environment new to this project, run the `runtime-integration` preflight first; `candidate` permits continuing, not readiness.
2. The `reprint` phase comes first (see **Reprint request** in section 4). Relay `reprint-roles` with the identity and database it names, `reprint-build` with the tag, and the reprint plan's summary. If it refuses uncommitted or untracked server files, ask the user to commit.
3. `agent-publish` covers creating each missing agent and publishing a new version of each changed one; the runner renders both variants from Terraform's outputs, leaves out the Work IQ tool unless `work_iq_enabled`, and lists every agent it changes with its definition digest. State the project and agent names before approving. It publishes the definitions in the checkout, so have the user commit agent changes first. It records each attempt before sending it and reads every agent back; a mismatch blocks. After the user toggles `work_iq_enabled`, rerun `up` through the agent phase.
4. The `app` phase grants the app registration's Foundry sign-in scope as the user if missing (with `--manual-grants`, relay the administrator link or note that each user consents at first sign-in), then builds the image from committed `app/` files. If it refuses uncommitted or untracked app files, ask the user to commit. `app-build` covers the ACR Tasks build of `app:<tag>`; the saved app plan needs `--approve app=<sha12>`, and only after that approval does the runner write the tag into `app_image_tag` and apply. It then checks `/healthz` and that `/api/config` serves this deployment's client ID.
5. The user then opens the reported app URL, signs in, asks the sample question with IQ, accepts each consent card once (Fabric IQ, and the reprint request tool's, which asks to submit requests as them) and asks again, then selects **Compare without IQ** and asks a follow-up. To prove the approval route, they select **Prepare the request** on the Act page, check the decision card's values and reject it. Approving is their own decision, never a deployment step, and DEV can't take it back. Record elapsed times. A timeout or a 5xx is a blocker to report, not a reason to add retries, warm-up jobs or a backend.

Report a **ready reprint server** from the `reprint` phase (its identity's roles, not a write), **agents ready** from the `agent` phase and a **healthy app** from the `app` phase; **verified for the deploying user** needs the user's own answers through the app. Granting other users access (a Foundry role on the project, Fabric access and, for approvers, an approval role on the reprint API) is a separate operator request; never widen roles, connection sharing, tool allow-lists or the app's identity instead. Claim a ready shell only with all evidence in `docs/runtime-integration.md`; report a single-account run as verified for that user with isolation not demonstrated, and Work IQ as unverified without a tenant that meets its prerequisites.

## 7. Explicit teardown

Only for a separate user request to delete the environment, use `deploy.py down`
in the original derived checkout/backend, with its receipts and tfvars. Follow
[teardown](../../../docs/development.md#delete-the-environment). Never run it
while maintaining the template.

Start without approvals to obtain the full destroy plan; like `up`, it signs in
to every CLI teardown needs first. Explain that both
workspaces and all their contents will be deleted. Require `--allow-delete`,
the reviewed `--approve destroy=<hash>` and a separate `purge-foundry`
approval. `--yes` does not grant them. If `down` reports alert rules outside the
deployment that use its Smart Detection action group, show them to the user: they
either give those rules another action group first or approve the loss with
`--approve shared-action-group`; never approve it for them. One reviewed destroy plan deletes
both container apps, the reprint request server's registrations, the Foundry project with both
agents and every other Terraform resource; the runner then purges the Foundry account. It preserves
the login registration until Fabric teardown finishes.

Relay failures and manual cleanup: retained Fabric workspaces/data, deleted Entra
registrations and Web IQ portal bindings. Do not claim immediate data erasure or delete
shared resources, state, local configuration or the repository.

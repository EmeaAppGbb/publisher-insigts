# Contributing

Book Intelligence is an internal proof of concept: Microsoft IQ for a fictional book publisher, built on
the [Fabric + Foundry IQ template](https://github.com/microsoftgbb/iq-template). Changes come through
pull requests into `main`. Follow the [Code of Conduct](CODE_OF_CONDUCT.md), and report security issues
as described in [SECURITY.md](SECURITY.md), never in an issue.

## Before you start

- Read [AGENTS.md](AGENTS.md). Its guardrails apply to people and Copilot alike. The
  [repository skills](.github/skills/) encode each workflow; extend them instead of adding parallel
  scripts or wrappers.
- Open an issue before a large change, so the approach can be agreed first.
- Open a Codespace on this repository, or use the dev container, for the pinned toolchain; see
  [developer setup](docs/development.md#codespaces-or-a-local-dev-container).

## Ground rules

- **Fictional scenario.** The publisher, its titles, authors, imprints, figures, documents and mail
  are invented. Never write a real customer, company or person name into the repository, including
  the client this proof of concept is for.
- **No sensitive data.** Never commit or paste credentials, tokens, tfvars, `.env` files, Terraform
  state, saved plans, logs, rendered agent definitions, app settings, deployment receipts or tenant,
  subscription or physical Fabric IDs.
- **Static checks are the test.** Never run a live `plan`, `apply`, `destroy`, deployment or notebook
  as a check of a change. Live work runs against an environment of your own that you choose
  explicitly ([test a change live](#test-a-change-live)).
- **One governed action.** The reprint request is the agents' only tool that changes anything. Don't
  add another write tool, widen its arguments or roles, or approve a request on a user's behalf.
- **Portable identities.** Keep `.platform` logical IDs, TMDL lineage tags and binding markers
  stable; they are not deployment IDs.
- **Locked dependencies.** Keep each `package-lock.json` (`app/` and the reprint request server in
  `scenario/workflows/reprint-request/`) in step with its `package.json`, on public npm registry URLs
  ([npm lockfile](#npm-lockfile)); never hand-edit its hashes.
- **Pins.** Do not upgrade providers, tools or dependencies in an unrelated change.
- **Docs in step.** Keep the [README](README.md), [getting started](docs/getting-started.md) and
  `infra/terraform.tfvars.example` aligned with any input or behavior change. When the data, a rule
  or an approved document changes, update the [storyline](scenario/data/README.md#storyline), the
  tests and the [evals](scenario/evals/README.md) together.

## Make a change

1. Create a branch from `main` and keep the change focused.
2. Run the checks below, then push the branch.
3. Open a pull request into `main` and fill in its template. CI runs on every pull request, with a
   read-only token and no secrets or cloud access. Fix any failures.
4. Say what the checks couldn't prove: cloud permissions, preview availability, quota or ingestion.
5. A maintainer reviews the pull request and squash-merges it once it's approved.

## Run the checks

[CI](.github/workflows/ci.yml) runs these on every pull request. Run them locally first:

```sh
# Terraform, from infra/
terraform init -backend=false -input=false -lockfile=readonly
terraform fmt -check -recursive
terraform validate

# Python helpers and agent definitions, from the repository root
python3 -B -m unittest discover -s .github/skills/deploy-platform/tests
python3 -B .github/skills/deploy-platform/scripts/foundry_agent.py validate
python3 -B -m unittest discover -s .github/skills/runtime-integration/tests
python3 -B -m unittest discover -s .github/skills/fabric-workspace/tests

# App, in app/
(cd app && npm ci && npm run lint && npm run build && npm test)

# App image, from the repository root, where Docker is available
docker build --tag app:check app

# Reprint request server, in scenario/workflows/reprint-request/
(cd scenario/workflows/reprint-request && npm ci && npm run lint && npm run typecheck && npm test)
docker build --tag reprint-request:check scenario/workflows/reprint-request
```

CI also parses every tracked Python file without running it, checks shell syntax, and starts
the app image with placeholder settings to check its health endpoint, its refusal of an
unauthenticated question and of a missing configuration, and the redirect bridge's framing
header. It starts the reprint request server's image the same way, to check its health endpoint
and its refusal of an MCP request without a token and of a missing configuration.

If `infra/` holds local deployment files, validate an isolated copy as described in the
[template-maintenance skill](.github/skills/template-maintenance/SKILL.md#run-static-checks-only),
which also lists the checks for notebooks, the initializer and the dev container. In Copilot,
ask it to statically validate the change.

### npm lockfile

`app/package-lock.json` and `scenario/workflows/reprint-request/package-lock.json` must resolve
every package from `https://registry.npmjs.org/`; CI rejects other hosts. If your npm
configuration uses an Azure Artifacts mirror, normalize the lockfile from its folder after
changing dependencies. Integrity hashes are unchanged, and npm still routes
these URLs through your configured registry.

```sh
node -e 'const fs=require("fs"),f="package-lock.json";fs.writeFileSync(f,fs.readFileSync(f,"utf8").replace(/("resolved": ")https:\/\/[^"]+?\/_packaging\/[^"\/]+\/npm\/registry\//g,"$1https://registry.npmjs.org/"))'
```

## Test a change live

Static checks can't prove deployment behavior. To try a change end to end, push your branch and
deploy it to a DEV environment of your own, from a fresh checkout of the branch, following
[getting started](docs/getting-started.md): a distinct `project_name`, your own state, and your branch
as the published branch (`--github-branch` on the first `deploy.py up`). Rerun `up` after each commit;
it changes only what changed and asks you to approve each plan. Run the
[evals](scenario/evals/README.md) after a change to the agents, the documents or the data, and approve
a reprint request only when you mean to act: DEV can't take it back.

Share only redacted evidence in your pull request. Never commit deployment output, such as tfvars,
state, deployment receipts or evidence, rendered agent definitions, app settings or bound workspace
definitions.

## Review pull requests

For reviewers:

- Read the whole diff before approving. CI runs with a read-only token and no secrets; keep it that
  way, and never add `pull_request_target`.
- Treat changes to `AGENTS.md`, `.github/`, `.devcontainer/` and dependency manifests as code that
  runs with deployers' credentials or steers their agents.
- Check the ground rules above: no real names, no sensitive data or deployment IDs, and docs in step
  with the change.

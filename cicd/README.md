# Native Fabric bootstrap and promotion

Bootstrap DEV through [Bulk Import Item Definitions](https://learn.microsoft.com/rest/api/fabric/core/items/bulk-import-item-definitions), using the Azure user's Fabric token. **No PAT is required.** [Git integration](https://learn.microsoft.com/fabric/cicd/git-integration/intro-to-git-integration) is opt-in with `fabric_git_enabled = true`. Both paths attach the [Bootstrap deployment plan](https://learn.microsoft.com/fabric/cicd/deployment-plan/deployment-plan-overview); promotion uses [native deployment pipelines](https://learn.microsoft.com/fabric/cicd/deployment-pipelines/intro-to-deployment-pipelines).

[![Fabric lifecycle: explicitly attach Bootstrap to native Git sync into DEV, review and commit the target binding, then promote reviewed live definitions to TEST. PROD is separately provisioned and approved. Within DEV/TEST, Bootstrap's eight groups follow their dependencies: the lakehouse and its seed, the Eventhouse and its KQL database, the signal run after both, then the ontology and its binding, and the document publisher after the lakehouse; definitions travel, but OneLake and KQL data do not.](../docs/diagrams/fabric-lifecycle.svg)](../docs/diagrams/fabric-lifecycle.svg)

[Editable Excalidraw source](../docs/diagrams/fabric-lifecycle.excalidraw) | [Complete DEV deployment flow](../docs/deployment-flow.md) | [Icon sources](../docs/diagram-authoring.md#official-icon-sources)

The diagram shows the opt-in Git path; native import uses the same items and plan.

There is no fabric-cicd dependency or `fab deploy` configuration. The [deterministic runner](../docs/development.md#deploy-deterministically) performs the initial DEV bootstrap below with exactly these native APIs. Start with [getting started](../docs/getting-started.md); infrastructure and the project-specific user-auth registration use plain Terraform, one state and one local tfvars file. The registration prepares delegated Git/item/pipeline scopes, not tenant consent or a runtime user token. Derived repositories own promotion automation, unattended CI, tests and approval gates.

## Ownership and included items

Terraform owns the project-specific user-auth registration, capacity, workspaces, permissions, the optional GitHub credentials connection, the DEV/TEST deployment pipeline, Foundry, Search, Web IQ, the agents' connections and the hosting of the app and the reprint request server. An administrator owns consent; shared Microsoft enterprise applications are read-only lookups, not Terraform-owned assets. The repository owns workspace item definitions, deployed by native import or opt-in Git sync. The seeder inserts only missing demo keys and initial starter content, and the document publisher only missing approved documents; the signal notebook replaces only its derived tables, inserts only new reprint requests into the lakehouse and appends each run to the KQL database. Do not also manage these item definitions with Terraform.

| Git item | Purpose |
| --- | --- |
| [`Books.Lakehouse`](../workspace/Books.Lakehouse) | Schema-enabled lakehouse with default schema `dbo`; Git does not contain its data. |
| [`SeedBooks.Notebook`](../workspace/SeedBooks.Notebook/notebook-content.py) | A deterministic generator for the fictional book portfolio and a starter document in the `documents` knowledge folder, embedded in code so they travel through Git and native promotion. |
| [`ComputeBookSignals.Notebook`](../workspace/ComputeBookSignals.Notebook/notebook-content.py) | The fixed rules that derive the latest week's title signals, decision options and title performance from the seeded tables. Each run first copies the reprint requests recorded in `BookSignals` into `dbo.reprint_requests`, insert-only, and last appends its rows to `BookSignals`. |
| [`BookEvents.Eventhouse`](../workspace/BookEvents.Eventhouse) | The Eventhouse that hosts the `BookSignals` KQL database, on the workspace's capacity. Fabric may also give it a default database of its own name, which nothing uses. |
| [`BookSignals.KQLDatabase`](../workspace/BookSignals.KQLDatabase) | The tables and functions behind the reprint request server: each signal run and the recorded requests ([data contract](../scenario/data/README.md#booksignals-kql-database)). A data item: its definition is imported once and never replaced. |
| [`BooksOntology.Ontology`](../workspace/BooksOntology.Ontology) | New-experience TMDL book entities and their relationships, initially without environment-specific partitions. |
| [`BindBooks.Notebook`](../workspace/BindBooks.Notebook/notebook-content.py) | Wait for scoped SQL metadata refresh and bind BooksOntology to the current workspace's lakehouse through its SQL analytics endpoint, with every `ONT_*` source pin. |
| [`PublishBooksKnowledge.Notebook`](../workspace/PublishBooksKnowledge.Notebook/notebook-content.py) | Insert-only publication of the [approved documents](../scenario/knowledge/README.md) to the `documents` knowledge folder; their exact bytes and SHA-256 digests are embedded in code, so they travel through Git and native promotion. |
| [`Bootstrap.DeploymentPlan`](../workspace/Bootstrap.DeploymentPlan/plan.yml) | Deploy the lakehouse and run the seed notebook, deploy the Eventhouse and its KQL database, run the signal notebook, deploy the ontology, then run its binding notebook; independently, after the lakehouse, run the document publisher. |

The generic item names are local to each project's workspaces. Preserve each `.platform` logical ID across environments. If you rename `Books` or `BooksOntology`, update notebook parameters and plan actions together. The plan uses logical IDs, while Terraform's `knowledge_lakehouse_id` and `knowledge_ontologies` inputs require physical DEV item GUIDs.

Keep notebook defaults in executable `# PARAMETERS CELL` sections. This delimiter preserves the parameter-cell role through Fabric Git; a `tags` entry in the language metadata does not. A `# PARAMETERS` heading alone is not a code-cell delimiter and can cause Fabric to import the defaults as Markdown.

The seeder uses the current runtime workspace, never a saved DEV workspace ID or default lakehouse attachment. It writes the [book portfolio's raw tables](../scenario/data/README.md) under `Tables/dbo` and `Files/documents/starter.txt`, which the default `documents` knowledge folder indexes. Existing rows (including edited demo rows) and the existing file are retained. `ComputeBookSignals` then replaces only its three derived tables, from the same workspace's raw tables, after inserting any new reprint requests from the same workspace's `BookSignals` KQL database, and appends the run to that database. `PublishBooksKnowledge` resolves the lakehouse the same way and writes the [approved documents](../scenario/knowledge/README.md) beside `starter.txt`; it never overwrites a file, stops before writing anything when one holds different content, and reads every file back, so a revision gets a new versioned file name. Incompatible table schemas/non-Delta paths and write failures stop the run; no data is silently replaced. Serialize seed runs per workspace.

## Initial native bootstrap

Leave `fabric_git_enabled = false`. The runner's `bootstrap` phase imports only
tracked item files from the reviewed, published `workspace/` revision with
`allowPairingByName: false` and the incoming `Bootstrap` plan's logical ID.
It checks item identities, records operation receipts, verifies every per-item
result and imports only missing items on a reviewed retry. Existing data,
definitions and generated bindings are not overwritten.

Review the live DEV binding before promotion. If committing a binding export,
use the native Get Definition API and review the resulting parts in the derived
repository; Git synchronization is not required. Freeze DEV during promotion
and rebind every target. See [native requests](../.github/skills/deploy-platform/references/native-requests.md#native-item-import-default).

## Initial Git synchronization (opt-in)

Set `fabric_git_enabled = true` and complete the optional Git section in
[preparation](../preparation.md#optional-fabric-github-synchronization).

After the first Terraform apply, use **Connect and sync with deployment plan** in DEV and select the incoming `Bootstrap` plan. Connect to the configured GitHub branch and `/workspace` directory. Include every item in `workspace/`. Each notebook is itself a deployment group, so it exists before its post-action runs even in an empty workspace.

The first binding run modifies the live ontology definition. Review and commit that generated DEV binding and service-normalized TMDL through Fabric Git before promotion. The binder must run in each target to replace those environment-specific source details. See [seeded ontologies](../docs/ontology-knowledge.md) for the ownership, concurrency and authentication constraints.

**Committing a plan doesn't activate it.** Attach it to each initial sync, update, branch operation or pipeline deployment that needs its actions. A Git push alone doesn't synchronize Fabric or run a notebook.

Git connection initialization is intentionally outside Terraform: the pinned Fabric provider's `fabric_workspace_git` resource automatically initializes/syncs but cannot attach a plan. Do not add it alongside the native bootstrap operation.

### Automating the same operation

Use the documented [Git automation APIs](https://learn.microsoft.com/fabric/cicd/git-integration/git-automation) and [deployment-plan API extension](https://learn.microsoft.com/fabric/cicd/deployment-plan/deployment-plan-automation), not another Terraform provisioner. The runner's `bootstrap` phase implements these steps for DEV, including the explicit `--bootstrap-fallback notebooks` path when a tenant rejects plan attachment:

1. Authenticate to Fabric with Entra. The caller needs workspace permissions, the original API scopes, and `Item.Execute.All` when attaching a plan. The bundled binder uses a user-context NotebookUtils token; service-principal automation needs an explicitly configured authentication flow in the derived project, in addition to tenant/item support. See [binding authentication](../docs/ontology-knowledge.md#included-scenario).
2. Read `terraform -chdir=infra output -json github_connect_request` and submit that body to `POST /v1/workspaces/{devWorkspaceId}/git/connect`. It contains the repository, branch, directory and credentials connection ID, not the PAT.
3. Call `POST /v1/workspaces/{devWorkspaceId}/git/initializeConnection` with `{"initializationStrategy":"PreferRemote"}`. Follow the returned required action. Initialize Connection itself does not accept a plan.
4. When an update is required, call `POST /v1/workspaces/{devWorkspaceId}/git/updateFromGit?beta=true` with the returned workspace head, the reviewed remote commit hash and the plan option below. For later updates, read current Git status first. Stop on conflicts rather than unconditionally overriding workspace changes.
5. Poll asynchronous operations to their terminal result, respecting `Retry-After`, and propagate item/action failures. A `202` response is not completion. Stop the workflow on failure; Fabric doesn't roll back earlier successful groups.

The plan option belongs inside the **existing request's `options`** object:

```json
{
  "options": {
    "deploymentPlan": {
      "logicalId": "17fca947-7a9f-4822-91ac-cd6aa8256e75",
      "referenceType": "ByLogicalId"
    }
  }
}
```

This is only the options fragment, not a full Update From Git request. Keep its required commit/head fields. The logical ID comes from [`Bootstrap.DeploymentPlan/.platform`](../workspace/Bootstrap.DeploymentPlan/.platform). Do not replace it with a physical item ID for Git updates.

A no-op Git update is not a reliable reseed trigger. Run the notebook separately when data needs bootstrapping again.

## Running only the seeder

Open `SeedBooks` and run all cells, or invoke it through the [notebook Job Scheduler APIs](https://learn.microsoft.com/fabric/data-engineering/notebook-public-api). Resolve the notebook's physical item ID in the target workspace; poll the job to completion and surface its failure reason. This path doesn't require a new commit or a deployment plan. Run `ComputeBookSignals` after it, the same way, so the derived tables describe the latest week; a later `through_week`, such as `27`, adds that week's rows and advances the demo by a week. `ComputeBookSignals` needs the workspace's `BookSignals` KQL database (its `kql_database_name` parameter). Run it again after a reprint request is approved, too: it copies the request into the lakehouse, which marks its inventory risk *Actioned*.

The parameter defaults target `Books` and allow only workspace names ending in `-dev` or `-test`. This is a demo-data guard, not an authorization boundary. For a deliberate exception, supply the Boolean `allow_other_workspaces=true` for that run; never a truthy string. The included plan explicitly passes `false`.

Seed code is bootstrap, not continuous data synchronization: changing an existing fixture in Git doesn't overwrite the corresponding existing row or file. Add reviewed data migrations/ingestion to your derived project when updates are needed.

## Adding ontologies, graphs and semantic models

The repository supplies a complete **book portfolio ontology**, its seed data, signal rules and target-binding action. It does not include a separate graph or Power BI semantic model. Author additional items in DEV, then commit their real Fabric-exported definitions and `.platform` files through Git. Register additional DEV ontologies with the knowledge base using `knowledge_ontologies`; see [the ontology guide](../docs/ontology-knowledge.md).

Its relationships, such as `editions.title_id -> titles.title_id` and `decision_options.signal_id -> title_signals.signal_id`, can back ontology entities, graph nodes and edges, or a semantic model of sales by title, territory and channel.

Add each new item as a deployment group in `Bootstrap` (or an appropriately named release plan) with its real prerequisites. Use `SeedBooks` for raw Delta data, `ComputeBookSignals` for the derived tables, or **BindBooks** for consumers that require the books' SQL metadata or bound ontology. Supply a separate explicit binding action for a different ontology schema. A dependency covers the whole group, including its post-actions; file order alone is not ordering. Commit the changed plan with the items it references and select those items in the operation.

| Item | Additional work beyond deploying its definition |
| --- | --- |
| Ontology (preview) | BindBooks configures its target lakehouse. For additional ontologies, provide their own target-specific bindings; if generated from a semantic model, order them after that model. |
| Graph model/query set | Map node/edge sources to target tables and arrange loading/refresh. [API-created graph models currently require a first portal open](https://learn.microsoft.com/fabric/graph/manage-data) to initialize loading infrastructure; do not assume definition import alone makes them queryable. |
| Semantic model | Set target data-source/connection parameters and arrange refresh or Direct Lake framing as applicable. Workspace-specific SQL endpoint URLs and database IDs don't automatically rebind through Git. |

Review [cross-workspace dependency binding](https://learn.microsoft.com/fabric/cicd/cross-workspace-dependency-binding) for every reference. A plan's logical IDs identify items; they do not rewrite every dependency inside those items. Connections, credentials, workspace identities and other workspace settings are configured separately. Keep tokens and passwords out of item files and plan parameters.

Only [supported executable items](https://learn.microsoft.com/fabric/cicd/deployment-plan/deployment-plan-actions#item-types-you-can-run-as-an-action) can be plan actions: notebooks, data pipelines, Dataflow Gen2, copy jobs and user data functions. Ontologies, graphs and semantic models can be deployed as groups; they are not generic `Execute` actions. A refresh step can instead run a supported data pipeline/notebook using the target item's documented API and permissions.

An action finishes when its own run finishes, not when downstream services catch up. The seeder completes Delta writes, and the signal notebook its Delta writes and KQL appends; `PublishBooksKnowledge` completes its file writes and readback, not their indexing, which the `documents` source does on its next five-minute run; `BindBooks` explicitly refreshes and checks SQL metadata for **only the seven ontology tables**. None of them loads a graph or refreshes a separate semantic model. Add bounded readiness/refresh actions for other consumers and fail on timeout; do not substitute an arbitrary sleep.

Prefer small synthetic fixtures embedded in notebook code or an authenticated data source. Notebook `Resources/builtin/` files can be [tracked by Git](https://learn.microsoft.com/fabric/data-engineering/notebook-source-control-deployment#notebooks-resources-folder-support-in-git), but deployment-pipeline/public-API support is currently limited; the starter doesn't depend on this feature.

The indexed Foundry IQ sources remain scoped to the `knowledge_folders` folders of the selected DEV lakehouse's **Files** area. Ontologies registered through `knowledge_ontologies` are separate live `fabricOntology` sources in the check-only knowledge base, which require an end-user token at retrieval time, and Fabric IQ connections that the with-IQ agent uses as the signed-in user. Creating a table/ontology/graph without registration does not expose it automatically.

## Promoting through TEST and PROD

Terraform creates a native deployment pipeline with DEV and TEST assigned. Find it using `deployment_pipeline_id` and `deployment_pipeline_stage_ids`. It doesn't deploy items.

1. Bootstrap and bind DEV, review generated bindings and record the reviewed source revision. With Git enabled, commit binding/normalization changes and confirm source control is clean. Freeze DEV during promotion: native pipelines copy live definitions, not a Git checkout.
2. In the deployment pipeline, select every item from `workspace/`, including any added consumers. For the first TEST deployment, choose the **incoming source `Bootstrap` plan** and include it in the selection; TEST doesn't yet contain a plan. Configure required target connections/settings before actions depend on them.
3. Deploy to TEST, wait for the plan/actions, then verify data, bindings and consumer readiness. TEST gets its own data and SQL endpoint binding, not DEV's contents. Target-binding differences are expected; other business-definition changes require review. Subsequent deployments may default to the target plan: explicitly choose the reviewed version.
4. After approval, promote the same reviewed business definitions from TEST to your separately provisioned PROD, rebinding to PROD's sources. Freeze TEST after validation and don't promote later edits accidentally. Provision/assign PROD and define its reviewed release plan and approval policy in the derived project first.

PROD should normally use ingestion from approved production sources, not synthetic fixtures. The bundled plan fails its seeder and document-publisher actions outside `*-dev`/`*-test`. Define a separate production release plan that omits/replaces those demo actions but retains the necessary target binding, or explicitly authorize demo seeding for a deliberate demo environment. The binding notebook itself does not insert demo data. Version and review both plans with the same release; don't silently weaken the default guard.

For automation, use Fabric's [Deploy Stage Content API with a deployment plan](https://learn.microsoft.com/fabric/cicd/deployment-plan/deployment-plan-automation#deploy-content-between-pipeline-stages): add `beta=true` and `options.deploymentPlan` with the plan's physical `itemId` and `referenceType: "ByItemId"`. Retain the normal source/target stage fields and selected items, and poll the operation. This is different from Git's logical-ID reference.

Fabric pipelines promote Fabric items only. The prompt agents, the web app and the reprint request server serve DEV: their Fabric IQ connection targets the DEV ontology, and the server records requests in DEV's `BookSignals`. A TEST or PROD agent needs its own Foundry project, connections to that stage's bound ontology and knowledge bases, its own reprint request server, and a release designed in the derived project.

The pinned Terraform provider treats changes to the pipeline's `stages` as replacement. Review the plan when extending it for PROD; don't change Terraform-owned stage assignments only in the portal and expect Terraform to preserve that drift.

Native pipeline promotion leaves items absent from the source in place; this template does not automate orphan deletion. Git synchronization can apply reviewed item deletions, and deleting a lakehouse/workspace can destroy its data. Treat deletions as explicit changes, not cleanup. A failed deployment can leave partial changes; inspect them before rerunning. The insert-only seeder is safe to rerun after resolving the failure.

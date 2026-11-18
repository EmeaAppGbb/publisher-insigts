# Reprint request MCP server

The book performance assistant's one write action. A small Node.js MCP server, deployed as the container app
`ca-<prefix>-mcp`, exposes exactly one tool, `submit_reprint_request`, to the **with IQ** Foundry prompt agent. Foundry
asks the signed-in user to approve each call in the web app (`require_approval: always`) and then calls the server
with that user's own access token, through the `reprint-request` connection's OAuth identity passthrough. The server
checks the token, checks every argument against the governed rows of the week in the `BookSignals` KQL database,
enforces the decision authority matrix (BKS-GOV-003) with app roles, and records the request in that database as its
own managed identity. ComputeBookSignals copies recorded requests into the lakehouse, which marks the inventory risk
**Actioned**.

## Layout

| Path | What it holds |
| --- | --- |
| `src/config.ts` | Settings from the environment; an incomplete configuration stops the server at start |
| `src/auth.ts` | Token verification: the approver's object ID, name and reprint roles |
| `src/authority.ts` | BKS-GOV-003 §1 and §2: the required approver for an option and the production line |
| `src/kusto.ts` | The Kusto REST client: token audience, v1 responses, the database name, the `.append` command |
| `src/requests.ts` | The tool's checks, idempotency and write, then the read-back |
| `src/mcp.ts` | The tool's description, input and output schemas and annotations |
| `src/http.ts`, `src/readiness.ts`, `src/main.ts`, `src/shutdown.ts` | Routes, the store check, the entry point and graceful shutdown |
| `tests/` | `node --test` with type stripping, against a fake Eventhouse holding the week-26 rows and tokens signed with local keys |

## Endpoints

- `POST /mcp`: MCP over Streamable HTTP, stateless, with JSON responses. Every request needs the user's bearer token;
  without a valid one the answer is `401` with `WWW-Authenticate: Bearer` before the body is read. `tools/list` needs
  no reprint role; `tools/call` does. Bodies over 64 KB are refused.
- `GET` or `DELETE /mcp`: `405`. A stateless server has no session stream.
- `GET /healthz`: `ok` while the process runs. The container's probes use only this route, so they never wake the
  Eventhouse.
- `GET /readyz`: `{ "ready": true, "roles": ["Viewer", "Ingestor"], "version": "…" }` once the managed identity holds
  both database roles, from `.show database ['<database>'] principal roles`; otherwise `503`, with the roles it holds
  and, when the store could not be checked, a short `code`. The answer is kept for 60 seconds.

Each request but `/healthz` is logged as one JSON line: method, route, status, duration and, for `tools/call`, the
tool and its outcome code. Tokens, arguments, the rationale, the evidence and names are never logged.

## The tool

`submit_reprint_request` takes `signal_id`, `option_id`, `edition_id`, `territory`, `quantity`, `expedited`,
`investment_gbp`, `rationale` (20 to 600 characters) and `evidence` (10 to 600 characters), all required. In order,
the server checks that:

1. The arguments match the schema.
2. The signal is in `latest_title_signals()`, is an `Inventory risk` and is `Open`.
3. The option is in `latest_decision_options()`, belongs to that signal, is its `expedite` or `standard` reprint, and
   its edition, territory, units, expedite code and investment equal the arguments.
4. The user holds the required approver's role, or a more senior role in the production line.
5. No request for the same edition and territory was approved on or after the week the risk was first detected
   (BKS-POL-001 §6). The same request again returns the recorded one with `created: false`; any other is refused,
   naming the request that already actions the risk.

The request ID is `rr-` and the signal ID without `sig-`. The server appends the row with ingest-from-query, the
values in a base64 JSON payload and an `ingestIfNotExists` tag of the request ID, under an in-process lock per edition
and territory. It reports the request only after reading the row back. A refusal is a tool error with one actionable
sentence; it never repeats the rationale or the evidence.

## Authority

The reprint API registration declares the delegated scope `ReprintRequest.Submit` and four app roles, the production
line from lowest to highest (BKS-GOV-003 §2):

| App role | Approver | Approves (BKS-GOV-003 §1) |
| --- | --- | --- |
| `Reprint.ProductionPlanningManager` | Production planning manager | A standard reprint up to £50,000 |
| `Reprint.HeadOfProductionPlanning` | Head of production planning | A standard reprint from £50,001 to £150,000 |
| `Reprint.PublishingDirector` | Publishing director | An expedited reprint up to £150,000 |
| `Reprint.ManagingDirector` | Managing director | Any reprint over £150,000 |

The record names the approver (the token's `name`, else `upn` or `unique_name`), their object ID, the role that
approved and the required approver. Terraform assigns the deployer the Publishing director role; assigning others is
an operator step.

## Identity and permissions

- **Users' tokens**: Microsoft Entra access tokens for `api://<reprint API client ID>`, issued in the tenant to the
  OAuth client registration of Foundry's `reprint-request` connection, with the `ReprintRequest.Submit` scope. The
  server checks the signature against the tenant's keys, the issuer (v1 or v2), the audience, the tenant, the client
  (`appid` or `azp`), the scope and the object ID. It holds no secret.
- **The server's managed identity**: Database **Viewer** and Database **Ingestor** on the `BookSignals` KQL database
  only, and no workspace role. It reads the governed functions and `reprint_requests`, and appends with `.append`,
  which needs no more than Ingestor. The token audience comes from the Eventhouse's `/v1/rest/auth/metadata`, else
  `https://kusto.kusto.windows.net`.
- **The database name**: `KQL_DATABASE` holds the display name and `KQL_DATABASE_ID` the item ID. On first use the
  server resolves the Kusto database name with `.show databases`: exactly one row whose `DatabaseName` or `PrettyName`
  equals the display name, or whose `DatabaseName` is the item ID. That command needs an Eventhouse-wide role
  (AllDatabasesMonitor), which the identity doesn't hold, so the server then reads the database's own identity in its
  context, named by the item ID and then by the display name. With no or several matches the store is unavailable:
  `/readyz` is not ready and tool calls are refused.

## Settings

| Variable | Value |
| --- | --- |
| `ENTRA_TENANT_ID` | The Entra tenant |
| `REPRINT_API_CLIENT_ID` | The reprint API registration: the users' tokens' audience |
| `REPRINT_OAUTH_CLIENT_ID` | The OAuth client registration the Foundry connection signs users in with |
| `KQL_QUERY_URI` | The Eventhouse query URI, `https://<cluster>.kusto.fabric.microsoft.com`: the only host that receives the managed identity's token |
| `KQL_DATABASE` | The KQL database's display name, `BookSignals` |
| `KQL_DATABASE_ID` | Optional: the KQL database's Fabric item ID, which Fabric may use as its Kusto database name |
| `AZURE_CLIENT_ID` | The server's user-assigned managed identity |
| `PORT`, `APP_VERSION` | Optional: 8080, and the image tag `/readyz` reports |

## Commands

From `scenario/workflows/reprint-request/`, with Node.js 24.11 or later:

| Command | Runs |
| --- | --- |
| `npm ci` | Installs the locked dependencies |
| `npm run typecheck`, `npm run lint` | TypeScript and ESLint |
| `npm test` | The unit and end-to-end tests: tokens, the authority matrix against BKS-GOV-003, the store's KQL, the checks, the routes and a full MCP exchange through the SDK's transport |
| `npm run build` | Bundles the server into one module, `dist/main.mjs` |
| `npm start` | The built server on port 8080, with the settings from an ignored `.env.local` |

Outside Azure the managed identity has no token, so a local run serves `/healthz`, checks tokens and lists the tool,
but its store calls fail and are refused.

## Image

`Dockerfile` builds from this folder as the context: Node 24 bundles the server, and a distroless, non-root Node 24
image runs only `dist/`, without `node_modules`, on port 8080. The deployment runner builds it with ACR Tasks into the
`reprint-request` repository. Where your network blocks `registry.npmjs.org`, add
`--build-arg NPM_REGISTRY=<npm mirror URL>`.

```sh
docker build --tag reprint-request scenario/workflows/reprint-request
```

Keep `package-lock.json` on `https://registry.npmjs.org/` URLs; CI rejects other hosts
([npm lockfile](../../../CONTRIBUTING.md#npm-lockfile)).

// Shared test fixtures: tokens signed with local keys in place of Entra's, and a fake Eventhouse that answers the
// server's KQL like the real BookSignals database would, from the week-26 storyline's governed rows.
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type CryptoKey, type JWTPayload } from 'jose'
import { createTokenVerifier } from '../src/auth.ts'
import { KustoError, type KustoClient, type Row } from '../src/kusto.ts'

export const tenant = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
export const apiClient = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
export const oauthClient = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
export const director = '11111111-1111-4111-8111-111111111111'
export const now = new Date('2026-11-18T14:30:00Z')

const signing = await generateKeyPair('RS256')
export const otherKeys = await generateKeyPair('RS256')
const jwk = { ...(await exportJWK(signing.publicKey)), kid: 'entra-key', alg: 'RS256' }
export const keys = createLocalJWKSet({ keys: [jwk] })
export const verify = createTokenVerifier({ tenantId: tenant, apiClientId: apiClient, oauthClientId: oauthClient, keys, currentDate: now })

// A v1 access token for the reprint API, as Entra issues one to Foundry's OAuth client for the signed-in publishing
// director. Claims set to undefined are left out.
export async function token(claims: JWTPayload = {}, key: CryptoKey = signing.privateKey): Promise<string> {
  const seconds = Math.floor(now.getTime() / 1000)
  const { aud = `api://${apiClient}`, iss = `https://sts.windows.net/${tenant}/`, exp = seconds + 3600, ...rest } = claims
  return new SignJWT({
    tid: tenant, appid: oauthClient, scp: 'ReprintRequest.Submit', oid: director, name: 'Rowan Ashdown',
    roles: ['Reprint.PublishingDirector'], ...rest,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'entra-key', typ: 'JWT' })
    .setIssuer(String(iss))
    .setAudience(aud as string | string[])
    .setIssuedAt(seconds - 60)
    .setExpirationTime(Number(exp))
    .sign(key)
}

export const SIGNAL = 'sig-20261102-title-001-inv-ed-001-hb-uk'
export const EXPEDITE = `${SIGNAL}-expedite`
export const STANDARD = `${SIGNAL}-standard`
export const REALLOCATE = `${SIGNAL}-reallocate`
export const ACTIONED = 'sig-20261102-title-002-inv-ed-002-pb-us'
export const DATABASE_GUID = '5f0c2a6e-8d1b-4e7a-9c3d-2b6e1f4a7c90'

const run = { run_id: '6d2f8a1c-3b4e-4f5a-8c7d-9e0f1a2b3c4d', computed_at: '2026-11-02T06:15:00Z' }
const week = { as_of_week: '2026-11-02T00:00:00Z', ...run }

export function signalRows(): Row[] {
  return [
    {
      signal_id: SIGNAL, title_id: 'title-001', title_name: 'The Glass Orchard', author_name: 'Mara Ellison',
      signal_type: 'Inventory risk', edition_id: 'ed-001-hb', format: 'Hardback', territory: 'UK',
      first_detected_week: '2026-10-26T00:00:00Z', material_since_week: null, opportunity_at_risk_gbp: 84571,
      is_material: 'No', status: 'Open', recommended_option: 'Expedited reprint', ...week,
    },
    {
      signal_id: 'sig-20261102-title-001-fcv', title_id: 'title-001', title_name: 'The Glass Orchard',
      author_name: 'Mara Ellison', signal_type: 'Forecast variance', edition_id: null, format: null, territory: null,
      first_detected_week: '2026-10-12T00:00:00Z', material_since_week: '2026-10-19T00:00:00Z', actual_vs_forecast: 3.1,
      is_material: 'Yes', status: 'Open', recommended_option: null, ...week,
    },
    {
      signal_id: ACTIONED, title_id: 'title-002', title_name: 'Winter Light at Hollins Moor', author_name: 'Mara Ellison',
      signal_type: 'Inventory risk', edition_id: 'ed-002-pb', format: 'Paperback', territory: 'US',
      first_detected_week: '2026-10-19T00:00:00Z', material_since_week: null, opportunity_at_risk_gbp: 6120,
      is_material: 'No', status: 'Actioned', recommended_option: 'Expedited reprint', ...week,
    },
  ]
}

export function optionRows(): Row[] {
  const glass = { signal_id: SIGNAL, title_id: 'title-001', title_name: 'The Glass Orchard', edition_id: 'ed-001-hb', territory: 'UK', opportunity_at_risk_gbp: 84571 }
  return [
    { option_id: EXPEDITE, ...glass, option_name: 'Expedited reprint', is_recommended: 'Yes', units: 20000, investment_gbp: 50000, revenue_protected_gbp: 84571, remaining_risk_gbp: 0, arrival_days: 21, ...week },
    { option_id: STANDARD, ...glass, option_name: 'Standard reprint', is_recommended: 'No', units: 32000, investment_gbp: 67200, revenue_protected_gbp: 0, remaining_risk_gbp: 84571, arrival_days: 35, ...week },
    { option_id: REALLOCATE, ...glass, option_name: 'Reallocate stock from other territories', is_recommended: 'No', units: 8658, investment_gbp: 2597, revenue_protected_gbp: 83117, remaining_risk_gbp: 1454, arrival_days: 7, ...week },
    {
      option_id: `${ACTIONED}-standard`, signal_id: ACTIONED, title_id: 'title-002', title_name: 'Winter Light at Hollins Moor',
      edition_id: 'ed-002-pb', territory: 'US', option_name: 'Standard reprint', is_recommended: 'No', units: 3000,
      investment_gbp: 3450, revenue_protected_gbp: 0, remaining_risk_gbp: 6120, arrival_days: 28, opportunity_at_risk_gbp: 6120, ...week,
    },
  ]
}

// The arguments the agent copies from the expedite option.
export function expediteArguments() {
  return {
    signal_id: SIGNAL, option_id: EXPEDITE, edition_id: 'ed-001-hb', territory: 'UK', quantity: 20000, expedited: true,
    investment_gbp: 50000, rationale: 'UK hardback cover runs out before a standard reprint lands; the expedited reprint protects the most revenue.',
    evidence: `${SIGNAL}; BKS-POL-001 §6; BKS-GOV-003 §1`,
  }
}

// Kusto's JSON rendering of a datetime: seven fraction digits when there is a fraction.
function kustoDate(value: unknown): string | null {
  const time = typeof value === 'string' ? Date.parse(value) : Number.NaN
  if (Number.isNaN(time)) return null
  const iso = new Date(time).toISOString()
  return iso.endsWith('.000Z') ? iso.replace('.000Z', 'Z') : iso.replace(/\.(\d{3})Z$/, (_, fraction: string) => `.${fraction}0000Z`)
}

const CONVERT: Record<string, (value: unknown) => unknown> = {
  tostring: (value) => (value === null || value === undefined ? '' : String(value)),
  tolong: (value) => (value === null || value === undefined ? null : Math.trunc(Number(value))),
  todatetime: kustoDate,
}

const QUERIES: [RegExp, (fake: FakeKusto, match: RegExpExecArray) => Row[]][] = [
  [/^latest_title_signals\(\) \| where signal_id == '([a-z0-9-]+)' \| project ([a-z_, ]+)$/, (fake, m) => fake.signals.filter((row) => row.signal_id === m[1])],
  [/^latest_decision_options\(\) \| where option_id == '([a-z0-9-]+)' \| project ([a-z_, ]+)$/, (fake, m) => fake.options.filter((row) => row.option_id === m[1])],
  [/^reprint_requests \| where edition_id == '([a-z0-9-]+)' \| project ([a-z_, ]+)$/, (fake, m) => fake.requests.filter((row) => row.edition_id === m[1])],
  [/^reprint_requests \| where request_id == '([a-z0-9-]+)' \| project ([a-z_, ]+)$/, (fake, m) => fake.requests.filter((row) => row.request_id === m[1])],
]
const APPEND = /^\.append reprint_requests with \(ingestIfNotExists = '\["([a-z0-9-]+)"\]', tags = '\["ingest-by:([a-z0-9-]+)"\]'\) <\| print r = parse_json\(base64_decode_tostring\('([A-Za-z0-9+/]+=*)'\)\) \| project (.+)$/
const PROJECTION = /^\['([a-z_]+)'\] = (tostring|tolong|todatetime)\(r\['([a-z_]+)'\]\)$/

export interface Call {
  endpoint: 'query' | 'mgmt'
  db?: string
  csl: string
}

// The BookSignals KQL database as the server's managed identity sees it. Its Kusto database name is a GUID with the
// display name as its pretty name, as Fabric names it, unless a test says otherwise.
export class FakeKusto implements KustoClient {
  calls: Call[] = []
  databases: Row[] = [
    { DatabaseName: DATABASE_GUID, PrettyName: 'BookSignals', DatabaseAccessMode: 'ReadWrite' },
    { DatabaseName: '0b7d3e9a-1c2f-4a5b-8e6d-7f9a0b1c2d3e', PrettyName: 'BookEvents', DatabaseAccessMode: 'ReadWrite' },
  ]
  roles: string[] = ['Viewer', 'Ingestor']
  signals = signalRows()
  options = optionRows()
  requests: Row[] = []
  tags = new Set<string>()
  // Answers `.show databases` with 403, as for a principal without an Eventhouse-wide role.
  forbidShowDatabases = false
  // Whether a request's database may name the database by its pretty name, as well as by its name.
  prettyNameInContext = true
  // Runs before each append is applied, such as another replica's write winning the race.
  beforeAppend?: () => void
  // Fails each append, before or after it lands.
  failAppend?: 'before' | 'after'
  // false to accept a second append with the same tag, to isolate the server's own lock.
  ingestIfNotExists = true

  get databaseName(): string {
    return String(this.databases.find((row) => row.PrettyName === 'BookSignals' || row.DatabaseName === 'BookSignals')?.DatabaseName)
  }

  async query(db: string, csl: string): Promise<Row[]> {
    this.calls.push({ endpoint: 'query', db, csl })
    this.requireDatabase(db)
    for (const [pattern, rows] of QUERIES) {
      const match = pattern.exec(csl)
      if (match) {
        const columns = match[2].split(', ')
        return rows(this, match).map((row) => Object.fromEntries(columns.map((column) => {
          if (!(column in row)) throw new Error(`Unknown column ${column}`)
          return [column, row[column]]
        })))
      }
    }
    throw new KustoError(400, 'BadRequest_SyntaxError')
  }

  async mgmt(db: string | undefined, csl: string): Promise<Row[]> {
    this.calls.push({ endpoint: 'mgmt', ...(db === undefined ? {} : { db }), csl })
    if (csl === '.show databases') {
      if (this.forbidShowDatabases) throw new KustoError(403, 'Forbidden')
      return this.databases
    }
    if (csl === '.show database identity') {
      const row = this.databases.find((candidate) => candidate.DatabaseName === db
        || (this.prettyNameInContext && candidate.PrettyName === db))
      if (!row) throw new KustoError(400, 'BadRequest_EntityNotFound')
      return [{ ...row, IsCurrent: true }]
    }
    const roles = /^\.show database \['([A-Za-z0-9_.-]+)'\] principal roles$/.exec(csl)
    if (roles) {
      this.requireDatabase(db)
      if (roles[1] !== this.databaseName) throw new KustoError(400, 'BadRequest_EntityNotFound')
      return this.roles.map((role) => ({
        Scope: 'Database', DisplayName: 'id-demo-reprint', AADObjectID: '22222222-2222-4222-8222-222222222222',
        Role: `Database ${roles[1]} ${role}`,
      }))
    }
    const append = APPEND.exec(csl)
    if (append) return this.append(db, append)
    throw new KustoError(400, 'BadRequest_SyntaxError')
  }

  private append(db: string | undefined, [, tag, ingestBy, payload, projection]: RegExpExecArray): Row[] {
    this.requireDatabase(db)
    if (tag !== ingestBy) throw new Error('The tag and its ingest-by tag differ')
    this.beforeAppend?.()
    if (this.failAppend === 'before') throw new KustoError(0, 'timeout')
    if (this.ingestIfNotExists && this.tags.has(tag)) throw new KustoError(400, 'BadRequest_IngestIfNotExists')
    const values = JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as Row
    const row: Row = {}
    for (const part of projection.split(', ')) {
      const [, column, conversion, source] = PROJECTION.exec(part) ?? []
      if (!column || column !== source) throw new Error(`Unexpected projection ${part}`)
      row[column] = CONVERT[conversion](values[source])
    }
    this.requests.push(row)
    this.tags.add(tag)
    if (this.failAppend === 'after') throw new KustoError(0, 'timeout')
    return [{ ExtentId: '7a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d', RowCount: 1 }]
  }

  // Another replica's request, already in the table under its tag.
  record(row: Row): void {
    this.requests.push(row)
    this.tags.add(String(row.request_id))
  }

  private requireDatabase(db: string | undefined): void {
    if (db !== this.databaseName) throw new KustoError(400, 'BadRequest_DatabaseNotExist')
  }
}

// A request row as Kusto returns it.
export function requestRow(overrides: Row = {}): Row {
  return {
    request_id: `rr-${SIGNAL.slice(4)}`, signal_id: SIGNAL, option_id: EXPEDITE, title_id: 'title-001',
    title_name: 'The Glass Orchard', edition_id: 'ed-001-hb', territory: 'UK', quantity: 20000, expedited: 'Yes',
    investment_gbp: 50000, rationale: 'Cover runs out before a standard reprint lands.', evidence: `${SIGNAL}; BKS-POL-001 §6`,
    required_approver: 'Publishing director', approver_role: 'Publishing director', approver_name: 'Tamsin Greaves',
    approver_object_id: '33333333-3333-4333-8333-333333333333', approved_at: '2026-11-17T09:12:44.5170000Z',
    status: 'Approved', as_of_week: '2026-11-02T00:00:00Z', ...overrides,
  }
}

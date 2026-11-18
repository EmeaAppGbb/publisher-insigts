// A small Kusto REST client for the Fabric Eventhouse, used as the server's managed identity: v1 query and management
// requests, the token audience from the service's auth metadata, the Kusto database name resolved from the KQL
// database's display name, and the `.append` command that records one row. Values reach KQL only as validated
// identifiers or inside a base64 JSON payload, so no free text is ever parsed as KQL. Errors carry the HTTP status and
// a short code, never the service's message.
import { randomUUID } from 'node:crypto'

export type Row = Record<string, unknown>

export interface KustoClient {
  query: (db: string, csl: string) => Promise<Row[]>
  // Without a database for commands that need none, such as `.show databases`.
  mgmt: (db: string | undefined, csl: string) => Promise<Row[]>
}

export class KustoError extends Error {
  // The HTTP status, or 0 when the service gave none.
  readonly status: number
  readonly code: string

  constructor(status: number, code: string) {
    super(`The Kusto request failed (${status || 'no response'}, ${code}).`)
    this.status = status
    this.code = code
  }
}

export const DEFAULT_KUSTO_RESOURCE = 'https://kusto.kusto.windows.net'
const ERROR_CODE = /^[A-Za-z0-9_.-]{1,80}$/
const IDENTIFIER = /^[a-z0-9-]{1,120}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NAME = /^[a-z_][a-z0-9_]{0,63}$/
// Fabric names a KQL database's Kusto database with a GUID; other Eventhouses may use the display name.
const DATABASE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,255}$/

// Signal, option and request IDs, and UUIDs: the only values the server writes into KQL text.
export function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && (IDENTIFIER.test(value) || UUID.test(value))
}

export function literal(value: string): string {
  if (!isIdentifier(value)) throw new TypeError('Only validated identifiers become KQL string literals.')
  return `'${value}'`
}

export function databaseReference(name: string): string {
  if (!DATABASE_NAME.test(name)) throw new TypeError('Not a Kusto database name.')
  return `['${name}']`
}

// The first table of a v1 response, as one object per row keyed by column name.
export function parseV1(body: unknown): Row[] {
  const tables = (body as { Tables?: unknown } | null)?.Tables
  const table = Array.isArray(tables) ? tables[0] as { Columns?: unknown; Rows?: unknown } | undefined : undefined
  if (!table || !Array.isArray(table.Columns) || !Array.isArray(table.Rows)) throw new KustoError(502, 'malformed_response')
  const names = table.Columns.map((column) => String((column as { ColumnName?: unknown } | null)?.ColumnName ?? ''))
  return table.Rows.map((row) => {
    if (!Array.isArray(row)) throw new KustoError(502, 'malformed_response')
    return Object.fromEntries(names.map((name, index) => [name, row[index] ?? null]))
  })
}

export interface KustoClientOptions {
  // The Eventhouse query URI, without a trailing slash.
  queryUri: string
  // A token for the scope, as the managed identity; the signal aborts a request that takes too long.
  getToken: (scope: string, signal: AbortSignal) => Promise<string>
  fetch?: typeof fetch
  timeoutMs?: number
}

async function errorCode(response: Response): Promise<string> {
  try {
    const code = ((await response.json()) as { error?: { code?: unknown } } | null)?.error?.code
    if (typeof code === 'string' && ERROR_CODE.test(code)) return code
  } catch {
    // Not a JSON error body.
  }
  return `http_${response.status}`
}

function timedOut(error: unknown, otherwise: KustoError): KustoError {
  return error instanceof Error && error.name === 'TimeoutError' ? new KustoError(0, 'timeout') : otherwise
}

// Settles with the work, or rejects once the signal aborts, whichever comes first.
function bounded<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    work.then(resolve, reject)
  })
}

export function createKustoClient(options: KustoClientOptions): KustoClient {
  const send = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? 30_000
  let resource: string | undefined

  // The audience Kusto states for itself; the default when the metadata can't be read, retried on the next call.
  const discover = async (): Promise<string | undefined> => {
    try {
      const response = await send(`${options.queryUri}/v1/rest/auth/metadata`, {
        headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) return undefined
      const value = ((await response.json()) as { AzureAD?: { KustoServiceResourceId?: unknown } } | null)?.AzureAD?.KustoServiceResourceId
      if (typeof value !== 'string') return undefined
      const url = new URL(value)
      return url.protocol === 'https:' && !url.username && !url.password && !url.search && url.pathname === '/' ? url.origin : undefined
    } catch {
      return undefined
    }
  }

  const call = async (path: string, db: string | undefined, csl: string): Promise<Row[]> => {
    resource ??= await discover()
    let token: string
    try {
      const signal = AbortSignal.timeout(timeoutMs)
      token = await bounded(options.getToken(`${resource ?? DEFAULT_KUSTO_RESOURCE}/.default`, signal), signal)
    } catch {
      throw new KustoError(0, 'token_unavailable')
    }
    let response: Response
    try {
      response = await send(`${options.queryUri}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=utf-8',
          Accept: 'application/json',
          'x-ms-app': 'reprint-request',
          'x-ms-client-request-id': `reprint-request;${randomUUID()}`,
        },
        body: JSON.stringify(db === undefined ? { csl } : { db, csl }),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      throw timedOut(error, new KustoError(0, 'unreachable'))
    }
    if (!response.ok) throw new KustoError(response.status, await errorCode(response))
    let body: unknown
    try {
      body = await response.json()
    } catch (error) {
      throw timedOut(error, new KustoError(502, 'malformed_response'))
    }
    return parseV1(body)
  }

  return {
    query: (db, csl) => call('/v1/rest/query', db, csl),
    mgmt: (db, csl) => call('/v1/rest/mgmt', db, csl),
  }
}

// The KQL database, by its display name: queries and commands run in the Kusto database whose DatabaseName or
// PrettyName equals it, resolved on first use and kept once exactly one matches.
export interface Database {
  name: () => Promise<string>
  query: (csl: string) => Promise<Row[]>
  mgmt: (csl: string) => Promise<Row[]>
}

// The database's own identity, read in its context: by its item ID first, then by its display name, because Fabric
// names the Kusto database by one of them and a request's database must name it.
async function ownIdentity(client: KustoClient, candidates: string[]): Promise<Row[]> {
  for (const candidate of candidates) {
    try {
      return await client.mgmt(candidate, '.show database identity')
    } catch (error) {
      // A name that isn't the database's is refused as a bad request; anything else is the store's answer.
      if (!(error instanceof KustoError && (error.status === 400 || error.status === 404))) throw error
    }
  }
  return []
}

async function resolveName(client: KustoClient, displayName: string, itemId?: string): Promise<string> {
  let rows: Row[]
  try {
    rows = await client.mgmt(undefined, '.show databases')
  } catch (error) {
    // `.show databases` needs an Eventhouse-wide role (AllDatabasesMonitor); the database's own identity needs only
    // its Viewer role.
    if (!(error instanceof KustoError && error.status === 403)) throw error
    rows = await ownIdentity(client, itemId ? [itemId, displayName] : [displayName])
  }
  const matches = rows.filter((row) => row.DatabaseName === displayName || row.PrettyName === displayName
    || (itemId !== undefined && String(row.DatabaseName ?? '').toLowerCase() === itemId))
  if (matches.length !== 1) throw new KustoError(0, matches.length ? 'database_ambiguous' : 'database_not_found')
  const name = matches[0].DatabaseName
  if (typeof name !== 'string' || !DATABASE_NAME.test(name)) throw new KustoError(0, 'database_not_found')
  return name
}

// `itemId` is the KQL database's Fabric item ID, when known: lowercase, as config reads it.
export function createDatabase(client: KustoClient, displayName: string, itemId?: string): Database {
  let resolved: Promise<string> | undefined
  const name = (): Promise<string> => {
    resolved ??= resolveName(client, displayName, itemId).catch((error: unknown) => {
      resolved = undefined
      throw error
    })
    return resolved
  }
  return {
    name,
    query: async (csl) => client.query(await name(), csl),
    mgmt: async (csl) => client.mgmt(await name(), csl),
  }
}

export type ColumnType = 'string' | 'long' | 'datetime'
export interface Column {
  name: string
  type: ColumnType
}

const CONVERSION: Record<ColumnType, string> = { string: 'tostring', long: 'tolong', datetime: 'todatetime' }

// JSON with every non-ASCII character escaped, so the base64 payload decodes the same in any charset.
function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`)
}

// Appends one row with the columns in the table's order: ingest-from-query matches columns by position, not name.
// With ingestIfNotExists, a second append with the same tag fails rather than adding a duplicate. Names are bracketed,
// so none can read as a KQL keyword.
export function appendCommand(table: string, columns: readonly Column[], row: Row, tag: string): string {
  if (!NAME.test(table) || !columns.length || !columns.every((column) => NAME.test(column.name))) {
    throw new TypeError('Not a KQL table or column name.')
  }
  if (!isIdentifier(tag)) throw new TypeError('Tags are built only from validated identifiers.')
  const payload = Buffer.from(asciiJson(Object.fromEntries(columns.map((column) => [column.name, row[column.name] ?? null]))))
    .toString('base64')
  const project = columns.map((column) => `['${column.name}'] = ${CONVERSION[column.type]}(r['${column.name}'])`).join(', ')
  return `.append ${table} with (ingestIfNotExists = '["${tag}"]', tags = '["ingest-by:${tag}"]') <| `
    + `print r = parse_json(base64_decode_tostring('${payload}')) | project ${project}`
}

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  DEFAULT_KUSTO_RESOURCE, KustoError, appendCommand, createDatabase, createKustoClient, literal, parseV1, type Row,
} from '../src/kusto.ts'
import { REPRINT_REQUEST_COLUMNS, createRequestService } from '../src/requests.ts'
import { DATABASE_GUID, FakeKusto, director, expediteArguments } from './support.ts'

const queryUri = 'https://trd-demo123.z4.kusto.fabric.microsoft.com'

interface Sent {
  url: string
  method: string
  headers: Record<string, string>
  body?: unknown
}

// A fetch that records each request and answers it from `answer`.
function fakeFetch(answer: (request: Sent, signal?: AbortSignal) => Promise<Response> | Response) {
  const sent: Sent[] = []
  const send = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const request: Sent = {
      url: String(input), method: init.method ?? 'GET', headers: Object.fromEntries(new Headers(init.headers).entries()),
      ...(init.body ? { body: JSON.parse(String(init.body)) } : {}),
    }
    sent.push(request)
    return answer(request, init.signal ?? undefined)
  }) as typeof fetch
  return { sent, send }
}

const v1 = (columns: string[], rows: unknown[][], typeKey = 'ColumnType') => Response.json({
  Tables: [
    { TableName: 'Table_0', Columns: columns.map((name) => ({ ColumnName: name, [typeKey]: 'string' })), Rows: rows },
    { TableName: 'Table_1', Columns: [{ ColumnName: 'Value', ColumnType: 'string' }], Rows: [['{"Visualization":null}']] },
  ],
})

test("queries and commands reach the v1 endpoints with the managed identity's token for the audience Kusto states", async () => {
  const scopes: string[] = []
  const { sent, send } = fakeFetch((request) => request.url.endsWith('/auth/metadata')
    ? Response.json({ AzureAD: { LoginEndpoint: 'https://login.microsoftonline.com', KustoServiceResourceId: 'https://kusto.kusto.fabric.example' } })
    : v1(['DatabaseName', 'PrettyName'], [[DATABASE_GUID, 'BookSignals']]))
  const client = createKustoClient({ queryUri, getToken: async (scope) => { scopes.push(scope); return 'mi.token.value' }, fetch: send })
  assert.deepEqual(await client.mgmt(undefined, '.show databases'), [{ DatabaseName: DATABASE_GUID, PrettyName: 'BookSignals' }])
  await client.query(DATABASE_GUID, 'latest_run()')
  assert.deepEqual(scopes, ['https://kusto.kusto.fabric.example/.default', 'https://kusto.kusto.fabric.example/.default'])
  assert.deepEqual(sent.map((request) => [request.method, request.url]), [
    ['GET', `${queryUri}/v1/rest/auth/metadata`],
    ['POST', `${queryUri}/v1/rest/mgmt`],
    ['POST', `${queryUri}/v1/rest/query`],
  ], 'the metadata is read once')
  assert.equal(sent[0].headers.authorization, undefined, 'the metadata needs no token')
  assert.deepEqual(sent[1].body, { csl: '.show databases' }, 'a cluster command names no database')
  assert.deepEqual(sent[2].body, { db: DATABASE_GUID, csl: 'latest_run()' })
  assert.equal(sent[2].headers.authorization, 'Bearer mi.token.value')
  assert.equal(sent[2].headers['content-type'], 'application/json; charset=utf-8')
  assert.match(sent[2].headers['x-ms-client-request-id'], /^reprint-request;[0-9a-f-]{36}$/)
})

test('without usable auth metadata, the default Kusto audience, and the metadata is read again next time', async () => {
  for (const metadata of [
    () => new Response('not found', { status: 404 }),
    () => Response.json({ AzureAD: { KustoServiceResourceId: 'http://kusto.kusto.windows.net' } }),
    () => Response.json({ AzureAD: { KustoServiceResourceId: 'https://kusto.kusto.windows.net/path' } }),
    () => Response.json({}),
    () => { throw new TypeError('fetch failed') },
  ]) {
    const scopes: string[] = []
    const { sent, send } = fakeFetch((request) => request.url.endsWith('/auth/metadata') ? metadata() : v1(['x'], [[1]]))
    const client = createKustoClient({ queryUri, getToken: async (scope) => { scopes.push(scope); return 't' }, fetch: send })
    await client.query('db', 'print x = 1')
    await client.query('db', 'print x = 1')
    assert.deepEqual(scopes, [`${DEFAULT_KUSTO_RESOURCE}/.default`, `${DEFAULT_KUSTO_RESOURCE}/.default`])
    assert.equal(sent.filter((request) => request.url.endsWith('/auth/metadata')).length, 2)
  }
})

test("v1 responses: the first table's rows by column name, with either column type key", () => {
  for (const key of ['DataType', 'ColumnType']) {
    const body = { Tables: [{ TableName: 'Table_0', Columns: [{ ColumnName: 'units', [key]: 'Int64' }, { ColumnName: 'territory', [key]: 'String' }], Rows: [[20000, 'UK'], [32000, null]] }] }
    assert.deepEqual(parseV1(body), [{ units: 20000, territory: 'UK' }, { units: 32000, territory: null }])
  }
  for (const body of [null, {}, { Tables: [] }, { Tables: [{ Columns: [] }] }, { Tables: [{ Columns: [], Rows: ['x'] }] }]) {
    assert.throws(() => parseV1(body), (error: unknown) => error instanceof KustoError && error.code === 'malformed_response')
  }
})

test("failures carry the status and a short code, never Kusto's message", async () => {
  const cases: [string, (request: Sent, signal?: AbortSignal) => Promise<Response> | Response, number, string][] = [
    ['forbidden', () => Response.json({ error: { code: 'Forbidden', message: "Principal 'aadapp=44444444-4444-4444-8444-444444444444' is not authorized" } }, { status: 403 }), 403, 'Forbidden'],
    ['an error code that is not a code', () => Response.json({ error: { code: 'two words', message: 'x' } }, { status: 400 }), 400, 'http_400'],
    ['not JSON', () => new Response('<html>Bad gateway</html>', { status: 502 }), 502, 'http_502'],
    ['unreachable', () => { throw new TypeError('fetch failed') }, 0, 'unreachable'],
    ['malformed', () => new Response('{"Tables": nope', { status: 200 }), 502, 'malformed_response'],
    ['slow', (_request, signal) => new Promise<Response>((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason))), 0, 'timeout'],
  ]
  for (const [name, answer, status, code] of cases) {
    const { send } = fakeFetch((request, signal) => request.url.endsWith('/auth/metadata') ? new Response('', { status: 404 }) : answer(request, signal))
    const client = createKustoClient({ queryUri, getToken: async () => 't', fetch: send, timeoutMs: 50 })
    const error = await client.query('db', 'print 1').then(() => undefined, (failure: unknown) => failure)
    assert.ok(error instanceof KustoError, name)
    assert.deepEqual([error.status, error.code], [status, code], name)
    assert.ok(!error.message.includes('aadapp') && !error.message.includes('Bad gateway'), name)
  }
  const { send } = fakeFetch(() => v1(['x'], []))
  const noToken = createKustoClient({ queryUri, getToken: async () => { throw new Error('ManagedIdentityCredential: no endpoint') }, fetch: send })
  await assert.rejects(noToken.query('db', 'print 1'), (error: unknown) => error instanceof KustoError && error.code === 'token_unavailable'
    && !error.message.includes('ManagedIdentity'))
  // An identity endpoint that never answers fails the call in time, and is told to stop.
  let stopped = false
  const hanging = createKustoClient({
    queryUri, fetch: send, timeoutMs: 50,
    getToken: (_scope, signal) => new Promise<string>(() => signal.addEventListener('abort', () => { stopped = true })),
  })
  await assert.rejects(hanging.query('db', 'print 1'), (error: unknown) => error instanceof KustoError && error.code === 'token_unavailable')
  assert.equal(stopped, true)
})

test('the database is resolved once from its display name: a GUID with a pretty name, or the name itself', async () => {
  const fabric = new FakeKusto()
  const database = createDatabase(fabric, 'BookSignals')
  assert.equal(await database.name(), DATABASE_GUID)
  await database.query(`latest_title_signals() | where signal_id == 'x' | project signal_id`)
  await database.mgmt(`.show database ['${DATABASE_GUID}'] principal roles`)
  assert.deepEqual(fabric.calls.map((call) => [call.endpoint, call.db, call.csl.split(' ')[0]]), [
    ['mgmt', undefined, '.show'], ['query', DATABASE_GUID, 'latest_title_signals()'], ['mgmt', DATABASE_GUID, '.show'],
  ])

  const named = new FakeKusto()
  named.databases = [{ DatabaseName: 'BookSignals', PrettyName: '' }, { DatabaseName: 'BookEvents', PrettyName: '' }]
  assert.equal(await createDatabase(named, 'BookSignals').name(), 'BookSignals')

  // Without an Eventhouse-wide role, the database's own identity, in its context, names it: by the item ID first,
  // which Fabric may use as the database's name, then by the display name.
  const restricted = new FakeKusto()
  restricted.forbidShowDatabases = true
  restricted.prettyNameInContext = false
  assert.equal(await createDatabase(restricted, 'BookSignals', DATABASE_GUID).name(), DATABASE_GUID)
  assert.deepEqual(restricted.calls.map((call) => [call.db, call.csl]), [[undefined, '.show databases'], [DATABASE_GUID, '.show database identity']])
  const restrictedNamed = new FakeKusto()
  restrictedNamed.forbidShowDatabases = true
  restrictedNamed.prettyNameInContext = false
  restrictedNamed.databases = [{ DatabaseName: 'BookSignals', PrettyName: '' }]
  assert.equal(await createDatabase(restrictedNamed, 'BookSignals', DATABASE_GUID).name(), 'BookSignals')
  assert.deepEqual(restrictedNamed.calls.map((call) => call.db), [undefined, DATABASE_GUID, 'BookSignals'])
  // Without the item ID, only the display name is tried.
  const unnamed = new FakeKusto()
  unnamed.forbidShowDatabases = true
  unnamed.prettyNameInContext = false
  await assert.rejects(createDatabase(unnamed, 'BookSignals').name(), (error: unknown) => error instanceof KustoError && error.code === 'database_not_found')
  unnamed.prettyNameInContext = true
  assert.equal(await createDatabase(unnamed, 'BookSignals').name(), DATABASE_GUID)
})

test('no or several matching databases leave the store unavailable, and the next use resolves again', async () => {
  const fake = new FakeKusto()
  fake.databases = [{ DatabaseName: 'f1e2d3c4-0000-4000-8000-000000000000', PrettyName: 'BookEvents' }]
  const database = createDatabase(fake, 'BookSignals')
  await assert.rejects(database.name(), (error: unknown) => error instanceof KustoError && error.code === 'database_not_found')
  fake.databases = [{ DatabaseName: DATABASE_GUID, PrettyName: 'BookSignals' }, { DatabaseName: 'BookSignals', PrettyName: 'Copy' }]
  await assert.rejects(database.query('latest_run()'), (error: unknown) => error instanceof KustoError && error.code === 'database_ambiguous')
  fake.databases = [{ DatabaseName: "bad'name", PrettyName: 'BookSignals' }]
  await assert.rejects(database.name(), (error: unknown) => error instanceof KustoError && error.code === 'database_not_found')
  fake.databases = [{ DatabaseName: DATABASE_GUID, PrettyName: 'BookSignals' }]
  assert.equal(await database.name(), DATABASE_GUID)
  assert.equal(fake.calls.filter((call) => call.csl === '.show databases').length, 4)
})

const row: Row = {
  request_id: 'rr-20261102-title-001-inv-ed-001-hb-uk', signal_id: 'sig-20261102-title-001-inv-ed-001-hb-uk',
  option_id: 'sig-20261102-title-001-inv-ed-001-hb-uk-expedite', title_id: 'title-001', title_name: 'The Glass Orchard',
  edition_id: 'ed-001-hb', territory: 'UK', quantity: 20000, expedited: 'Yes', investment_gbp: 50000,
  rationale: "Stock runs out in 3 weeks'; .drop table reprint_requests | print 'x' // §6 – café",
  evidence: 'sig-20261102-title-001-inv-ed-001-hb-uk; BKS-POL-001 §6; BKS-GOV-003 §1 <| .set x',
  required_approver: 'Publishing director', approver_role: 'Publishing director', approver_name: "Rowan O'Ashdown",
  approver_object_id: '11111111-1111-4111-8111-111111111111', approved_at: '2026-11-18T14:30:00.000Z', status: 'Approved',
  as_of_week: '2026-11-02T00:00:00.000Z', extra: 'never written',
}

test('the append command carries every value in a base64 JSON payload, in the table column order, tagged once', () => {
  const command = appendCommand('reprint_requests', REPRINT_REQUEST_COLUMNS, row, 'rr-20261102-title-001-inv-ed-001-hb-uk')
  const match = /^\.append reprint_requests with \(ingestIfNotExists = '\["rr-20261102-title-001-inv-ed-001-hb-uk"\]', tags = '\["ingest-by:rr-20261102-title-001-inv-ed-001-hb-uk"\]'\) <\| print r = parse_json\(base64_decode_tostring\('([A-Za-z0-9+/]+=*)'\)\) \| project (.+)$/.exec(command)
  assert.ok(match, command.slice(0, 160))
  const decoded = Buffer.from(match[1], 'base64').toString('utf8')
  assert.ok(/^[\x20-\x7e]+$/.test(decoded), 'the payload is ASCII JSON')
  const { extra, ...written } = row
  assert.equal(extra, 'never written')
  assert.deepEqual(JSON.parse(decoded), written)
  assert.deepEqual(Object.keys(JSON.parse(decoded)), REPRINT_REQUEST_COLUMNS.map((column) => column.name))
  assert.equal(match[2], REPRINT_REQUEST_COLUMNS.map(({ name, type }) => `['${name}'] = ${{ string: 'tostring', long: 'tolong', datetime: 'todatetime' }[type]}(r['${name}'])`).join(', '))
  for (const free of ['Stock runs', '.drop', '<| .set', 'Ashdown', 'café', 'The Glass Orchard', 'BKS-POL', 'Publishing director']) {
    assert.ok(!command.includes(free), `${free} stays inside the payload`)
  }
})

test('only validated identifiers become literals, tags or names in KQL', () => {
  assert.equal(literal('ed-001-hb'), "'ed-001-hb'")
  assert.equal(literal('6D2F8A1C-3B4E-4F5A-8C7D-9E0F1A2B3C4D'), "'6D2F8A1C-3B4E-4F5A-8C7D-9E0F1A2B3C4D'")
  for (const value of ["x' or 1 == 1 or '", 'UK', 'Ed-001', 'a'.repeat(121), '', 'sig_1', 'ed 001']) {
    assert.throws(() => literal(value), TypeError, value)
    assert.throws(() => appendCommand('reprint_requests', REPRINT_REQUEST_COLUMNS, row, value), TypeError, value)
  }
  assert.throws(() => appendCommand('reprint_requests | .drop', REPRINT_REQUEST_COLUMNS, row, 'rr-1'), TypeError)
  assert.throws(() => appendCommand('reprint_requests', [{ name: 'x = 1, y', type: 'string' }], row, 'rr-1'), TypeError)
  assert.throws(() => appendCommand('reprint_requests', [], row, 'rr-1'), TypeError)
})

// Ingest-from-query matches columns by position: the payload's order must be the table's, as the schema creates it.
test("the server's columns and queries match the BookSignals database schema", async () => {
  const schema = readFileSync(new URL('../../../../workspace/BookSignals.KQLDatabase/DatabaseSchema.kql', import.meta.url), 'utf8')
  const tables = new Map([...schema.matchAll(/^\.create-merge table (\w+) \(([^)]+)\)/gm)].map(([, name, columns]) => [
    name, columns.split(', ').map((column) => column.split(':') as [string, string]),
  ]))
  assert.deepEqual(tables.get('reprint_requests'), REPRINT_REQUEST_COLUMNS.map((column) => [column.name, column.type]))
  const fake = new FakeKusto()
  const outcome = await createRequestService({ database: createDatabase(fake, 'BookSignals') })
    .submit(expediteArguments(), { objectId: director, name: 'Rowan Ashdown', roles: ['Reprint.PublishingDirector'] })
  assert.equal(outcome.ok, true)
  const sources: Record<string, string> = { 'latest_title_signals()': 'title_signals', 'latest_decision_options()': 'decision_options', reprint_requests: 'reprint_requests' }
  const queries = fake.calls.filter((call) => call.endpoint === 'query')
  assert.equal(queries.length, 4)
  for (const { csl } of queries) {
    const [source] = csl.split(' ')
    const known = new Set(tables.get(sources[source])?.map(([name]) => name))
    for (const column of csl.split(' | project ')[1].split(', ')) assert.ok(known.has(column), `${source} has ${column}`)
  }
  for (const name of ['latest_title_signals', 'latest_decision_options']) assert.match(schema, new RegExp(`\\) ${name}\\(\\) \\{`))
})

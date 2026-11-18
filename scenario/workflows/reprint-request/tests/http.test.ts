import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import { BODY_LIMIT, createApp, type RequestLog } from '../src/http.ts'
import { createDatabase } from '../src/kusto.ts'
import { cacheReadiness, checkReadiness } from '../src/readiness.ts'
import { createRequestService } from '../src/requests.ts'
import { FakeKusto, now, otherKeys, token, verify } from './support.ts'

async function start(fake = new FakeKusto()) {
  const logs: RequestLog[] = []
  let clock = now.getTime()
  const database = createDatabase(fake, 'BookSignals')
  const handler = createApp({
    verify,
    requests: createRequestService({ database, clock: () => now }),
    readiness: cacheReadiness(() => checkReadiness(database), 60_000, () => clock),
    version: '41b4cac7f148',
    log: (record) => logs.push(record),
    clock: () => clock,
  })
  const server: Server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    fake, logs, server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    advance: (ms: number) => { clock += ms },
  }
}

const list = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
const mcpHeaders = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }

test('the health check answers without signing anyone in or touching the store, and is not logged', async (t) => {
  const { server, base, fake, logs } = await start()
  t.after(() => server.close())
  const health = await fetch(`${base}/healthz`)
  assert.deepEqual([health.status, await health.text()], [200, 'ok'])
  assert.equal(fake.calls.length, 0)
  assert.equal(logs.length, 0)
})

test('MCP requests without a valid token get 401 and a Bearer challenge before anything else is read', async (t) => {
  const { server, base, fake, logs } = await start()
  t.after(() => server.close())
  for (const authorization of [undefined, 'Bearer forged.token.value', `Bearer ${await token({}, otherKeys.privateKey)}`,
    `Bearer ${await token({ aud: 'https://ai.azure.com' })}`, `Bearer ${await token({ scp: 'ReprintRequest.Read' })}`]) {
    for (const contentType of ['application/json', 'text/plain']) {
      const response = await fetch(`${base}/mcp`, {
        method: 'POST', body: list, headers: { ...mcpHeaders, 'Content-Type': contentType, ...(authorization ? { Authorization: authorization } : {}) },
      })
      assert.deepEqual([response.status, response.headers.get('www-authenticate')], [401, 'Bearer'], String(authorization).slice(0, 30))
      const body = await response.json() as { jsonrpc: string; error: { message: string } }
      assert.equal(body.jsonrpc, '2.0')
      assert.match(body.error.message, /sign/i)
    }
  }
  assert.equal((await fetch(`${base}/mcp`, { method: 'POST' })).status, 401)
  assert.equal(fake.calls.length, 0)
  assert.deepEqual(logs[0], { event: 'reprint.request', method: 'POST', route: '/mcp', status: 401, ms: 0 })
})

test('the stateless endpoint answers GET and DELETE with 405, and bodies it cannot take with 413, 415 or 400', async (t) => {
  const { server, base } = await start()
  t.after(() => server.close())
  const authorization = `Bearer ${await token()}`
  for (const method of ['GET', 'DELETE', 'PUT']) {
    const response = await fetch(`${base}/mcp`, { method, headers: { Authorization: authorization } })
    assert.deepEqual([response.status, response.headers.get('allow')], [405, 'POST'], method)
  }
  const unauthenticated = await fetch(`${base}/mcp`, { headers: { Accept: 'text/event-stream' } })
  assert.equal(unauthenticated.status, 405)
  const post = (body: string, contentType = 'application/json') => fetch(`${base}/mcp`, {
    method: 'POST', body, headers: { ...mcpHeaders, 'Content-Type': contentType, Authorization: authorization },
  })
  assert.equal((await post(list, 'text/plain')).status, 415)
  assert.equal((await post(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: { pad: 'x'.repeat(BODY_LIMIT) } }))).status, 413)
  const invalid = await post('{"jsonrpc": "2.0",')
  assert.equal(invalid.status, 400)
  assert.equal(((await invalid.json()) as { error: { code: number } }).error.code, -32700)
  assert.equal((await post(list)).status, 200)
  assert.equal((await fetch(`${base}/elsewhere`)).status, 404)
})

test('readiness reports only whether the identity holds Viewer and Ingestor, at most once a minute', async (t) => {
  const { server, base, fake, logs, advance } = await start()
  t.after(() => server.close())
  const checks = () => fake.calls.filter((call) => call.csl.endsWith('principal roles')).length
  const ready = await fetch(`${base}/readyz`)
  assert.equal(ready.status, 200)
  assert.deepEqual(await ready.json(), { ready: true, roles: ['Viewer', 'Ingestor'], version: '41b4cac7f148' })
  fake.roles = ['Viewer']
  advance(59_000)
  assert.equal((await fetch(`${base}/readyz`)).status, 200, 'the cached answer')
  assert.equal(checks(), 1)
  advance(1_000)
  const partial = await fetch(`${base}/readyz`)
  assert.equal(partial.status, 503)
  assert.deepEqual(await partial.json(), { ready: false, roles: ['Viewer'], version: '41b4cac7f148' })
  assert.equal(checks(), 2)
  fake.roles = ['Viewer', 'Ingestor']
  advance(60_000)
  assert.equal((await fetch(`${base}/readyz`)).status, 200, 'granted roles show within a minute')
  assert.equal(fake.calls.filter((call) => call.csl === '.show databases').length, 1, 'the database name is resolved once')
  assert.equal((await fetch(`${base}/readyz`, { method: 'POST' })).status, 405)
  assert.deepEqual(logs.map((record) => [record.route, record.status]), [['/readyz', 200], ['/readyz', 200], ['/readyz', 503], ['/readyz', 200], ['/readyz', 405]])
})

test('an unresolved store makes readiness fail with a short code', async (t) => {
  const fake = new FakeKusto()
  fake.databases = [{ DatabaseName: 'BookEvents', PrettyName: '' }]
  const { server, base } = await start(fake)
  t.after(() => server.close())
  const response = await fetch(`${base}/readyz`)
  assert.deepEqual([response.status, await response.json()], [503, { ready: false, roles: [], code: 'database_not_found', version: '41b4cac7f148' }])
})

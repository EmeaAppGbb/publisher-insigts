import assert from 'node:assert/strict'
import test from 'node:test'
import { KustoError, createDatabase } from '../src/kusto.ts'
import { checkReadiness } from '../src/readiness.ts'
import { DATABASE_GUID, FakeKusto } from './support.ts'

test("ready once the managed identity holds Viewer and Ingestor on the resolved database, from its own roles", async () => {
  const fake = new FakeKusto()
  assert.deepEqual(await checkReadiness(createDatabase(fake, 'BookSignals')), { ready: true, roles: ['Viewer', 'Ingestor'] })
  assert.deepEqual(fake.calls.at(-1), { endpoint: 'mgmt', db: DATABASE_GUID, csl: `.show database ['${DATABASE_GUID}'] principal roles` })

  for (const [held, roles] of [
    [['Viewer'], ['Viewer']],
    [['Ingestor'], ['Ingestor']],
    [['UnrestrictedViewer', 'Ingestor'], ['Ingestor']],
    [['Admin'], []],
    [[], []],
  ] as [string[], string[]][]) {
    const partial = new FakeKusto()
    partial.roles = held
    assert.deepEqual(await checkReadiness(createDatabase(partial, 'BookSignals')), { ready: false, roles }, held.join())
  }
})

test("a store that can't be checked is not ready, with only a short code", async () => {
  const missing = new FakeKusto()
  missing.databases = []
  assert.deepEqual(await checkReadiness(createDatabase(missing, 'BookSignals')), { ready: false, roles: [], code: 'database_not_found' })
  const ambiguous = new FakeKusto()
  ambiguous.databases.push({ DatabaseName: 'BookSignals', PrettyName: 'Archive' })
  assert.deepEqual(await checkReadiness(createDatabase(ambiguous, 'BookSignals')), { ready: false, roles: [], code: 'database_ambiguous' })
  for (const [error, code] of [
    [new KustoError(403, 'Forbidden'), 'store_forbidden'],
    [new KustoError(401, 'Unauthorized'), 'store_unauthorized'],
    [new KustoError(0, 'token_unavailable'), 'token_unavailable'],
    [new KustoError(503, 'ServiceUnavailable'), 'store_unavailable'],
    [new Error("Principal 'aadapp=x' is not authorized"), 'store_unavailable'],
  ] as [Error, string][]) {
    const failing = new FakeKusto()
    failing.mgmt = async () => { throw error }
    assert.deepEqual(await checkReadiness(createDatabase(failing, 'BookSignals')), { ready: false, roles: [], code })
  }
})

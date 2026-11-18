import assert from 'node:assert/strict'
import test from 'node:test'
import { readServerConfig } from '../src/config.ts'

const env = {
  ENTRA_TENANT_ID: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
  REPRINT_API_CLIENT_ID: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  REPRINT_OAUTH_CLIENT_ID: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  KQL_QUERY_URI: 'https://trd-demo123.z4.kusto.fabric.microsoft.com/',
  KQL_DATABASE: 'BookSignals',
  AZURE_CLIENT_ID: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
}

test('the settings Terraform sets start the server', () => {
  assert.deepEqual(readServerConfig(env), {
    config: {
      port: 8080,
      tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      apiClientId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      oauthClientId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      kqlQueryUri: 'https://trd-demo123.z4.kusto.fabric.microsoft.com',
      kqlDatabase: 'BookSignals',
      managedIdentityClientId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    },
    problems: [],
  })
  const { config } = readServerConfig({ ...env, PORT: '3000', APP_VERSION: '41b4cac7f148', KQL_DATABASE_ID: '042D6A15-62EC-4C64-9989-E12F7FADF253' })
  assert.deepEqual([config?.port, config?.version, config?.kqlDatabaseId], [3000, '41b4cac7f148', '042d6a15-62ec-4c64-9989-e12f7fadf253'])
  assert.match(readServerConfig({ ...env, KQL_DATABASE_ID: 'BookSignals' }).problems.join(), /KQL_DATABASE_ID/)
})

test("the managed identity's token only ever goes to a Fabric Eventhouse query URI", () => {
  for (const uri of [
    'http://trd-demo123.z4.kusto.fabric.microsoft.com', 'https://collector.example.com',
    'https://trd-demo123.z4.kusto.fabric.microsoft.com.example.com', 'https://kusto.fabric.microsoft.com',
    'https://trd-demo123.z4.kusto.fabric.microsoft.com/v1/rest/query', 'https://trd-demo123.z4.kusto.fabric.microsoft.com?x=1',
    'https://user@trd-demo123.z4.kusto.fabric.microsoft.com', 'https://trd-demo123.z4.kusto.fabric.microsoft.com:8443',
    'https://-trd.z4.kusto.fabric.microsoft.com', 'https://help.kusto.windows.net',
  ]) {
    assert.match(readServerConfig({ ...env, KQL_QUERY_URI: uri }).problems.join(), /KQL_QUERY_URI/, uri)
  }
})

test('missing or malformed settings stop the server and name each one', () => {
  const { config, problems } = readServerConfig({ ...env, REPRINT_OAUTH_CLIENT_ID: 'client', KQL_DATABASE: "Book'Signals", PORT: '0', APP_VERSION: 'a b' })
  assert.equal(config, undefined)
  for (const name of ['REPRINT_OAUTH_CLIENT_ID', 'KQL_DATABASE', 'PORT', 'APP_VERSION']) assert.match(problems.join('\n'), new RegExp(name))
  const empty = readServerConfig({}).problems
  assert.equal(empty.length, 6, 'an empty environment names all six required settings')
  for (const name of ['ENTRA_TENANT_ID', 'REPRINT_API_CLIENT_ID', 'REPRINT_OAUTH_CLIENT_ID', 'KQL_QUERY_URI', 'KQL_DATABASE', 'AZURE_CLIENT_ID']) {
    assert.match(empty.join('\n'), new RegExp(name))
  }
})

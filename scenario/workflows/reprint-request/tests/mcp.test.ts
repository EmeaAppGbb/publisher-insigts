import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createApp, type RequestLog } from '../src/http.ts'
import { createDatabase } from '../src/kusto.ts'
import { TOOL_DESCRIPTION } from '../src/mcp.ts'
import { cacheReadiness, checkReadiness } from '../src/readiness.ts'
import { createRequestService } from '../src/requests.ts'
import { FakeKusto, expediteArguments, now, token, verify } from './support.ts'

async function start() {
  const fake = new FakeKusto()
  const logs: RequestLog[] = []
  const database = createDatabase(fake, 'BookSignals')
  const server = createServer(createApp({
    verify,
    requests: createRequestService({ database, clock: () => now }),
    readiness: cacheReadiness(() => checkReadiness(database)),
    version: '41b4cac7f148',
    log: (record) => logs.push(record),
  }))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { fake, logs, server, url: new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`) }
}

// An MCP client as Foundry runs one: Streamable HTTP, with the signed-in user's token on every request.
async function connect(url: URL, bearer: string): Promise<Client> {
  const client = new Client({ name: 'foundry-agent-service', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${bearer}` } } }))
  return client
}

test('an MCP client initializes, lists the one tool and submits a request as the signed-in user, through the real transport', async (t) => {
  const { fake, logs, server, url } = await start()
  t.after(() => server.close())
  const client = await connect(url, await token())
  t.after(() => client.close())
  assert.deepEqual(client.getServerVersion(), { name: 'reprint-request', version: '41b4cac7f148' })

  const { tools } = await client.listTools()
  assert.equal(tools.length, 1)
  const [tool] = tools
  assert.equal(tool.name, 'submit_reprint_request')
  assert.equal(tool.description, TOOL_DESCRIPTION)
  assert.ok(TOOL_DESCRIPTION.length < 800)
  assert.match(TOOL_DESCRIPTION, /only after the signed-in user approves it in the app/)
  assert.deepEqual(tool.annotations, { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false })
  assert.deepEqual(tool.inputSchema.required, ['signal_id', 'option_id', 'edition_id', 'territory', 'quantity', 'expedited', 'investment_gbp', 'rationale', 'evidence'])
  assert.equal((tool.inputSchema.properties?.quantity as { type: string }).type, 'integer')

  const result = await client.callTool({ name: 'submit_reprint_request', arguments: expediteArguments() })
  assert.equal(result.isError, undefined)
  const structured = {
    request_id: 'rr-20261102-title-001-inv-ed-001-hb-uk', status: 'Approved', title_name: 'The Glass Orchard', edition_id: 'ed-001-hb',
    territory: 'UK', quantity: 20000, expedited: true, investment_gbp: 50000, required_approver: 'Publishing director',
    approver_name: 'Rowan Ashdown', approver_role: 'Publishing director', approved_at: '2026-11-18T14:30:00.000Z', created: true,
  }
  assert.deepEqual(result.structuredContent, structured)
  assert.deepEqual(result.content, [{
    type: 'text',
    text: 'Reprint request rr-20261102-title-001-inv-ed-001-hb-uk recorded: expedited reprint of 20,000 copies of The Glass Orchard '
      + '(ed-001-hb) for UK, investment £50,000, approved by Rowan Ashdown (Publishing director) at 2026-11-18T14:30:00.000Z. '
      + 'Production planning acts on it under BKS-POL-001 §6.',
  }])
  const again = await client.callTool({ name: 'submit_reprint_request', arguments: expediteArguments() })
  assert.deepEqual(again.structuredContent, { ...structured, created: false })
  assert.match((again.content as { text: string }[])[0].text, /^Reprint request rr-20261102-title-001-inv-ed-001-hb-uk was already recorded: /)
  assert.equal(fake.requests.length, 1)

  const invalid = await client.callTool({ name: 'submit_reprint_request', arguments: { ...expediteArguments(), quantity: '20000', rationale: 'Short.' } })
  assert.equal(invalid.isError, true)
  const text = (invalid.content as { text: string }[])[0].text
  assert.match(text, /quantity is the option's units, a whole number\. at quantity/)
  assert.match(text, /Write the rationale in one or two sentences, 20 to 600 characters\. at rationale/)
  assert.ok(!text.includes('Short.'))

  const calls = logs.filter((record) => record.rpc === 'tools/call')
  assert.deepEqual(calls.map((record) => [record.status, record.tool, record.outcome]),
    [[200, 'submit_reprint_request', 'created'], [200, 'submit_reprint_request', 'replayed'], [200, 'submit_reprint_request', 'invalid_arguments']])
  // The client also tries to open a stream with GET, which the stateless server declines.
  assert.deepEqual(logs.filter((record) => record.rpc !== 'tools/call').map((record) => `${record.method} ${record.status} ${record.rpc}`).sort(), [
    'GET 405 undefined', 'POST 200 initialize', 'POST 200 tools/list', 'POST 202 notifications/initialized',
  ])
  const logged = JSON.stringify(logs)
  for (const value of ['Rowan', 'Ashdown', 'eyJ', 'sig-2026', 'ed-001-hb', 'cover runs out', 'BKS-', 'Glass Orchard']) {
    assert.ok(!logged.includes(value), `${value} is not logged`)
  }
})

test('listing tools needs no reprint role; calling one does, and the refusal names who may approve', async (t) => {
  const { fake, logs, server, url } = await start()
  t.after(() => server.close())
  const client = await connect(url, await token({ name: 'Ilse Marrow', roles: undefined, oid: '44444444-4444-4444-8444-444444444444' }))
  t.after(() => client.close())
  assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name), ['submit_reprint_request'])
  const result = await client.callTool({ name: 'submit_reprint_request', arguments: expediteArguments() })
  assert.deepEqual(result, {
    content: [{
      type: 'text',
      text: "An expedited reprint of £50,000 needs the publishing director's approval (BKS-GOV-003 §1), and your sign-in does not "
        + 'hold that role. A more senior approver in the production line may approve it instead (§2): the managing director.',
    }],
    isError: true,
  })
  assert.equal(fake.requests.length, 0)
  assert.equal(logs.at(-1)?.outcome, 'role_insufficient')
})

import assert from 'node:assert/strict'
import { createServer, request } from 'node:http'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import { createShutdown } from '../src/shutdown.ts'

test('shutdown closes a request that outlives the drain period, then exits once', async () => {
  // A tool call that would outlive the platform's grace period: headers sent, body never finished.
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.write('{')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  await new Promise<void>((resolve) => {
    const req = request({ host: '127.0.0.1', port, path: '/mcp', method: 'POST' }, (res) => {
      res.once('data', () => resolve())
      res.on('error', () => undefined)
    })
    req.on('error', () => undefined)
    req.end()
  })
  const exits: number[] = []
  let exited: () => void = () => {}
  const exit = new Promise<void>((resolve) => { exited = resolve })
  const stop = createShutdown(server, { drainMs: 50, exit: (code) => { exits.push(code); exited() } })
  const started = Date.now()
  stop()
  stop()
  await exit
  assert.ok(Date.now() - started < 2_000, 'the open request must not hold the shutdown')
  assert.deepEqual(exits, [0])
})

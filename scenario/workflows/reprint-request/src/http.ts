// The server's routes: POST /mcp, the MCP endpoint (Streamable HTTP, stateless, JSON responses), which checks the
// user's bearer token before it reads anything else; GET /healthz for the container's probes; GET /readyz for the
// store check. Each request but the health probe is logged as one value-free JSON line: no token, argument,
// rationale, evidence or name.
import type { IncomingMessage, ServerResponse } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { User, Verifier } from './auth.ts'
import { TOOL_NAME, createMcpServer } from './mcp.ts'
import type { Readiness } from './readiness.ts'
import type { RequestService } from './requests.ts'

// A tool call's arguments are a few kilobytes; nothing larger is read.
export const BODY_LIMIT = 65_536
const MCP_PATH = '/mcp'
const ROUTES = new Set([MCP_PATH, '/readyz'])
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])
const RPC_METHODS = new Set(['initialize', 'notifications/initialized', 'notifications/cancelled', 'ping', 'tools/list', 'tools/call'])

// Value-free by construction.
export interface RequestLog {
  event: 'reprint.request'
  method: string
  route: string
  status: number
  ms: number
  // The JSON-RPC method, and for tools/call the tool and the call's outcome code.
  rpc?: string
  tool?: string
  outcome?: string
}

export type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>

export interface AppDependencies {
  verify: Verifier
  requests: RequestService
  // The store check, already cached.
  readiness: () => Promise<Readiness>
  version?: string
  log?: (record: RequestLog) => void
  clock?: () => number
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload), ...headers })
  res.end(payload)
}

// The error shape MCP clients read from the transport's own HTTP errors.
function rpcError(code: number, message: string) {
  return { jsonrpc: '2.0', error: { code, message }, id: null }
}

class BodyError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  if (Number(req.headers['content-length'] ?? '0') > BODY_LIMIT) throw new BodyError(413, 'The request is too large.')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    size += buffer.length
    if (size > BODY_LIMIT) throw new BodyError(413, 'The request is too large.')
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new BodyError(400, 'Parse error: Invalid JSON')
  }
}

// Names the JSON-RPC method and tool for the log line, only from known values.
function label(body: unknown, record: RequestLog): void {
  if (Array.isArray(body)) {
    record.rpc = 'batch'
    return
  }
  const message = body as { method?: unknown; params?: { name?: unknown } } | null
  if (typeof message?.method !== 'string') return
  record.rpc = RPC_METHODS.has(message.method) ? message.method : 'other'
  if (message.method === 'tools/call') record.tool = message.params?.name === TOOL_NAME ? TOOL_NAME : 'other'
}

export function createApp(dependencies: AppDependencies): Handler {
  const { verify, requests } = dependencies
  const version = dependencies.version ?? '0.0.0'
  const log = dependencies.log ?? ((record: RequestLog) => console.info(JSON.stringify(record)))
  const clock = dependencies.clock ?? Date.now

  const serveMcp = async (req: IncomingMessage, res: ServerResponse, body: unknown, user: User, record: RequestLog) => {
    const server = createMcpServer({ user, requests, version, report: (outcome) => { record.outcome = outcome } })
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on('close', () => {
      void transport.close().catch(() => undefined)
      void server.close().catch(() => undefined)
    })
    await server.connect(transport)
    await transport.handleRequest(req, res, body)
    // The SDK refuses arguments that don't match the input schema before the tool runs.
    if (record.tool === TOOL_NAME && !record.outcome) record.outcome = 'invalid_arguments'
  }

  const route = async (req: IncomingMessage, res: ServerResponse, pathname: string, record: RequestLog): Promise<void> => {
    if (pathname === '/readyz') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { message: 'Use GET.' }, { Allow: 'GET, HEAD' })
      const readiness = await dependencies.readiness()
      return sendJson(res, readiness.ready ? 200 : 503, { ...readiness, ...(dependencies.version ? { version } : {}) })
    }
    if (pathname !== MCP_PATH) return sendJson(res, 404, { message: 'Not found.' })
    // Stateless: there is no session stream to open or end.
    if (req.method !== 'POST') return sendJson(res, 405, rpcError(-32000, 'Method not allowed: use POST.'), { Allow: 'POST' })
    const verified = await verify(req.headers.authorization)
    if (!verified.ok) return sendJson(res, 401, rpcError(-32000, verified.message), { 'WWW-Authenticate': 'Bearer' })
    if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) {
      return sendJson(res, 415, rpcError(-32000, 'Unsupported Media Type: Content-Type must be application/json'))
    }
    let body: unknown
    try {
      body = await readJson(req)
    } catch (error) {
      const status = error instanceof BodyError ? error.status : 400
      return sendJson(res, status, rpcError(status === 400 ? -32700 : -32000, error instanceof BodyError ? error.message : 'Parse error'))
    }
    label(body, record)
    await serveMcp(req, res, body, verified.user, record)
  }

  return async (req, res) => {
    const started = clock()
    const pathname = (req.url ?? '/').split('?')[0]
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Cache-Control', 'no-store')
    // Container Apps probes it every few seconds: logging it would only add noise.
    if (pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('ok')
      return
    }
    const method = req.method ?? 'GET'
    const record: RequestLog = {
      event: 'reprint.request', method: METHODS.has(method) ? method : 'OTHER', route: ROUTES.has(pathname) ? pathname : '*',
      status: 0, ms: 0,
    }
    try {
      await route(req, res, pathname, record)
    } catch {
      if (!res.headersSent) sendJson(res, 500, rpcError(-32603, 'The reprint request server failed. Try again.'))
      else res.destroy()
    } finally {
      record.status = res.statusCode
      record.ms = Math.max(0, Math.round(clock() - started))
      log(record)
    }
  }
}

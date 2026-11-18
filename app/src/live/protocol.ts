// The app's own wire format between the browser (live/client.ts) and its server (server/turn.ts): one POST per
// question, or per decision on a tool call the agent proposed, answered as newline-delimited JSON events. Pure types
// and checks, so both sides and the Node tests use it.
import type { IqKey, Variant } from './types.ts'

export const TURN_PATH = '/api/turns'
export const CONFIG_PATH = '/api/config'
// MSAL's redirect bridge (redirect.html, src/redirect.ts): Entra sends every sign-in response there, and the app
// registration (infra/app.tf) names it as the only redirect URI.
export const REDIRECT_PATH = '/redirect.html'

export const VARIANTS: readonly Variant[] = ['with_iq', 'without_iq']

// The Foundry agent's MCP server labels (agents/scenario-with-iq/tools/*.json) and the IQ each one is; the reprint
// request is the agent's one action, which the user approves before Foundry runs it.
export const SERVER_IQ: Readonly<Record<string, IqKey>> = {
  fabric_iq_ontology: 'fabric',
  foundry_iq_knowledge: 'foundry',
  web_iq_public_context: 'web',
  work_iq_mail: 'work',
  reprint_request: 'action',
}

export const IQ_NAMES: Readonly<Record<IqKey, string>> = {
  fabric: 'Fabric IQ',
  foundry: 'Foundry IQ',
  web: 'Web IQ',
  work: 'Work IQ',
  action: 'Reprint request',
}

export const QUESTION_LIMIT = 2000
export const FOUNDRY_SCOPE = 'https://ai.azure.com/user_impersonation'
export const ARGUMENTS_LIMIT = 400
// The longest arguments, as Foundry's JSON string, that an approval request may propose: longer ones are refused,
// never shown cut, because the user approves exactly what the card shows.
export const APPROVAL_ARGUMENTS_LIMIT = 4096

// A plain value of a proposed tool call: nothing nested, so the card shows every value in full.
export type ApprovalValue = string | number | boolean | null

// A tool call Foundry holds until the user approves it, with the arguments the agent proposed.
export interface ApprovalRequest {
  // Foundry's mcpr_… ID, which the decision answers.
  id: string
  server: string
  tool: string
  arguments: Record<string, ApprovalValue>
}

// The user's answer to an approval request. The browser sends only this: Foundry keeps the arguments it proposed.
export interface ApprovalDecision {
  id: string
  approve: boolean
}

interface TurnBase {
  // A lowercase UUID the browser picks for each question, so its log line, its trace and Foundry's run correlate.
  cid: string
  variant: Variant
}

export type TurnRequest =
  // A question, trimmed, 1 to QUESTION_LIMIT characters; previousResponseId is the Foundry response it follows up,
  // which continues that conversation.
  | (TurnBase & { question: string; previousResponseId?: string; approval?: undefined })
  // The user's decision on the approval request that the with-IQ agent's previous response waits for.
  | (TurnBase & { variant: 'with_iq'; approval: ApprovalDecision; previousResponseId: string; question?: undefined })

export type ToolState = 'running' | 'completed' | 'failed'

// One MCP tool call Foundry ran during the turn, as its stream reported it. Never logged with its arguments.
export interface ToolCall {
  id: string
  server: string
  tool: string
  state: ToolState
  ms?: number
  // The call's arguments, shortened, so the user can check that a Web IQ query holds nothing private.
  arguments?: string
  error?: string
}

// needs-approval is a run paused on a tool call the user must approve or reject first; its responseId is the response
// the decision continues.
export type TurnOutcome =
  | { status: 'answered'; text: string; responseId?: string; toolCalls: ToolCall[] }
  | { status: 'needs-consent'; consentUrl: string; server?: string; responseId?: string; toolCalls: ToolCall[] }
  | { status: 'needs-approval'; approval: ApprovalRequest; responseId: string; toolCalls: ToolCall[] }
  | { status: 'failed'; message: string; code?: string; responseId?: string; toolCalls: ToolCall[] }

export type TurnEvent =
  | { type: 'tool'; call: ToolCall }
  | { type: 'heartbeat' }
  | { type: 'result'; outcome: TurnOutcome }

// What GET /api/config returns: only public sign-in settings.
export interface PublicConfig {
  tenantId: string
  clientId: string
  scopes: string[]
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
// Foundry's response IDs, such as resp_6f1c…, are opaque: letters, digits, underscores and hyphens.
export const RESPONSE_ID = /^[A-Za-z0-9_-]{1,256}$/
// Foundry's approval request IDs, such as mcpr_68af…: the prefix, then the same opaque characters.
export const APPROVAL_ID = /^mcpr_[A-Za-z0-9_-]{1,200}$/
// MCP server labels and tool names, such as reprint_request and submit_reprint_request.
const TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/
const ARGUMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const ARGUMENT_COUNT = 20
const ARGUMENT_TEXT_LIMIT = 1000
// Control and invisible format characters, such as direction overrides, which could make the card read differently
// from the call it approves. Tabs and line breaks are plain text.
const HIDDEN_CHARACTERS = /(?![\t\n\r])[\p{Cc}\p{Cf}]/u
const REQUEST_KEYS: ReadonlySet<string> = new Set(['cid', 'variant', 'question', 'approval', 'previousResponseId'])

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): value is string {
  return typeof value === 'string'
}

export function isVariant(value: unknown): value is Variant {
  return value === 'with_iq' || value === 'without_iq'
}

export function iqOf(server: string): IqKey | undefined {
  return Object.hasOwn(SERVER_IQ, server) ? SERVER_IQ[server] : undefined
}

export function isPublicConfig(value: unknown): value is PublicConfig {
  return record(value) && text(value.tenantId) && GUID.test(value.tenantId) && text(value.clientId) && GUID.test(value.clientId)
    && Array.isArray(value.scopes) && value.scopes.length > 0 && value.scopes.every(text)
}

function isToolCall(value: unknown): value is ToolCall {
  return record(value) && text(value.id) && text(value.server) && text(value.tool)
    && (value.state === 'running' || value.state === 'completed' || value.state === 'failed')
    && (value.ms === undefined || (typeof value.ms === 'number' && Number.isFinite(value.ms) && value.ms >= 0))
    && (value.arguments === undefined || text(value.arguments))
    && (value.error === undefined || text(value.error))
}

function isApprovalValue(value: unknown): value is ApprovalValue {
  if (text(value)) return value.length <= ARGUMENT_TEXT_LIMIT && !HIDDEN_CHARACTERS.test(value)
  return value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
}

// A proposed tool call's arguments the card can show in full: a few named, plain values.
export function isApprovalArguments(value: unknown): value is Record<string, ApprovalValue> {
  if (!record(value)) return false
  const entries = Object.entries(value)
  return entries.length <= ARGUMENT_COUNT && entries.every(([name, argument]) => ARGUMENT_NAME.test(name) && isApprovalValue(argument))
}

export function isApprovalRequest(value: unknown): value is ApprovalRequest {
  return record(value) && text(value.id) && APPROVAL_ID.test(value.id) && text(value.server) && TOOL_NAME.test(value.server)
    && text(value.tool) && TOOL_NAME.test(value.tool) && isApprovalArguments(value.arguments)
}

function isOutcome(value: unknown): value is TurnOutcome {
  if (!record(value) || !Array.isArray(value.toolCalls) || !value.toolCalls.every(isToolCall)) return false
  if (value.responseId !== undefined && !text(value.responseId)) return false
  switch (value.status) {
    case 'answered':
      return text(value.text)
    case 'needs-consent':
      return text(value.consentUrl) && (value.server === undefined || text(value.server))
    case 'needs-approval':
      return isApprovalRequest(value.approval) && text(value.responseId) && RESPONSE_ID.test(value.responseId)
    case 'failed':
      return text(value.message) && (value.code === undefined || text(value.code))
    default:
      return false
  }
}

// One line of the stream, or an error: the browser never trusts an unrecognized shape.
export function parseTurnEvent(line: string): TurnEvent {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    throw new Error('The app server sent an unreadable event.')
  }
  if (record(value)) {
    if (value.type === 'heartbeat') return { type: 'heartbeat' }
    if (value.type === 'tool' && isToolCall(value.call)) return { type: 'tool', call: value.call }
    if (value.type === 'result' && isOutcome(value.outcome)) return { type: 'result', outcome: value.outcome }
  }
  throw new Error('The app server sent an unrecognized event.')
}

function parseDecision(value: unknown): ApprovalDecision | undefined {
  if (!record(value) || !Object.keys(value).every((key) => key === 'id' || key === 'approve')) return undefined
  const { id, approve } = value
  return text(id) && APPROVAL_ID.test(id) && typeof approve === 'boolean' ? { id, approve } : undefined
}

// The question as the server accepts it, trimmed, or the decision on an approval request, or undefined: only these
// fields, each well formed. A decision carries no question and needs the with-IQ response it continues.
export function parseTurnRequest(value: unknown): TurnRequest | undefined {
  if (!record(value) || !Object.keys(value).every((key) => REQUEST_KEYS.has(key))) return undefined
  const { cid, variant, question, approval, previousResponseId } = value
  if (!text(cid) || !CID.test(cid) || !isVariant(variant)) return undefined
  if (previousResponseId !== undefined && (!text(previousResponseId) || !RESPONSE_ID.test(previousResponseId))) return undefined
  if (approval !== undefined) {
    const decision = parseDecision(approval)
    if (!decision || question !== undefined || variant !== 'with_iq' || previousResponseId === undefined) return undefined
    return { cid, variant, approval: decision, previousResponseId }
  }
  if (!text(question)) return undefined
  const trimmed = question.trim()
  if (!trimmed || trimmed.length > QUESTION_LIMIT) return undefined
  return previousResponseId === undefined ? { cid, variant, question: trimmed } : { cid, variant, question: trimmed, previousResponseId }
}

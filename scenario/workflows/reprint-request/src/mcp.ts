// The MCP server for one HTTP request, bound to its signed-in user: one tool, submit_reprint_request. Foundry asks the
// user to approve each call in the app before it sends it (require_approval: always), with the user's own token.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { User } from './auth.ts'
import { thousands, type ReprintRequest, type RequestService } from './requests.ts'

export const TOOL_NAME = 'submit_reprint_request'

export const TOOL_DESCRIPTION = [
  'Submits a reprint request to production planning, only after the signed-in user approves it in the app; the request',
  'records them as its approver. Copy every value exactly from the current week\'s Fabric IQ inventory risk signal and its',
  'chosen decision option, the expedite or standard reprint: signal_id, option_id, edition_id, territory, the option\'s',
  'units as quantity, expedited (true for the expedite option) and investment_gbp. Write the rationale in one or two',
  'sentences. The evidence names the signal and the policy sections that govern it: BKS-POL-001 §6 and BKS-GOV-003 §1.',
  'The server checks each value against the governed rows and the approver\'s authority, and refuses anything that differs.',
].join(' ')

const ID = /^[a-z0-9-]{1,120}$/
const TERRITORY = /^[A-Z]{2,3}$/

// Each check's message tells the model how to correct the value, without repeating it.
function copied(field: string, pattern: RegExp, source: string, description: string) {
  const error = `Copy ${field} exactly ${source}.`
  return z.string({ error }).regex(pattern, { error }).describe(description)
}

function whole(error: string, minimum: number, maximum: number, description: string) {
  return z.number({ error }).int({ error }).min(minimum, { error }).max(maximum, { error }).describe(description)
}

function prose(error: string, minimum: number, description: string) {
  return z.string({ error }).trim().min(minimum, { error }).max(600, { error }).describe(description)
}

export const inputSchema = {
  signal_id: copied('signal_id', ID, 'as Fabric IQ returned it', "The inventory risk's signal_id, exactly as Fabric IQ returned it this week."),
  option_id: copied('option_id', ID, 'as Fabric IQ returned it', "The chosen option's option_id: the signal's expedite or standard reprint option."),
  edition_id: copied('edition_id', ID, 'from the option', "The option's edition_id."),
  territory: copied('territory', TERRITORY, 'from the option', "The option's territory."),
  quantity: whole("quantity is the option's units, a whole number.", 1, 10_000_000, "The option's units."),
  expedited: z.boolean({ error: 'expedited is true for the expedite option and false for the standard option.' })
    .describe('true for the expedite option, false for the standard option.'),
  investment_gbp: whole("investment_gbp is the option's investment in whole pounds.", 0, 1_000_000_000,
    "The option's investment_gbp, in whole pounds."),
  rationale: prose('Write the rationale in one or two sentences, 20 to 600 characters.', 20,
    'Why production planning should act, in one or two sentences.'),
  evidence: prose('Name the signal and the policy sections in the evidence, 10 to 600 characters.', 10,
    'The signal and the policy sections it rests on: BKS-POL-001 §6 and BKS-GOV-003 §1.'),
}

export const outputSchema = {
  request_id: z.string(),
  status: z.string(),
  title_name: z.string(),
  edition_id: z.string(),
  territory: z.string(),
  quantity: z.number().int(),
  expedited: z.boolean(),
  investment_gbp: z.number().int(),
  required_approver: z.string(),
  approver_name: z.string(),
  approver_role: z.string(),
  approved_at: z.string(),
  created: z.boolean(),
}

export function describe(request: ReprintRequest): string {
  return `Reprint request ${request.request_id} ${request.created ? 'recorded' : 'was already recorded'}: `
    + `${request.expedited ? 'expedited' : 'standard'} reprint of ${thousands(request.quantity)} copies of ${request.title_name} `
    + `(${request.edition_id}) for ${request.territory}, investment £${thousands(request.investment_gbp)}, approved by `
    + `${request.approver_name} (${request.approver_role}) at ${request.approved_at}. `
    + 'Production planning acts on it under BKS-POL-001 §6.'
}

export interface ToolContext {
  user: User
  requests: RequestService
  version: string
  // Receives the call's outcome code for the request's log line.
  report: (outcome: string) => void
}

export function createMcpServer(context: ToolContext): McpServer {
  const server = new McpServer({ name: 'reprint-request', version: context.version }, { capabilities: { tools: {} } })
  server.registerTool(TOOL_NAME, {
    title: 'Submit reprint request',
    description: TOOL_DESCRIPTION,
    inputSchema,
    outputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args) => {
    const outcome = await context.requests.submit(args, context.user)
    if (!outcome.ok) {
      context.report(outcome.code)
      return { content: [{ type: 'text', text: outcome.message }], isError: true }
    }
    context.report(outcome.request.created ? 'created' : 'replayed')
    return { content: [{ type: 'text', text: describe(outcome.request) }], structuredContent: { ...outcome.request } }
  })
  return server
}

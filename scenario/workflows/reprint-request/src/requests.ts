// The submit_reprint_request tool's logic over the KQL database. The arguments must copy the current week's open
// inventory risk and one of its reprint options exactly; the signed-in user must hold the approver's role for that
// option (BKS-GOV-003); and one approved request per edition and territory actions the risk (BKS-POL-001 §6). The
// request is recorded once, as the server's managed identity, and read back before it is reported. Refusals are short
// sentences that never repeat the rationale or evidence.
import type { User } from './auth.ts'
import { approvingRole, requiredApprover, seniorTo, type Approver } from './authority.ts'
import { appendCommand, literal, type Column, type Database, type Row } from './kusto.ts'

export interface ReprintArguments {
  signal_id: string
  option_id: string
  edition_id: string
  territory: string
  quantity: number
  expedited: boolean
  investment_gbp: number
  rationale: string
  evidence: string
}

export interface ReprintRequest {
  request_id: string
  status: string
  title_name: string
  edition_id: string
  territory: string
  quantity: number
  expedited: boolean
  investment_gbp: number
  required_approver: string
  approver_name: string
  approver_role: string
  approved_at: string
  // false when the same request was already recorded.
  created: boolean
}

export type RefusalCode =
  | 'signal_not_current' | 'not_inventory_risk' | 'signal_not_open' | 'governed_incomplete' | 'option_not_current'
  | 'option_other_signal' | 'not_reprint' | 'argument_mismatch' | 'role_insufficient' | 'no_name' | 'already_requested'
  | 'not_recorded' | 'store_unavailable'

export type Outcome = { ok: true; request: ReprintRequest } | { ok: false; code: RefusalCode; message: string }

export interface RequestService {
  // Never rejects: every failure is a refusal.
  submit: (args: ReprintArguments, user: User) => Promise<Outcome>
}

// The KQL reprint_requests table, in its column order.
export const REPRINT_REQUEST_COLUMNS: readonly Column[] = [
  { name: 'request_id', type: 'string' },
  { name: 'signal_id', type: 'string' },
  { name: 'option_id', type: 'string' },
  { name: 'title_id', type: 'string' },
  { name: 'title_name', type: 'string' },
  { name: 'edition_id', type: 'string' },
  { name: 'territory', type: 'string' },
  { name: 'quantity', type: 'long' },
  { name: 'expedited', type: 'string' },
  { name: 'investment_gbp', type: 'long' },
  { name: 'rationale', type: 'string' },
  { name: 'evidence', type: 'string' },
  { name: 'required_approver', type: 'string' },
  { name: 'approver_role', type: 'string' },
  { name: 'approver_name', type: 'string' },
  { name: 'approver_object_id', type: 'string' },
  { name: 'approved_at', type: 'datetime' },
  { name: 'status', type: 'string' },
  { name: 'as_of_week', type: 'datetime' },
]

const SIGNAL_COLUMNS = 'signal_id, title_id, title_name, signal_type, edition_id, territory, status, first_detected_week, as_of_week'
const OPTION_COLUMNS = 'option_id, signal_id, edition_id, territory, units, investment_gbp'
const REQUEST_COLUMNS = 'request_id, signal_id, option_id, title_name, edition_id, territory, quantity, expedited, investment_gbp, '
  + 'required_approver, approver_role, approver_name, approver_object_id, approved_at, status'
const REPRINT_CODES = ['expedite', 'standard']

const ASK_AGAIN = "Ask Fabric IQ for the current week's inventory risk and its reprint options again, then submit the chosen option."
const STORE_UNAVAILABLE = 'The reprint request store is unavailable, so nothing was recorded. Try again in a few minutes.'
const NOT_RECORDED = 'The reprint request could not be recorded, so production planning has not received it. Try again in a few minutes.'

export function thousands(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function integer(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : undefined
  return typeof value === 'string' && /^-?\d{1,15}$/.test(value) ? Number(value) : undefined
}

function instant(value: unknown): number | undefined {
  const time = typeof value === 'string' ? Date.parse(value) : Number.NaN
  return Number.isNaN(time) ? undefined : time
}

function iso(value: unknown): string | undefined {
  const time = instant(value)
  return time === undefined ? undefined : new Date(time).toISOString()
}

const earliest = (a: Row, b: Row) => (instant(a.approved_at) ?? 0) - (instant(b.approved_at) ?? 0)

function refuse(code: RefusalCode, message: string): Outcome {
  return { ok: false, code, message }
}

function roleRefusal(required: Approver, expedited: boolean, investment: number): string {
  const seniors = seniorTo(required).map((approver) => `the ${approver.name.toLowerCase()}`)
  const instead = seniors.length
    ? ` A more senior approver in the production line may approve it instead (§2): ${seniors.join(' or ')}.`
    : ''
  return `${expedited ? 'An expedited' : 'A standard'} reprint of £${thousands(investment)} needs the `
    + `${required.name.toLowerCase()}'s approval (BKS-GOV-003 §1), and your sign-in does not hold that role.${instead}`
}

function alreadyRequested(row: Row): string {
  const approved = iso(row.approved_at)?.slice(0, 10) ?? 'earlier'
  return `Reprint request ${String(row.request_id)} (${row.expedited === 'Yes' ? 'expedited' : 'standard'} reprint, approved `
    + `${approved}) already actions this inventory risk for ${String(row.edition_id)} in ${String(row.territory)} under `
    + 'BKS-POL-001 §6, so no second request is needed.'
}

function toRequest(row: Row, created: boolean): ReprintRequest | undefined {
  const request = {
    request_id: text(row.request_id), status: text(row.status), title_name: text(row.title_name),
    edition_id: text(row.edition_id), territory: text(row.territory), quantity: integer(row.quantity),
    expedited: row.expedited === 'Yes', investment_gbp: integer(row.investment_gbp),
    required_approver: text(row.required_approver), approver_name: text(row.approver_name),
    approver_role: text(row.approver_role), approved_at: iso(row.approved_at), created,
  }
  return Object.values(request).every((value) => value !== undefined) ? request as ReprintRequest : undefined
}

// Runs tasks with the same key one at a time, in order.
function createLock() {
  const tails = new Map<string, Promise<void>>()
  return async <T>(key: string, task: () => Promise<T>): Promise<T> => {
    const run = (tails.get(key) ?? Promise.resolve()).then(task)
    const tail = run.then(() => undefined, () => undefined)
    tails.set(key, tail)
    try {
      return await run
    } finally {
      if (tails.get(key) === tail) tails.delete(key)
    }
  }
}

export interface RequestServiceOptions {
  database: Database
  clock?: () => Date
}

export function createRequestService(options: RequestServiceOptions): RequestService {
  const { database } = options
  const clock = options.clock ?? (() => new Date())
  const withLock = createLock()

  const first = async (csl: string): Promise<Row | undefined> => (await database.query(csl))[0]

  const submit = async (args: ReprintArguments, user: User): Promise<Outcome> => {
    const signal = await first(`latest_title_signals() | where signal_id == ${literal(args.signal_id)} | project ${SIGNAL_COLUMNS}`)
    if (!signal) return refuse('signal_not_current', `Signal ${args.signal_id} is not among this week's signals. ${ASK_AGAIN}`)
    if (signal.signal_type !== 'Inventory risk') {
      return refuse('not_inventory_risk', `Signal ${args.signal_id} is not an inventory risk, so it has no reprint to request. ${ASK_AGAIN}`)
    }
    if (signal.status !== 'Open') {
      return refuse('signal_not_open', `Signal ${args.signal_id} is not open: its status is ${String(signal.status)}. ${ASK_AGAIN}`)
    }
    const detected = instant(signal.first_detected_week)
    const asOfWeek = iso(signal.as_of_week)
    const titleId = text(signal.title_id)
    const titleName = text(signal.title_name)
    if (detected === undefined || !asOfWeek || !titleId || !titleName) {
      return refuse('governed_incomplete', `Signal ${args.signal_id} is incomplete in the governed data. ${ASK_AGAIN}`)
    }

    const option = await first(`latest_decision_options() | where option_id == ${literal(args.option_id)} | project ${OPTION_COLUMNS}`)
    if (!option) return refuse('option_not_current', `Option ${args.option_id} is not among this week's decision options. ${ASK_AGAIN}`)
    if (option.signal_id !== args.signal_id) {
      return refuse('option_other_signal', `Option ${args.option_id} belongs to another signal. Submit the expedite or standard option of signal ${args.signal_id}.`)
    }
    const code = args.option_id.startsWith(`${args.signal_id}-`) ? args.option_id.slice(args.signal_id.length + 1) : ''
    if (!REPRINT_CODES.includes(code)) {
      return refuse('not_reprint', `Option ${args.option_id} is not a reprint. Submit the expedite or standard reprint option of signal ${args.signal_id}.`)
    }
    const governed = {
      edition_id: text(option.edition_id), territory: text(option.territory), quantity: integer(option.units),
      expedited: code === 'expedite', investment_gbp: integer(option.investment_gbp),
    }
    if (governed.edition_id === undefined || governed.territory === undefined || governed.quantity === undefined
      || governed.investment_gbp === undefined) {
      return refuse('governed_incomplete', `Option ${args.option_id} is incomplete in the governed data. ${ASK_AGAIN}`)
    }
    for (const field of ['edition_id', 'territory', 'quantity', 'expedited', 'investment_gbp'] as const) {
      if (args[field] !== governed[field]) {
        const source = field === 'quantity' ? " (the option's units)" : ''
        return refuse('argument_mismatch', `${field} differs from the governed option ${args.option_id}: use ${String(governed[field])}${source}.`)
      }
    }
    const { edition_id: editionId, territory, quantity, expedited, investment_gbp: investment } = governed

    const required = requiredApprover({ expedited, investmentGbp: investment })
    const approver = approvingRole(user.roles, required)
    if (!approver) return refuse('role_insufficient', roleRefusal(required, expedited, investment))
    if (!user.name) {
      return refuse('no_name', 'Your sign-in carries no name, so the request could not name its approver (BKS-GOV-003 §3). Ask an administrator to check your account.')
    }
    const approverName = user.name

    const requestId = `rr-${args.signal_id.replace(/^sig-/, '')}`
    const read = async (csl: string) => (await database.query(csl)).sort(earliest)
    return withLock(`${editionId}|${territory}`, async () => {
      const existing = (await read(`reprint_requests | where edition_id == ${literal(editionId)} | project ${REQUEST_COLUMNS}`))
        .filter((row) => row.territory === territory && (instant(row.approved_at) ?? -Infinity) >= detected)
      const same = existing.find((row) => row.request_id === requestId && row.option_id === args.option_id)
      if (same) {
        const request = toRequest(same, false)
        return request ? { ok: true, request } : refuse('store_unavailable', STORE_UNAVAILABLE)
      }
      if (existing.length) return refuse('already_requested', alreadyRequested(existing[0]))

      const approvedAt = clock().toISOString()
      const record: Row = {
        request_id: requestId, signal_id: args.signal_id, option_id: args.option_id, title_id: titleId, title_name: titleName,
        edition_id: editionId, territory, quantity, expedited: expedited ? 'Yes' : 'No', investment_gbp: investment,
        rationale: args.rationale, evidence: args.evidence, required_approver: required.name, approver_role: approver.name,
        approver_name: approverName, approver_object_id: user.objectId, approved_at: approvedAt, status: 'Approved',
        as_of_week: asOfWeek,
      }
      // A failed append may still have landed, or an earlier attempt may have recorded this request already (its
      // ingestIfNotExists tag makes a second append fail): only the row read back counts.
      await database.mgmt(appendCommand('reprint_requests', REPRINT_REQUEST_COLUMNS, record, requestId)).catch(() => undefined)
      const [stored] = await read(`reprint_requests | where request_id == ${literal(requestId)} | project ${REQUEST_COLUMNS}`)
      if (!stored) return refuse('not_recorded', NOT_RECORDED)
      if (stored.option_id !== args.option_id) return refuse('already_requested', alreadyRequested(stored))
      const created = stored.approver_object_id === user.objectId && instant(stored.approved_at) === instant(approvedAt)
      const request = toRequest(stored, created)
      return request ? { ok: true, request } : refuse('store_unavailable', STORE_UNAVAILABLE)
    })
  }

  return {
    submit: async (args, user) => {
      try {
        return await submit(args, user)
      } catch {
        return refuse('store_unavailable', STORE_UNAVAILABLE)
      }
    },
  }
}

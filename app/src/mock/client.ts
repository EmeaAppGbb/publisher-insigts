// Mock mode only: `npm run dev:mock` (vite --mode mock). live/client.ts imports this module only behind a literal
// import.meta.env.MODE === 'mock', so production builds never contain it. Canned answers for the sample questions
// stand in for the agents, through the same turn as a live answer: tool calls, one consent request and the reply. A
// question that asks to submit or raise a reprint request for The Glass Orchard plays the approval flow instead.
import type { ApprovalRequest, ToolCall, TurnOutcome } from '../live/protocol.ts'
import { runTurn, type Send, type TurnLog } from '../live/turn.ts'
import type { AgentClient, Session, Variant } from '../live/types.ts'
import { SAMPLES, type SampleId } from '../samples.ts'

export const MOCK_SESSION: Session = {
  mode: 'mock',
  identity: { name: 'Mock user' },
  notice: 'Mock mode · canned answers, no sign-in',
  signIn: async () => {},
  signOut: async () => {},
}

// Long enough for each running state to show.
export const MOCK_DELAY_MS = 900
export const MOCK_CONSENT_URL = 'https://example.com/mock-consent'

export interface Canned {
  tools: { server: string; tool: string; arguments: string }[]
  answer: string
  // The tool server whose consent the first ask of this question asks for.
  consent?: string
}

const NO_TOOLS = (what: string): Canned => ({
  tools: [],
  answer: [
    `**I can't confirm ${what}.** This version of the assistant has no tools, so it can't check, and it won't guess.`,
    '',
    'Sources',
    '',
    'Steps',
    '1. Called no tool: this version has none.',
  ].join('\n'),
})

// By sample, then variant. The figures and keys are the seeded week's rows (2 November 2026). The reprint request
// plays the approval flow instead (MOCK_REPRINT).
const CANNED: Readonly<Record<Exclude<SampleId, 'reprint'>, Record<Variant, Canned>>> = {
  attention: {
    with_iq: {
      tools: [{
        server: 'fabric_iq_ontology', tool: 'ask_ontology',
        arguments: '{"question":"Which TitleSignal rows have the IsMaterial value \\"Yes\\"? Return each SignalId, TitleName, SignalType, Headline, ExcessExposureGbp and RecommendedOption."}',
      }],
      answer: [
        '**Five material signals for three titles: Northbound Signals has excess UK hardback stock, The Glass Orchard sells at 3.1x its forecast and Salt and Starlight has momentum without a live campaign.** [D1]',
        '',
        '- Northbound Signals · Excess inventory · 362 days of Hardback stock in UK with a reprint on order · £47,200 exposure · recommended: pause the planned reprint [D1]',
        '- The Glass Orchard · Forecast variance · outperforming forecast by 3.1x [D1]',
        '- Salt and Starlight · Marketing opportunity · momentum without a live campaign · recommended: increase marketing [D1]',
        '- Salt and Starlight · Public momentum · search interest up 109% with 13 media mentions in four weeks [D1]',
        '- Northbound Signals · Forecast variance · selling at 0.5x of forecast [D1]',
        '',
        'Sources',
        '- [D1] BooksOntology · TitleSignal · sig-20261102-title-004-exc-ed-004-hb-uk',
        '- [D1] BooksOntology · TitleSignal · sig-20261102-title-001-fcv',
        '- [D1] BooksOntology · TitleSignal · sig-20261102-title-003-mkt',
        '- [D1] BooksOntology · TitleSignal · sig-20261102-title-003-mom',
        '- [D1] BooksOntology · TitleSignal · sig-20261102-title-004-fcv',
        '',
        'Steps',
        '1. Fabric IQ ontology: asked which TitleSignal rows have the IsMaterial value "Yes"; it returned five signals for three titles.',
      ].join('\n'),
    },
    without_iq: NO_TOOLS('which titles need attention this week'),
  },
  sales: {
    with_iq: {
      tools: [{
        server: 'fabric_iq_ontology', tool: 'ask_ontology',
        arguments: '{"question":"Which TitlePerformance rows have the TitleName value \\"The Glass Orchard\\"? Return each TitleId, UnitsThisWeek, WeekChangePct, UnitsLast4Weeks, ForecastLast4Weeks, ActualVsForecast, RevenueLast4WeeksGbp, TopTerritory, TopChannel, TopFormat, PortfolioRank and LiveCampaign."}',
      }],
      answer: [
        '**The Glass Orchard is selling at 3.1x its forecast: 49,624 units in the last four weeks against 16,208 forecast, led by the UK.** [D1]',
        '',
        '- 13,217 units this week, up 3.7% on the week before, the portfolio\'s best seller [D1]',
        '- Top territory UK, top channel Digital, top format Hardback [D1]',
        '- £402,183 revenue in the last four weeks, with the Shortlist push campaign live [D1]',
        '',
        'Sources',
        '- [D1] BooksOntology · TitlePerformance · title-001',
        '',
        'Steps',
        '1. Fabric IQ ontology: asked for The Glass Orchard\'s TitlePerformance row; it returned its sales against forecast, where they come from and its live campaign.',
      ].join('\n'),
    },
    without_iq: NO_TOOLS('how The Glass Orchard is selling against its forecast'),
  },
  options: {
    with_iq: {
      tools: [
        {
          server: 'fabric_iq_ontology', tool: 'ask_ontology',
          arguments: '{"question":"Which DecisionOption rows have the TitleName value \\"The Glass Orchard\\"? Return each OptionId, OptionName, IsRecommended, Units, InvestmentGbp, RevenueProtectedGbp, RemainingRiskGbp, ArrivalDays, KeyAssumption and PrimaryRisk."}',
        },
        {
          server: 'foundry_iq_knowledge', tool: 'knowledge_base_retrieve',
          arguments: '{"queries":["Who may approve an expedited reprint, and up to what investment, according to the decision authority matrix?"]}',
        },
      ],
      answer: [
        '**The expedited reprint is recommended: 20,000 units for £50,000, arriving in 21 days and protecting £84,571.** [D1] As an expedited reprint up to £150,000, it needs the publishing director\'s approval [F1 §1].',
        '',
        '- Expedited reprint · 20,000 units · £50,000 · protects £84,571 · 21 days · recommended [D1]',
        '- Standard reprint · 32,000 units · £67,200 · protects £0, leaving £84,571 at risk · 35 days [D1]',
        '- Reallocate stock from other territories · 8,658 units · £2,597 · protects £83,117, leaving £1,454 at risk · 7 days [D1]',
        '',
        'It assumes demand stays at the last two weeks\' rate until the reprint lands; the primary risk is that demand normalises before the stock arrives [D1].',
        '',
        'Sources',
        '- [D1] BooksOntology · DecisionOption · sig-20261102-title-001-inv-ed-001-hb-uk-expedite',
        '- [D1] BooksOntology · DecisionOption · sig-20261102-title-001-inv-ed-001-hb-uk-standard',
        '- [D1] BooksOntology · DecisionOption · sig-20261102-title-001-inv-ed-001-hb-uk-reallocate',
        '- [F1] Decision authority matrix · §1 Approval limits',
        '',
        'Steps',
        '1. Fabric IQ ontology: asked for The Glass Orchard\'s DecisionOption rows; it returned three options for its UK hardback inventory risk.',
        '2. Foundry IQ knowledge: asked who may approve an expedited reprint; it returned the decision authority matrix\'s approval limits.',
      ].join('\n'),
    },
    without_iq: NO_TOOLS('The Glass Orchard\'s options or who may approve them'),
  },
  outcome: {
    with_iq: {
      tools: [
        {
          server: 'fabric_iq_ontology', tool: 'ask_ontology',
          arguments: '{"question":"Which TitleSignal rows have the SignalType value \\"Inventory risk\\"? Return each SignalId, TitleName, Format, Territory, StockCoverDays, ReprintLeadTimeDays, OpportunityAtRiskGbp and Status."}',
        },
        {
          server: 'fabric_iq_ontology', tool: 'ask_ontology',
          arguments: '{"question":"Which ReprintRequest rows are there? Return each RequestId, TitleName, EditionId, Territory, Quantity, Expedited, ApproverName, ApprovedAt and Status."}',
        },
      ],
      answer: [
        "**One inventory risk is open and no reprint request is recorded yet: The Glass Orchard's UK hardback covers 24 days against a 35-day reprint lead time.** [D1]",
        '',
        '- The Glass Orchard · Hardback · UK · 24 days of cover · £84,571 at risk · Open [D1]',
        '- Reprint requests: none recorded [D2]',
        '',
        'Sources',
        '- [D1] BooksOntology · TitleSignal · sig-20261102-title-001-inv-ed-001-hb-uk',
        '- [D2] BooksOntology · ReprintRequest · no rows',
        '',
        'Steps',
        '1. Fabric IQ ontology: asked which TitleSignal rows have the SignalType value "Inventory risk"; it returned one open risk.',
        '2. Fabric IQ ontology: asked for the ReprintRequest rows; it returned none.',
      ].join('\n'),
    },
    without_iq: NO_TOOLS('which inventory risks are open or which reprint requests are recorded'),
  },
  policy: {
    with_iq: {
      tools: [{
        server: 'foundry_iq_knowledge', tool: 'knowledge_base_retrieve',
        arguments: '{"queries":["How much stock cover should a reprint leave after it lands, according to the reprint and stock policy?"]}',
      }],
      answer: [
        '**28 days of cover after the reprint lands.** [F1 §3]',
        '',
        '- The reprint and stock policy orders the daily rate × (the reprint\'s lead time + 28 days), less the stock on hand and on order, rounded up to the next 1,000 units and never below the edition\'s minimum reprint [F1 §3].',
        '',
        'Sources',
        '- [F1] Reprint and stock policy · §3 Sizing a reprint',
        '',
        'Steps',
        '1. Foundry IQ knowledge: asked how much cover a reprint should leave; it returned the reprint and stock policy\'s section on sizing a reprint.',
      ].join('\n'),
    },
    without_iq: NO_TOOLS('what the reprint policy says'),
  },
  shortlists: {
    with_iq: {
      tools: [{
        server: 'web_iq_public_context', tool: 'web',
        arguments: '{"query":"literary prize shortlist effect on book sales","maxResults":3,"contentFormat":"passage","maxLength":1500}',
      }],
      answer: [
        '**Public context, not company data:** trade coverage reports that a literary prize shortlist tends to lift a title\'s sales and media attention, with the largest lift for the eventual winner [Web1].',
        '',
        'Sources',
        '- [Web1] How prize shortlists move book sales · example.com · https://example.com/prize-shortlists',
        '',
        'Steps',
        '1. Web IQ public context: searched public coverage of how literary prize shortlists affect book sales, without any title, author or company detail; it returned one trade article.',
      ].join('\n'),
    },
    without_iq: NO_TOOLS('public context on literary prize shortlists'),
  },
  romantasy: {
    with_iq: {
      tools: [{
        server: 'web_iq_public_context', tool: 'web',
        arguments: '{"query":"romantasy readership trends","maxResults":3,"contentFormat":"passage","maxLength":1500}',
      }],
      answer: [
        '**Public context, not company data:** trade coverage describes romantasy as a fast-growing fiction category, with readers often finding titles through online communities [Web1].',
        '',
        'Sources',
        '- [Web1] Romantasy readership trends · example.com · https://example.com/romantasy-readership',
        '',
        'Steps',
        '1. Web IQ public context: searched public coverage of romantasy readership trends, without any title, author or company detail; it returned one trade article.',
      ].join('\n'),
    },
    without_iq: NO_TOOLS('public context on romantasy readership'),
  },
  mail: {
    with_iq: {
      consent: 'work_iq_mail',
      tools: [{
        server: 'work_iq_mail', tool: 'fetch',
        arguments: '{"entityUrls":["/me/messages?$search=\\"The Glass Orchard\\"&$select=subject,from,receivedDateTime,webLink,body&$top=10"]}',
      }],
      answer: [
        '**Two recent messages mention The Glass Orchard.**',
        '',
        '- Brindle Print Works offered an expedited press slot for the hardback, to be confirmed by 6 November 2026 [W1].',
        '- The major retail account manager asked for more UK hardback stock for a Christmas promotion [W2].',
        '',
        'Mail is what people reported, offered or planned, not current figures; the live ontology holds those.',
        '',
        'Sources',
        '- [W1] Outlook · Brindle Print Works scheduling · 30 October 2026 · Expedited slot for The Glass Orchard · https://example.com/mail/1',
        '- [W2] Outlook · Major retail account manager · 2 November 2026 · Christmas promotion stock · https://example.com/mail/2',
        '',
        'Steps',
        '1. Work IQ mail: searched your mail for "The Glass Orchard"; it returned two messages.',
      ].join('\n'),
    },
    without_iq: NO_TOOLS('what your mail says about The Glass Orchard'),
  },
}

// By sample question, in the samples' order.
export const MOCK_ANSWERS: Readonly<Record<string, Record<Variant, Canned>>> = Object.fromEntries(
  SAMPLES.flatMap((sample) => (sample.id === 'reprint' ? [] : [[sample.question, CANNED[sample.id]]])),
)

const FALLBACK: Canned = {
  tools: [],
  answer: '**Mock mode has canned answers for the sample questions only.** Pick a sample question, or run `npm run dev` against a deployment to ask the live agents.',
}

// The week's UK hardback inventory risk for The Glass Orchard and its recommended option, as the seeded rows give them.
const REPRINT_ARGUMENTS = {
  signal_id: 'sig-20261102-title-001-inv-ed-001-hb-uk',
  option_id: 'sig-20261102-title-001-inv-ed-001-hb-uk-expedite',
  edition_id: 'ed-001-hb',
  territory: 'UK',
  quantity: 20000,
  expedited: true,
  investment_gbp: 50000,
  rationale: 'The Glass Orchard sells at 3.1x its forecast and its UK hardback runs out before a standard reprint would land; the recommended expedited reprint protects £84,571.',
  evidence: 'Signal sig-20261102-title-001-inv-ed-001-hb-uk, the UK hardback inventory risk; reprint and stock policy BKS-POL-001 §6; decision authority matrix BKS-GOV-003 §1.',
}

const OPTION_STEPS = [
  "1. Fabric IQ ontology: asked for The Glass Orchard's DecisionOption rows; it returned the recommended expedited reprint for its UK hardback inventory risk.",
  '2. Foundry IQ knowledge: asked what a reprint request records and who may approve an expedited reprint; it returned the reprint and stock policy and the decision authority matrix.',
]

// A question that asks to submit or raise a reprint request for The Glass Orchard.
export function asksForReprint(question: string): boolean {
  return /\b(?:submit|raise)\b/i.test(question) && /\breprint\b/i.test(question) && /\bglass orchard\b/i.test(question)
}

// The approval flow: the with-IQ agent reads the option, then holds the request for the user's approval (a fresh mcpr_
// ID each time); the decision plays approved or rejected. The agent without tools submits nothing.
export const MOCK_REPRINT: {
  tools: Canned['tools']
  approval: Omit<ApprovalRequest, 'id'>
  approved: Canned
  rejected: Canned
  withoutIq: Canned
} = {
  tools: [
    {
      server: 'fabric_iq_ontology', tool: 'ask_ontology',
      arguments: '{"question":"Which DecisionOption rows have the TitleName value \\"The Glass Orchard\\"? Return each OptionId, SignalId, EditionId, Territory, OptionName, IsRecommended, Units, InvestmentGbp, RevenueProtectedGbp and ArrivalDays."}',
    },
    {
      server: 'foundry_iq_knowledge', tool: 'knowledge_base_retrieve',
      arguments: '{"queries":["What must a reprint request record, and who may approve an expedited reprint?"]}',
    },
  ],
  approval: { server: 'reprint_request', tool: 'submit_reprint_request', arguments: REPRINT_ARGUMENTS },
  approved: {
    tools: [{ server: 'reprint_request', tool: 'submit_reprint_request', arguments: JSON.stringify(REPRINT_ARGUMENTS) }],
    answer: [
      '**The expedited reprint of The Glass Orchard is approved and recorded as request rr-20261102-title-001-inv-ed-001-hb-uk.** [A1]',
      '',
      '- 20,000 UK hardbacks, expedited, for £50,000, arriving in 21 days and protecting £84,571 [D1]',
      '- Approved by Mock user as publishing director [A1], the approver an expedited reprint up to £150,000 needs [F1 §1]',
      '',
      'Sources',
      '- [A1] Reprint request · rr-20261102-title-001-inv-ed-001-hb-uk · Approved · Mock user (Publishing director) · 2026-11-18T10:15:00Z',
      '- [D1] BooksOntology · DecisionOption · sig-20261102-title-001-inv-ed-001-hb-uk-expedite',
      '- [F1] Decision authority matrix · §1 Approval limits',
      '',
      'Steps',
      ...OPTION_STEPS,
      '3. Reprint request: submitted the expedited reprint with your approval; it recorded request rr-20261102-title-001-inv-ed-001-hb-uk.',
    ].join('\n'),
  },
  rejected: {
    tools: [],
    answer: [
      '**Nothing was submitted: you rejected the expedited reprint request for The Glass Orchard.** [D1]',
      '',
      'Sources',
      '- [D1] BooksOntology · DecisionOption · sig-20261102-title-001-inv-ed-001-hb-uk-expedite',
      '',
      'Steps',
      ...OPTION_STEPS,
      '3. Reprint request: proposed the expedited reprint for your approval; you rejected it, so it was not submitted.',
    ].join('\n'),
  },
  withoutIq: {
    tools: [],
    answer: [
      "**Nothing was submitted: this version of the assistant has no tools, so it can't raise a reprint request.**",
      '',
      'Sources',
      '',
      'Steps',
      '1. Called no tool: this version has none.',
    ].join('\n'),
  },
}

function canned(question: string, variant: Variant): Canned {
  const key = question.trim().toLowerCase()
  const match = Object.keys(MOCK_ANSWERS).find((sample) => sample.toLowerCase() === key)
  return match ? MOCK_ANSWERS[match][variant] : FALLBACK
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
  })
}

export interface MockOptions {
  delayMs?: number
  log?: (record: TurnLog) => void
}

export function createMockClient(options: MockOptions = {}): AgentClient {
  const delayMs = options.delayMs ?? MOCK_DELAY_MS
  // The servers this mock user has "consented" to: a question that needs one asks for consent once.
  const consented = new Set<string>()
  const play = async (tools: Canned['tools'], signal: AbortSignal, onTool: (call: ToolCall) => void): Promise<ToolCall[]> => {
    const calls: ToolCall[] = []
    for (const [index, tool] of tools.entries()) {
      const id = `mock_call_${index + 1}`
      const started = performance.now()
      onTool({ id, server: tool.server, tool: tool.tool, state: 'running' })
      await pause(delayMs, signal)
      const done: ToolCall = {
        id, server: tool.server, tool: tool.tool, state: 'completed', ms: Math.round(performance.now() - started), arguments: tool.arguments,
      }
      calls.push(done)
      onTool(done)
    }
    await pause(delayMs / 2, signal)
    return calls
  }
  const send: Send = async (question, _cid, signal, onTool): Promise<TurnOutcome> => {
    const responseId = `resp_mock_${crypto.randomUUID().replaceAll('-', '')}`
    if (question.approval) {
      const reply = question.approval.approve ? MOCK_REPRINT.approved : MOCK_REPRINT.rejected
      return { status: 'answered', text: reply.answer, responseId, toolCalls: await play(reply.tools, signal, onTool) }
    }
    if (asksForReprint(question.text) && question.variant === 'with_iq') {
      const toolCalls = await play(MOCK_REPRINT.tools, signal, onTool)
      const approval: ApprovalRequest = { id: `mcpr_mock_${crypto.randomUUID().replaceAll('-', '')}`, ...MOCK_REPRINT.approval }
      return { status: 'needs-approval', approval, responseId, toolCalls }
    }
    const reply = asksForReprint(question.text) ? MOCK_REPRINT.withoutIq : canned(question.text, question.variant)
    if (reply.consent && !consented.has(reply.consent)) {
      await pause(delayMs, signal)
      consented.add(reply.consent)
      return { status: 'needs-consent', consentUrl: MOCK_CONSENT_URL, server: reply.consent, responseId, toolCalls: [] }
    }
    return { status: 'answered', text: reply.answer, responseId, toolCalls: await play(reply.tools, signal, onTool) }
  }
  return {
    mode: 'mock',
    ask: (question, signal, onTool) => runTurn({ question, send, signal, onTool, log: options.log }),
  }
}

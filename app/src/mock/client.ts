// Mock mode only: `npm run dev:mock` (vite --mode mock). live/client.ts imports this module only behind a literal
// import.meta.env.MODE === 'mock', so production builds never contain it. Canned answers for the sample questions
// stand in for the agents, through the same turn as a live answer: tool calls, one consent request and the reply.
import type { ToolCall, TurnOutcome } from '../live/protocol.ts'
import { runTurn, type Send, type TurnLog } from '../live/turn.ts'
import type { AgentClient, Session, Variant } from '../live/types.ts'
import { SAMPLES } from '../samples.ts'

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

const [attention, options, policy, publicContext, mail] = SAMPLES.map((sample) => sample.question)

// By sample question, then variant. The figures and keys are the seeded week's rows (2 November 2026).
export const MOCK_ANSWERS: Readonly<Record<string, Record<Variant, Canned>>> = {
  [attention]: {
    with_iq: {
      tools: [{
        server: 'fabric_iq_ontology', tool: 'ask_ontology',
        arguments: '{"question":"Which TitleSignal rows have the IsMaterial value \\"Yes\\"? Return each SignalId, TitleName, SignalType, Headline, ExcessExposureGbp and RecommendedOption."}',
      }],
      answer: [
        '**Five material signals for three titles: Northbound Signals has excess UK hardback stock, The Glass Orchard sells at 3.1x its forecast and Salt and Starlight has momentum without a live campaign.** [D1] [D2] [D3]',
        '',
        '- Northbound Signals · Excess inventory · 362 days of Hardback stock in UK with a reprint on order · £47,200 exposure · recommended: pause the planned reprint [D1]',
        '- The Glass Orchard · Forecast variance · outperforming forecast by 3.1x [D2]',
        '- Salt and Starlight · Marketing opportunity · momentum without a live campaign · recommended: increase marketing [D3]',
        '- Salt and Starlight · Public momentum · search interest up 109% with 13 media mentions in four weeks [D4]',
        '- Northbound Signals · Forecast variance · selling at 0.5x of forecast [D5]',
        '',
        'Sources',
        '- [D1] BooksOntology · TitleSignal · sig-20261102-title-004-exc-ed-004-hb-uk',
        '- [D2] BooksOntology · TitleSignal · sig-20261102-title-001-fcv',
        '- [D3] BooksOntology · TitleSignal · sig-20261102-title-003-mkt',
        '- [D4] BooksOntology · TitleSignal · sig-20261102-title-003-mom',
        '- [D5] BooksOntology · TitleSignal · sig-20261102-title-004-fcv',
        '',
        'Steps',
        '1. Fabric IQ ontology: asked which TitleSignal rows have the IsMaterial value "Yes"; it returned five signals for three titles.',
      ].join('\n'),
    },
    without_iq: NO_TOOLS('which titles need attention this week'),
  },
  [options]: {
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
        '- Standard reprint · 32,000 units · £67,200 · protects £0, leaving £84,571 at risk · 35 days [D2]',
        '- Reallocate stock from other territories · 8,658 units · £2,597 · protects £83,117, leaving £1,454 at risk · 7 days [D3]',
        '',
        'It assumes demand stays at the last two weeks\' rate until the reprint lands; the primary risk is that demand normalises before the stock arrives [D1].',
        '',
        'Sources',
        '- [D1] BooksOntology · DecisionOption · sig-20261102-title-001-inv-ed-001-hb-uk-expedite',
        '- [D2] BooksOntology · DecisionOption · sig-20261102-title-001-inv-ed-001-hb-uk-standard',
        '- [D3] BooksOntology · DecisionOption · sig-20261102-title-001-inv-ed-001-hb-uk-reallocate',
        '- [F1] Decision authority matrix · §1 Approval limits',
        '',
        'Steps',
        '1. Fabric IQ ontology: asked for The Glass Orchard\'s DecisionOption rows; it returned three options for its UK hardback inventory risk.',
        '2. Foundry IQ knowledge: asked who may approve an expedited reprint; it returned the decision authority matrix\'s approval limits.',
      ].join('\n'),
    },
    without_iq: NO_TOOLS('The Glass Orchard\'s options or who may approve them'),
  },
  [policy]: {
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
  [publicContext]: {
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
  [mail]: {
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

const FALLBACK: Canned = {
  tools: [],
  answer: '**Mock mode has canned answers for the sample questions only.** Pick a sample question, or run `npm run dev` against a deployment to ask the live agents.',
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
  const send: Send = async (question, _cid, signal, onTool): Promise<TurnOutcome> => {
    const reply = canned(question.text, question.variant)
    const responseId = `resp_mock_${crypto.randomUUID().replaceAll('-', '')}`
    if (reply.consent && !consented.has(reply.consent)) {
      await pause(delayMs, signal)
      consented.add(reply.consent)
      return { status: 'needs-consent', consentUrl: MOCK_CONSENT_URL, server: reply.consent, responseId, toolCalls: [] }
    }
    const calls: ToolCall[] = []
    for (const [index, tool] of reply.tools.entries()) {
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
    return { status: 'answered', text: reply.answer, responseId, toolCalls: calls }
  }
  return {
    mode: 'mock',
    ask: (question, signal, onTool) => runTurn({ question, send, signal, onTool, log: options.log }),
  }
}

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { StoryContext } from './components/AnswerPanel.tsx'
import { DemoModal } from './components/DemoModal.tsx'
import type { TurnActions } from './components/Exchange.tsx'
import { GuidedBar } from './components/GuidedBar.tsx'
import { ActPage } from './components/pages/ActPage.tsx'
import { AskPage } from './components/pages/AskPage.tsx'
import { DecidePage } from './components/pages/DecidePage.tsx'
import { MeasurePage } from './components/pages/MeasurePage.tsx'
import { SignalPage } from './components/pages/SignalPage.tsx'
import { UnderstandPage } from './components/pages/UnderstandPage.tsx'
import { Rail } from './components/Rail.tsx'
import { Reveal } from './components/Reveal.tsx'
import { Toast, type ToastMessage } from './components/Toast.tsx'
import { Topbar } from './components/Topbar.tsx'
import { TrustDrawer } from './components/TrustDrawer.tsx'
import { decisionTurn, followUpFrom, latestExchange, newTurn, questionOf, reduce, type Exchange, type Thread, type Turn } from './exchanges.ts'
import type { Choice } from './labels.ts'
import { createAgentClient, loadSession } from './live/client.ts'
import type { Question, Session, Variant } from './live/types.ts'
import { sample } from './samples.ts'
import {
  PAGES, STAGE_SAMPLES, STEPS, isPageId, isUnderstandStage, pageStage, sessionIqStats, type PageId, type Stage, type UnderstandStage,
} from './story.ts'

type SessionState =
  | { status: 'loading' }
  | { status: 'ready'; session: Session }
  | { status: 'failed'; message: string }

// The page and the Understand tab survive a reload in this tab, such as the return from Entra sign-in.
const PAGE_KEY = 'book-intelligence.page'
const TAB_KEY = 'book-intelligence.tab'

function remembered<T extends string>(key: string, valid: (value: unknown) => value is T, fallback: T): T {
  try {
    const value = sessionStorage.getItem(key)
    return valid(value) ? value : fallback
  } catch {
    return fallback
  }
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export default function App() {
  const [sessionState, setSessionState] = useState<SessionState>({ status: 'loading' })
  const [problem, setProblem] = useState<string>()
  const [exchanges, dispatch] = useReducer(reduce, [])
  const [page, setPage] = useState<PageId>(() => remembered(PAGE_KEY, isPageId, 'signal'))
  const [tab, setTab] = useState<UnderstandStage>(() => remembered(TAB_KEY, isUnderstandStage, 'understand:sales'))
  // The guided story's step while it runs.
  const [story, setStory] = useState<{ step: number }>()
  // The open drawer and the exchange it explains.
  const [drawer, setDrawer] = useState<{ exchangeId?: string }>()
  const [modal, setModal] = useState(false)
  const [reveal, setReveal] = useState(false)
  const [toast, setToast] = useState<ToastMessage>()
  // Counts the navigations that move focus to the new page's heading.
  const [arrivals, setArrivals] = useState(0)
  const client = useMemo(() => createAgentClient(), [])
  // The running turns' controllers, by turn: Stop aborts one, and the server then stops its Foundry run.
  const controllers = useRef(new Map<string, AbortController>())
  // The exchanges whose agent without IQ was asked, so a double click asks it once.
  const compared = useRef(new Set<string>())

  useEffect(() => {
    let active = true
    loadSession().then(
      (session) => {
        if (active) setSessionState({ status: 'ready', session })
      },
      (error: unknown) => {
        if (active) setSessionState({ status: 'failed', message: messageOf(error, 'Sign-in could not start.') })
      },
    )
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const running = controllers.current
    return () => {
      for (const controller of running.values()) controller.abort()
    }
  }, [])

  useEffect(() => {
    try {
      sessionStorage.setItem(PAGE_KEY, page)
      sessionStorage.setItem(TAB_KEY, tab)
    } catch {
      // Without storage the app starts on Signal after a reload.
    }
  }, [page, tab])

  useEffect(() => {
    if (arrivals) document.querySelector<HTMLElement>('#main h1')?.focus()
  }, [arrivals])

  const session = sessionState.status === 'ready' ? sessionState.session : undefined
  const blocked = sessionState.status === 'loading' ? 'Connecting to the app server…'
    : sessionState.status === 'failed' ? 'The app can’t ask the agents until sign-in starts.'
      : session?.identity ? undefined : 'Sign in with your Microsoft Entra account to ask the agents.'

  const run = useCallback((turnId: string, question: Question) => {
    const controller = new AbortController()
    controllers.current.set(turnId, controller)
    void client.ask(question, controller.signal, (call) => dispatch({ type: 'tool', turnId, call })).then((result) => {
      if (controllers.current.get(turnId) === controller) controllers.current.delete(turnId)
      dispatch({ type: 'finish', turnId, result })
    })
  }, [client])

  // A new exchange: one thread per agent asked, each its own run. A story page's question names its stage.
  const ask = useCallback((text: string, choice: Choice, stage?: Stage) => {
    const variants: Variant[] = choice === 'both' ? ['with_iq', 'without_iq'] : [choice]
    const startedAt = performance.now()
    const exchange: Exchange = {
      id: crypto.randomUUID(),
      question: text,
      ...(stage ? { stage } : {}),
      threads: variants.map((variant) => ({ id: crypto.randomUUID(), variant, turns: [newTurn(crypto.randomUUID(), text, startedAt)] })),
    }
    dispatch({ type: 'ask', exchange })
    for (const thread of exchange.threads) run(thread.turns[0].id, { variant: thread.variant, text })
  }, [run])

  const askStage = useCallback((stage: Stage) => ask(sample(STAGE_SAMPLES[stage]).question, 'with_iq', stage), [ask])

  // The agent without IQ, asked the same question beside a story answer.
  const compare = useCallback((exchange: Exchange) => {
    if (compared.current.has(exchange.id) || exchange.threads.some((thread) => thread.variant === 'without_iq')) return
    compared.current.add(exchange.id)
    const turn = newTurn(crypto.randomUUID(), exchange.question, performance.now())
    dispatch({ type: 'thread', exchangeId: exchange.id, thread: { id: crypto.randomUUID(), variant: 'without_iq', turns: [turn] } })
    run(turn.id, { variant: 'without_iq', text: exchange.question })
  }, [run])

  const showToast = useCallback((text: string) => setToast((previous) => ({ id: (previous?.id ?? 0) + 1, text })), [])

  // Empties every answer and stops the running turns; the server then stops their Foundry runs.
  const clear = useCallback(() => {
    for (const controller of controllers.current.values()) controller.abort()
    controllers.current.clear()
    compared.current.clear()
    dispatch({ type: 'clear' })
    setStory(undefined)
    setModal(false)
    showToast('All answers cleared; running questions stopped.')
  }, [showToast])

  const authenticate = useCallback((action: 'signIn' | 'signOut') => {
    setProblem(undefined)
    session?.[action]().catch((error: unknown) => setProblem(messageOf(error, 'Microsoft Entra sign-in did not start. Try again.')))
  }, [session])

  const actions = useMemo<TurnActions>(() => ({
    onFollowUp: (thread: Thread, text: string) => {
      const previousResponseId = followUpFrom(thread)
      const turn = newTurn(crypto.randomUUID(), text, performance.now(), previousResponseId)
      dispatch({ type: 'follow-up', threadId: thread.id, turn })
      run(turn.id, questionOf(thread, turn))
    },
    // The decision continues the run that waits for it, as the thread's next turn.
    onDecide: (thread: Thread, approve: boolean) => {
      const turn = decisionTurn(thread, approve, crypto.randomUUID(), performance.now())
      if (!turn) return
      dispatch({ type: 'follow-up', threadId: thread.id, turn })
      run(turn.id, questionOf(thread, turn))
    },
    onRetry: (thread: Thread, turn: Turn) => {
      dispatch({ type: 'restart', turnId: turn.id, startedAt: performance.now() })
      run(turn.id, questionOf(thread, turn))
    },
    onStop: (turn: Turn) => controllers.current.get(turn.id)?.abort(),
    onSignIn: () => authenticate('signIn'),
  }), [run, authenticate])

  const go = useCallback((target: PageId) => {
    setPage(target)
    setArrivals((count) => count + 1)
  }, [])

  // The rail ends a running story.
  const navigate = useCallback((target: PageId) => {
    setStory(undefined)
    go(target)
  }, [go])

  // Opens a story step: its page, its narrative and, unless the page has an answer, its question.
  const enterStep = useCallback((index: number) => {
    const step = STEPS[index]
    setStory({ step: index })
    setPage(step.page)
    if (step.page === 'understand') setTab('understand:sales')
    showToast(step.text)
    if (!blocked && !latestExchange(exchanges, step.stage)) askStage(step.stage)
  }, [askStage, blocked, exchanges, showToast])

  const next = useCallback(() => {
    if (!story) {
      enterStep(0)
    } else if (story.step < STEPS.length - 1) {
      enterStep(story.step + 1)
    } else {
      setStory(undefined)
      setReveal(true)
    }
  }, [enterStep, story])

  const previous = useCallback(() => {
    if (!story) showToast('Start the guided story first.')
    else if (story.step > 0) enterStep(story.step - 1)
  }, [enterStep, showToast, story])

  // Every story step's question without an answer, asked last-first so the Ask page lists them in story order.
  const askAll = useCallback(() => {
    setModal(false)
    if (blocked) return
    const missing = STEPS.map((step) => step.stage).filter((stage) => !latestExchange(exchanges, stage))
    for (const stage of missing.toReversed()) askStage(stage)
    showToast(missing.length ? 'Asking each story page’s question as you.' : 'Every story page already has an answer.')
  }, [askStage, blocked, exchanges, showToast])

  const context: StoryContext = {
    exchanges,
    mode: session?.mode,
    user: session?.identity?.name,
    blocked,
    actions,
    ask: askStage,
    compare,
    trust: (exchange) => setDrawer({ exchangeId: exchange?.id }),
    go,
  }
  const stage = pageStage(page, tab)
  const pageExchange = stage ? latestExchange(exchanges, stage) : exchanges[0]
  const drawerExchange = drawer?.exchangeId ? exchanges.find((exchange) => exchange.id === drawer.exchangeId) : undefined
  const content = page === 'signal' ? <SignalPage story={context} />
    : page === 'understand' ? <UnderstandPage story={context} tab={tab} onTab={setTab} />
      : page === 'decide' ? <DecidePage story={context} />
        : page === 'act' ? <ActPage story={context} />
          : page === 'measure' ? <MeasurePage story={context} onReveal={() => setReveal(true)} />
            : <AskPage story={context} onAsk={(question, choice) => ask(question, choice)} />

  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <div className="shell">
        <Rail page={page} onNavigate={navigate} />
        <div className="workspace">
          <Topbar
            crumb={PAGES.find((entry) => entry.id === page)?.crumb ?? ''}
            session={session}
            onSignIn={() => authenticate('signIn')}
            onSignOut={() => authenticate('signOut')}
            onTrust={() => setDrawer({ exchangeId: pageExchange?.id })}
            onDemo={() => setModal(true)}
          />
          <main id="main" className="content" tabIndex={-1}>
            {story && <GuidedBar step={story.step} onPrevious={previous} onNext={next} />}
            {sessionState.status === 'failed' && (
              <div className="notice error page-notice" role="alert">
                <p>{sessionState.message}</p>
                <div className="btn-row">
                  <button type="button" className="btn secondary small-btn" onClick={() => window.location.reload()}>Reload</button>
                </div>
              </div>
            )}
            {problem && <div className="notice error page-notice" role="alert"><p>{problem}</p></div>}
            {content}
          </main>
          <footer className="footer">
            <p>
              <strong>Fictional demo · synthetic data only</strong> All titles, people, figures and sources are invented. Each
              question runs a Foundry agent as you.
            </p>
          </footer>
        </div>
      </div>
      <TrustDrawer open={Boolean(drawer)} exchange={drawerExchange} mode={session?.mode} onClose={() => setDrawer(undefined)} />
      <DemoModal
        open={modal}
        mode={session?.mode}
        blocked={blocked}
        onClose={() => setModal(false)}
        onStart={() => {
          setModal(false)
          enterStep(0)
        }}
        onNext={() => {
          setModal(false)
          next()
        }}
        onPrevious={() => {
          setModal(false)
          previous()
        }}
        onAskAll={askAll}
        onClear={clear}
      />
      <Reveal open={reveal} stats={sessionIqStats(exchanges)} onClose={() => setReveal(false)} />
      <Toast toast={toast} />
    </>
  )
}

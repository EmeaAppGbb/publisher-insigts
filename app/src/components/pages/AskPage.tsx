import type { Choice } from '../../labels.ts'
import { Composer } from '../Composer.tsx'
import { ExchangeView } from '../Exchange.tsx'
import type { StoryContext } from '../AnswerPanel.tsx'

// 06 Ask: any question, of either agent or both, and every answer of the session, newest first.
export function AskPage({ story, onAsk }: { story: StoryContext; onAsk: (question: string, choice: Choice) => void }) {
  return (
    <>
      <p className="eyebrow">Ask anything</p>
      <h1 className="h2 page-title" tabIndex={-1}>Ask the agents</h1>
      <p className="lede">Your own question, of the agent with IQ, without IQ or both side by side.</p>
      <Composer blocked={story.blocked} onAsk={onAsk} />
      <section className="exchanges" aria-label="Answers">
        {story.exchanges.map((exchange) => <ExchangeView key={exchange.id} exchange={exchange} actions={story.actions} onTrust={story.trust} />)}
      </section>
    </>
  )
}

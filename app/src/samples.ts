// The questions the app asks about the fictional book portfolio, at the seeded week of 2 November 2026: the live
// BooksOntology's material signals (The Glass Orchard sells at 3.1x its forecast), that title's sales, its options
// with the approver the decision authority matrix names, its one reprint request and what became of it, an approved
// policy, public context and the user's own mail. The story pages ask them by ID and the Ask page offers them all.
// Each has an eval case in scenario/evals/cases.json and, in mock mode, a canned answer.
export type SampleId =
  | 'attention' | 'sales' | 'policy' | 'shortlists' | 'mail' | 'options' | 'reprint' | 'outcome' | 'romantasy'

export interface Sample {
  id: SampleId
  question: string
  // Shown next to a sample that needs an IQ a deployment may leave off.
  note?: string
}

export const SAMPLES: readonly Sample[] = [
  { id: 'attention', question: 'What needs my attention this week?' },
  { id: 'sales', question: 'How is The Glass Orchard selling against its forecast, and where?' },
  { id: 'policy', question: 'How much stock cover should a reprint leave, according to the reprint policy?' },
  { id: 'shortlists', question: 'What public context is there on how literary prize shortlists affect book sales?' },
  { id: 'mail', question: 'Find recent mail about The Glass Orchard', note: 'needs Work IQ' },
  { id: 'options', question: 'What are the options for The Glass Orchard, and who may approve the recommended one?' },
  { id: 'reprint', question: 'Submit an expedited reprint request for The Glass Orchard.' },
  { id: 'outcome', question: 'Which inventory risks are open or actioned, and which reprint requests are recorded?' },
  { id: 'romantasy', question: 'What public context is there on romantasy readership trends?' },
]

export function sample(id: SampleId): Sample {
  const found = SAMPLES.find((candidate) => candidate.id === id)
  if (!found) throw new Error(`No sample question ${id}`)
  return found
}

// The sample questions for the fictional book portfolio: the live BooksOntology's material signals (at the seeded
// week of 2 November 2026, The Glass Orchard sells at 3.1x its forecast) and a title's decision options with the
// approver the decision authority matrix names, an approved policy, public genre context and the user's own mail.
export interface Sample {
  question: string
  // Shown next to a sample that needs an IQ a deployment may leave off.
  note?: string
}

export const SAMPLES: readonly Sample[] = [
  { question: 'What needs my attention this week?' },
  { question: 'What are the options for The Glass Orchard, and who may approve the recommended one?' },
  { question: 'How much stock cover should a reprint leave, according to the reprint policy?' },
  { question: 'What public context is there on romantasy readership trends?' },
  { question: 'Find recent mail about The Glass Orchard', note: 'needs Work IQ' },
]

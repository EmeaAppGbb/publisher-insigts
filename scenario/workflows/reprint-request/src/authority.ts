// The decision authority matrix (BKS-GOV-003) for reprints: who approves an expedited or standard reprint, by its
// investment (§1), and the production line in which a more senior approver may approve instead (§2). Each approver
// is an app role on the reprint API registration, so the user's token carries it.

export interface Approver {
  // The app role's value in the token's roles claim.
  role: string
  // The approver as BKS-GOV-003 names them.
  name: string
}

// The production line, lowest to highest (BKS-GOV-003 §2).
export const PRODUCTION_LINE: readonly Approver[] = [
  { role: 'Reprint.ProductionPlanningManager', name: 'Production planning manager' },
  { role: 'Reprint.HeadOfProductionPlanning', name: 'Head of production planning' },
  { role: 'Reprint.PublishingDirector', name: 'Publishing director' },
  { role: 'Reprint.ManagingDirector', name: 'Managing director' },
]
const [MANAGER, HEAD, PUBLISHING_DIRECTOR, MANAGING_DIRECTOR] = PRODUCTION_LINE

// BKS-GOV-003 §1, in whole pounds of the option's investment.
export const STANDARD_MANAGER_LIMIT_GBP = 50_000
export const REPRINT_LIMIT_GBP = 150_000

export function requiredApprover(reprint: { expedited: boolean; investmentGbp: number }): Approver {
  if (reprint.investmentGbp > REPRINT_LIMIT_GBP) return MANAGING_DIRECTOR
  if (reprint.expedited) return PUBLISHING_DIRECTOR
  return reprint.investmentGbp <= STANDARD_MANAGER_LIMIT_GBP ? MANAGER : HEAD
}

// The approvers who may approve in place of the required one: those above it in the line (§2).
export function seniorTo(required: Approver): Approver[] {
  return PRODUCTION_LINE.slice(PRODUCTION_LINE.indexOf(required) + 1)
}

// The role the user approves with: the lowest role they hold at or above the required approver, if any.
export function approvingRole(roles: readonly string[], required: Approver): Approver | undefined {
  return [required, ...seniorTo(required)].find((approver) => roles.includes(approver.role))
}

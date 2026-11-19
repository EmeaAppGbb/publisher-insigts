// GET /readyz: whether the managed identity can read and append to the KQL database, from the roles it holds there
// (Database Viewer and Database Ingestor). The answer is kept for a minute, so frequent calls don't keep the
// Eventhouse awake; the container's probes use /healthz only.
import { KustoError, databaseReference, type Database } from './kusto.ts'

export type StoreRole = 'Viewer' | 'Ingestor'
export const STORE_ROLES: readonly StoreRole[] = ['Viewer', 'Ingestor']

export interface Readiness {
  ready: boolean
  roles: StoreRole[]
  // Why the store couldn't be checked, as a short code.
  code?: string
}

function failure(error: unknown): string {
  if (!(error instanceof KustoError)) return 'store_unavailable'
  if (error.code === 'database_not_found' || error.code === 'database_ambiguous' || error.code === 'token_unavailable') return error.code
  if (error.status === 401) return 'store_unauthorized'
  if (error.status === 403) return 'store_forbidden'
  return 'store_unavailable'
}

export async function checkReadiness(database: Database): Promise<Readiness> {
  try {
    const name = await database.name()
    const rows = await database.mgmt(`.show database ${databaseReference(name)} principal roles`)
    // Each role reads like "Database BookSignals Viewer": the scope, the database, then the role.
    const held = new Set(rows.map((row) => String(row.Role ?? '').trim().split(/\s+/).at(-1)?.toLowerCase()))
    const roles = STORE_ROLES.filter((role) => held.has(role.toLowerCase()))
    return { ready: roles.length === STORE_ROLES.length, roles }
  } catch (error) {
    return { ready: false, roles: [], code: failure(error) }
  }
}

export function cacheReadiness(check: () => Promise<Readiness>, ttlMs = 60_000, clock: () => number = Date.now): () => Promise<Readiness> {
  let cached: { at: number; value: Promise<Readiness> } | undefined
  return () => {
    const now = clock()
    if (!cached || now - cached.at >= ttlMs) cached = { at: now, value: check() }
    return cached.value
  }
}

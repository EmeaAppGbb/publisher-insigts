// Checks the bearer token on each MCP request before anything else is read: a Microsoft Entra access token for the
// reprint API, signed by Entra, unexpired, issued in this tenant to the OAuth client registration that Foundry's
// reprint-request connection signs users in with, with the ReprintRequest.Submit scope. Foundry sends it for the
// signed-in user (OAuth identity passthrough), so the token names the approver and carries their reprint app roles.
// Tokens are never logged or kept.
import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose'

export const SUBMIT_SCOPE = 'ReprintRequest.Submit'
const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NAME_LIMIT = 200

// The signed-in user, as the token states them.
export interface User {
  objectId: string
  // `name`, else `upn` or `unique_name`; the request record names its approver (BKS-GOV-003 §3).
  name?: string
  // The reprint API's app roles assigned to the user.
  roles: string[]
}

export type Verified = { ok: true; user: User } | { ok: false; message: string }
export type Verifier = ((authorization: string | undefined) => Promise<Verified>) & { warmUp: () => Promise<void> }

export interface VerifierOptions {
  tenantId: string
  apiClientId: string
  oauthClientId: string
  // Tests supply local keys; the server reads the tenant's published signing keys.
  keys?: JWTVerifyGetKey
  currentDate?: Date
}

const NOT_FOR_THIS_SERVER = 'This sign-in is not for the reprint request server. Connect the reprint request tool again.'

function rejected(error: unknown): string {
  if (error instanceof errors.JWTExpired) return 'Your sign-in expired. Sign in again to submit a reprint request.'
  if (error instanceof errors.JWTClaimValidationFailed) return NOT_FOR_THIS_SERVER
  if (error instanceof errors.JWKSTimeout || error instanceof errors.JOSEError && error.code === 'ERR_JWKS_NO_MATCHING_KEY') {
    return "The reprint request server could not check your sign-in against Microsoft Entra's keys. Try again."
  }
  return 'The reprint request server did not accept your sign-in. Sign in again to submit a reprint request.'
}

function claim(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, NAME_LIMIT) : undefined
}

export function createTokenVerifier(options: VerifierOptions): Verifier {
  const tenantId = options.tenantId.toLowerCase()
  const apiClientId = options.apiClientId.toLowerCase()
  const oauthClientId = options.oauthClientId.toLowerCase()
  const remote = options.keys ? undefined : createRemoteJWKSet(
    new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`),
    { cooldownDuration: 30_000, cacheMaxAge: 6 * 60 * 60 * 1000, timeoutDuration: 10_000 },
  )
  const keys: JWTVerifyGetKey = options.keys ?? remote!
  const issuer = [`https://sts.windows.net/${tenantId}/`, `https://login.microsoftonline.com/${tenantId}/v2.0`]
  // v1 tokens name the API by its application ID URI, v2 tokens by its client ID.
  const audience = [`api://${apiClientId}`, apiClientId]

  const verify = async (authorization: string | undefined): Promise<Verified> => {
    const match = BEARER.exec(authorization ?? '')
    if (!match) return { ok: false, message: 'Sign in to submit a reprint request.' }
    try {
      const { payload } = await jwtVerify(match[1], keys, {
        issuer, audience, algorithms: ['RS256'], clockTolerance: 60,
        ...(options.currentDate ? { currentDate: options.currentDate } : {}),
      })
      const client = String(payload.appid ?? payload.azp ?? '').toLowerCase()
      const scopes = String(payload.scp ?? '').split(' ')
      const objectId = String(payload.oid ?? '').toLowerCase()
      if (String(payload.tid ?? '').toLowerCase() !== tenantId || client !== oauthClientId || !scopes.includes(SUBMIT_SCOPE)
        || !GUID.test(objectId)) {
        return { ok: false, message: NOT_FOR_THIS_SERVER }
      }
      const name = claim(payload.name) ?? claim(payload.upn) ?? claim(payload.unique_name)
      const roles = Array.isArray(payload.roles) ? payload.roles.filter((role): role is string => typeof role === 'string') : []
      return { ok: true, user: { objectId, ...(name ? { name } : {}), roles } }
    } catch (error) {
      return { ok: false, message: rejected(error) }
    }
  }
  // Fetch the signing keys at startup, so the first request doesn't wait for them.
  const warmUp = async () => {
    await remote?.reload().catch(() => undefined)
  }
  return Object.assign(verify, { warmUp })
}

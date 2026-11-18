import assert from 'node:assert/strict'
import test from 'node:test'
import { SignJWT, type CryptoKey, type JWTPayload } from 'jose'
import { apiClient, director, now, oauthClient, otherKeys, tenant, token, verify } from './support.ts'

const seconds = Math.floor(now.getTime() / 1000)

test("Foundry's token for the signed-in user names the approver, their object ID and their reprint roles", async () => {
  assert.deepEqual(await verify(`Bearer ${await token()}`), {
    ok: true, user: { objectId: director, name: 'Rowan Ashdown', roles: ['Reprint.PublishingDirector'] },
  })
  // Without a name, the user principal name stands in; a user without app roles holds none.
  const v1 = await verify(`Bearer ${await token({ name: undefined, upn: 'r.ashdown@books.example', roles: undefined })}`)
  assert.deepEqual(v1, { ok: true, user: { objectId: director, name: 'r.ashdown@books.example', roles: [] } })
  const legacy = await verify(`Bearer ${await token({ name: undefined, unique_name: 'r.ashdown@books.example' })}`)
  assert.equal(legacy.ok && legacy.user.name, 'r.ashdown@books.example')
  const nameless = await verify(`Bearer ${await token({ name: undefined })}`)
  assert.deepEqual(nameless, { ok: true, user: { objectId: director, roles: ['Reprint.PublishingDirector'] } })
})

test('v1 and v2 tokens: either audience form, either issuer, appid or azp', async () => {
  const v2 = { iss: `https://login.microsoftonline.com/${tenant}/v2.0`, aud: apiClient, appid: undefined, azp: oauthClient }
  for (const [name, claims] of [
    ['v1 with the application ID URI', {}],
    ['v1 with the client ID', { aud: apiClient }],
    ['v2 with the client ID', v2],
    ['v2 with the application ID URI', { ...v2, aud: `api://${apiClient}` }],
    ['several scopes', { scp: 'ReprintRequest.Read ReprintRequest.Submit' }],
    ['upper-case identifiers', { tid: tenant.toUpperCase(), appid: oauthClient.toUpperCase(), oid: director.toUpperCase() }],
  ] as [string, JWTPayload][]) {
    const result = await verify(`Bearer ${await token(claims)}`)
    assert.equal(result.ok, true, name)
    assert.equal(result.ok && result.user.objectId, director, name)
  }
})

test('tokens for another API, client, tenant, issuer or scope, without a user, expired or unsigned by Entra, are refused', async () => {
  const cases: [string, JWTPayload, CryptoKey?][] = [
    ['another audience', { aud: 'https://ai.azure.com' }],
    ["the OAuth client's own audience", { aud: `api://${oauthClient}` }],
    ['another client', { appid: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }],
    ['another client in azp', { appid: undefined, azp: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }],
    ['no client', { appid: undefined }],
    ['another tenant', { tid: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }],
    ['another v1 issuer', { iss: 'https://sts.windows.net/dddddddd-dddd-4ddd-8ddd-dddddddddddd/' }],
    ['another v2 issuer', { iss: 'https://login.microsoftonline.com/dddddddd-dddd-4ddd-8ddd-dddddddddddd/v2.0' }],
    ['no submit scope', { scp: 'ReprintRequest.Read' }],
    ['a scope that only contains the name', { scp: 'ReprintRequest.SubmitAll' }],
    ['an app-only token', { scp: undefined, roles: ['Reprint.ManagingDirector'] }],
    ['no user', { oid: undefined }],
    ['a user that is not an object ID', { oid: 'rowan' }],
    ['expired', { exp: seconds - 3600 }],
    ['another key', {}, otherKeys.privateKey],
  ]
  for (const [name, claims, key] of cases) {
    const result = await verify(`Bearer ${await token(claims, key)}`)
    assert.equal(result.ok, false, name)
  }
  assert.deepEqual(await verify(`Bearer ${await token({ exp: seconds - 3600 })}`),
    { ok: false, message: 'Your sign-in expired. Sign in again to submit a reprint request.' })
  assert.equal((await verify(`Bearer ${await token({ nbf: seconds + 3600 })}`)).ok, false, 'not yet valid')
  const symmetric = await new SignJWT({ tid: tenant, appid: oauthClient, scp: 'ReprintRequest.Submit', oid: director })
    .setProtectedHeader({ alg: 'HS256' }).setIssuer(`https://sts.windows.net/${tenant}/`).setAudience(`api://${apiClient}`)
    .setExpirationTime(seconds + 600).sign(new TextEncoder().encode('a shared secret anyone could know'))
  assert.equal((await verify(`Bearer ${symmetric}`)).ok, false, 'HS256')
})

test('a missing or malformed header asks the user to sign in, without echoing it', async () => {
  for (const header of [undefined, '', 'Basic dXNlcjpwYXNz', 'Bearer not-a-jwt', `Bearer ${await token()} extra`, `bearer ${await token()}`]) {
    const result = await verify(header)
    assert.equal(result.ok, false, String(header).slice(0, 20))
    assert.ok(!JSON.stringify(result).includes('dXNlcjpwYXNz'))
  }
  assert.deepEqual(await verify(undefined), { ok: false, message: 'Sign in to submit a reprint request.' })
})

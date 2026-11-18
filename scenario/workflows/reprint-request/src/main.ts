// Production entry: serves the MCP endpoint on PORT. The store is reached as the server's user-assigned managed
// identity, on first use. Without a valid configuration it exits.
import { createServer } from 'node:http'
import { ManagedIdentityCredential } from '@azure/identity'
import { createTokenVerifier } from './auth.ts'
import { readServerConfig } from './config.ts'
import { createApp } from './http.ts'
import { createDatabase, createKustoClient } from './kusto.ts'
import { cacheReadiness, checkReadiness } from './readiness.ts'
import { createRequestService } from './requests.ts'
import { createShutdown } from './shutdown.ts'

const { config, problems } = readServerConfig(process.env)
if (!config) {
  console.error(JSON.stringify({ event: 'reprint.config', problems }))
  process.exit(1)
}
const verify = createTokenVerifier({ tenantId: config.tenantId, apiClientId: config.apiClientId, oauthClientId: config.oauthClientId })
const credential = new ManagedIdentityCredential({ clientId: config.managedIdentityClientId })
const kusto = createKustoClient({
  queryUri: config.kqlQueryUri,
  getToken: async (scope, abortSignal) => (await credential.getToken(scope, { abortSignal })).token,
})
const database = createDatabase(kusto, config.kqlDatabase, config.kqlDatabaseId)
const server = createServer(createApp({
  verify,
  requests: createRequestService({ database }),
  readiness: cacheReadiness(() => checkReadiness(database)),
  ...(config.version ? { version: config.version } : {}),
}))
// Longer than a tool call's few store requests, inside Azure Container Apps' 240-second request limit.
server.requestTimeout = 120_000
server.headersTimeout = 30_000
server.keepAliveTimeout = 65_000
server.listen(config.port, () => {
  console.info(JSON.stringify({ event: 'reprint.listening', port: config.port }))
  void verify.warmUp()
})
// Container Apps gives a stopping replica 30 seconds: let open requests finish for 20, then close them.
const stop = createShutdown(server, { drainMs: 20_000, exit: (code) => process.exit(code) })
process.on('SIGTERM', stop)
process.on('SIGINT', stop)

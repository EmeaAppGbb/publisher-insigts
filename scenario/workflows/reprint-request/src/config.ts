// The server's settings, from its environment (Terraform sets them on the container app). Strict, because the
// server checks each user's token for the reprint API and sends its managed identity's token to the one Fabric
// Eventhouse query URI configured here.

export interface ServerConfig {
  port: number
  tenantId: string
  // The reprint API registration, the audience of the users' tokens.
  apiClientId: string
  // The OAuth client registration Foundry's reprint-request connection signs users in with.
  oauthClientId: string
  // The Eventhouse query URI, without a trailing slash.
  kqlQueryUri: string
  // The KQL database's display name; the server resolves its Kusto database name on first use.
  kqlDatabase: string
  // The KQL database's Fabric item ID, which Fabric may use as its Kusto database name.
  kqlDatabaseId?: string
  // The server's user-assigned managed identity, which reads and appends to the KQL database.
  managedIdentityClientId: string
  version?: string
}

export type Environment = Record<string, string | undefined>

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const KQL_QUERY_URI = /^https:\/\/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.){1,4}kusto\.fabric\.microsoft\.com$/
const DISPLAY_NAME = /^[A-Za-z0-9_][A-Za-z0-9 _.-]{0,255}$/
const VERSION = /^[A-Za-z0-9._-]{1,64}$/

function guid(env: Environment, name: string, meaning: string, problems: string[]): string {
  const value = (env[name] ?? '').trim().toLowerCase()
  if (!GUID.test(value)) problems.push(`${name} must be ${meaning}.`)
  return value
}

export function readServerConfig(env: Environment): { config?: ServerConfig; problems: string[] } {
  const problems: string[] = []
  const port = Number(env.PORT ?? '8080')
  if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push('PORT must be a TCP port number.')
  const tenantId = guid(env, 'ENTRA_TENANT_ID', 'the Entra tenant GUID', problems)
  const apiClientId = guid(env, 'REPRINT_API_CLIENT_ID', "the reprint API registration's client ID", problems)
  const oauthClientId = guid(env, 'REPRINT_OAUTH_CLIENT_ID', "the reprint OAuth client registration's client ID", problems)
  const kqlQueryUri = (env.KQL_QUERY_URI ?? '').trim().toLowerCase().replace(/\/$/, '')
  if (!KQL_QUERY_URI.test(kqlQueryUri)) {
    problems.push('KQL_QUERY_URI must be the Eventhouse query URI https://<cluster>.kusto.fabric.microsoft.com.')
  }
  const kqlDatabase = (env.KQL_DATABASE ?? '').trim()
  if (!DISPLAY_NAME.test(kqlDatabase)) problems.push("KQL_DATABASE must be the KQL database's display name.")
  const kqlDatabaseId = env.KQL_DATABASE_ID?.trim() ? guid(env, 'KQL_DATABASE_ID', "the KQL database's Fabric item ID", problems) : undefined
  const managedIdentityClientId = guid(env, 'AZURE_CLIENT_ID', "the client ID of the server's managed identity", problems)
  const version = env.APP_VERSION?.trim()
  if (version && !VERSION.test(version)) problems.push('APP_VERSION must be at most 64 letters, digits, dots, hyphens or underscores.')
  if (problems.length) return { problems }
  return {
    config: {
      port, tenantId, apiClientId, oauthClientId, kqlQueryUri, kqlDatabase, managedIdentityClientId,
      ...(kqlDatabaseId ? { kqlDatabaseId } : {}),
      ...(version ? { version } : {}),
    },
    problems,
  }
}

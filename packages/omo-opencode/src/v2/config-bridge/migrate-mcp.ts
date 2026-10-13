import type { V2McpServerConfig } from "../context-types"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  return Object.fromEntries(entries)
}

function migrateOauth(oauth: unknown): Record<string, string | number> | false | undefined {
  if (oauth === false) return false
  if (!isRecord(oauth)) return undefined
  return {
    ...(typeof oauth.clientId === "string" ? { client_id: oauth.clientId } : {}),
    ...(typeof oauth.clientSecret === "string" ? { client_secret: oauth.clientSecret } : {}),
    ...(typeof oauth.scope === "string" ? { scope: oauth.scope } : {}),
    ...(typeof oauth.callbackPort === "number" ? { callback_port: oauth.callbackPort } : {}),
    ...(typeof oauth.redirectUri === "string" ? { redirect_uri: oauth.redirectUri } : {}),
  }
}

/**
 * Ported from OpenCode 2.x `ConfigMigrateV1.migrateMcp` (anomalyco/opencode v2.0.28): `enabled`
 * inverts to `disabled`, a numeric timeout fills catalog and execution, and oauth fields become
 * snake_case. `codemode: false` keeps the server's tools directly callable, as on 1.x, instead of
 * folding them behind the CodeMode `execute` tool.
 */
export function migrateMcpConfig(v1: unknown): V2McpServerConfig | undefined {
  if (!isRecord(v1)) return undefined
  const disabled = typeof v1.enabled === "boolean" ? { disabled: !v1.enabled } : {}
  const timeout = typeof v1.timeout === "number" ? { timeout: { catalog: v1.timeout, execution: v1.timeout } } : {}
  if (v1.type === "local") {
    if (!Array.isArray(v1.command) || !v1.command.every((part): part is string => typeof part === "string")) return undefined
    const environment = stringRecord(v1.environment)
    return {
      type: "local",
      command: v1.command,
      ...(typeof v1.cwd === "string" ? { cwd: v1.cwd } : {}),
      ...(environment === undefined ? {} : { environment }),
      ...disabled,
      codemode: false,
      ...timeout,
    }
  }
  if (v1.type === "remote") {
    if (typeof v1.url !== "string") return undefined
    const headers = stringRecord(v1.headers)
    const oauth = migrateOauth(v1.oauth)
    return {
      type: "remote",
      url: v1.url,
      ...(headers === undefined ? {} : { headers }),
      ...(oauth === undefined ? {} : { oauth }),
      ...disabled,
      codemode: false,
      ...timeout,
    }
  }
  return undefined
}

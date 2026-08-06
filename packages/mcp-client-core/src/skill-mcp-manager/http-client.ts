import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { log } from "../logger"
import { registerProcessCleanup, startCleanupTimer } from "./cleanup"
import { redactSensitiveData } from "./error-redaction"
import { buildHttpRequestInit } from "./oauth-handler"
import type { ManagedClient, McpClient, McpTransport, SkillMcpClientConnectionParams } from "./types"

type HttpClientFactory = (
  clientInfo: { name: string; version: string },
  options: { capabilities: Record<string, never> }
) => McpClient

type HttpTransportFactory = (
  url: URL,
  options?: { requestInit?: RequestInit }
) => McpTransport

interface HttpClientDependencies {
  createClient: HttpClientFactory
  createTransport: HttpTransportFactory
  log: typeof log
}

const defaultHttpClientDependencies: HttpClientDependencies = {
  createClient: (clientInfo, options) => new Client(clientInfo, options),
  createTransport: (url, options) => new StreamableHTTPClientTransport(url, options),
  log,
}

let httpClientDependencies: HttpClientDependencies = defaultHttpClientDependencies

export function setHttpClientDependenciesForTesting(
  dependencies?: Partial<HttpClientDependencies>
): void {
  httpClientDependencies = dependencies
    ? {
        ...defaultHttpClientDependencies,
        ...dependencies,
      }
    : defaultHttpClientDependencies
}

function redactUrl(urlStr: string): string {
  try {
    const u = new URL(urlStr)
    for (const key of u.searchParams.keys()) {
      if (
        key.toLowerCase().includes("key") ||
        key.toLowerCase().includes("token") ||
        key.toLowerCase().includes("secret")
      ) {
        u.searchParams.set(key, "***REDACTED***")
      }
    }
    return u.toString()
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
    return urlStr
  }
}

function redactCleanupErrorMessage(message: string): string {
  const sensitiveHeaderKey = "(?:authorization|x-api-key|api-key|x-auth-token|auth-token|x-access-token|access-token)"
  const messageWithRedactedAuthorization = message
    .replace(new RegExp(`("${sensitiveHeaderKey}"\\s*:\\s*")([^"]*)(")`, "gi"), "$1[REDACTED]$3")
    .replace(new RegExp(`('${sensitiveHeaderKey}'\\s*:\\s*')([^']*)(')`, "gi"), "$1[REDACTED]$3")
    .replace(
      new RegExp(`(\\b${sensitiveHeaderKey}\\s*[:=]\\s*\\\\?")((?:\\\\.|[^"\\\\])*)(\\\\?")`, "gi"),
      "$1[REDACTED]$3",
    )
    .replace(new RegExp(`(\\b${sensitiveHeaderKey}\\s*[:=]\\s*')([^']*)(')`, "gi"), "$1[REDACTED]$3")
    .replace(new RegExp(`(\\b${sensitiveHeaderKey}\\s*:\\s*)([^\\s'"\\n,;}][^\\n,;}'"]*)`, "gi"), "$1[REDACTED]")
    .replace(new RegExp(`(\\b${sensitiveHeaderKey}\\s*=\\s*)([^\\s'"\\n,;}][^\\n,;}'"]*)`, "gi"), "$1[REDACTED]")
  const messageWithRedactedSecrets = redactSensitiveData(messageWithRedactedAuthorization)
  return messageWithRedactedSecrets.replace(/https?:\/\/[^\s"'<>)}\]]+/g, (url) => redactUrl(url))
}

async function closeHttpResourceIgnoringFailure(
  close: () => Promise<void>,
  context: { resource: "client" | "transport"; serverName: string; phase: "connect-failure" | "post-shutdown" },
): Promise<void> {
  try {
    await close()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    httpClientDependencies.log("[skill-mcp-http-client] ignored cleanup failure", {
      ...context,
      error: redactCleanupErrorMessage(message),
    })
  }
}

export async function createHttpClient(params: SkillMcpClientConnectionParams): Promise<McpClient> {
  const { state, clientKey, info, config } = params
  const shutdownGenAtStart = state.shutdownGeneration

  if (!config.url) {
    throw new Error(`MCP server "${info.serverName}" is configured for HTTP but missing 'url' field.`)
  }

  let url: URL
  try {
    url = new URL(config.url)
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
    throw new Error(
      `MCP server "${info.serverName}" has invalid URL: ${redactUrl(config.url)}\n\n` +
      `Expected a valid URL like: https://mcp.example.com/mcp`
    )
  }

  registerProcessCleanup(state)

  const requestInit = await buildHttpRequestInit(config, state.authProviders, state.createOAuthProvider)
  const transportOptions = requestInit ? { requestInit } : undefined
  const transport: McpTransport = httpClientDependencies.createTransport(url, transportOptions)

  const client: McpClient = httpClientDependencies.createClient(
    { name: `skill-mcp-${info.skillName}-${info.serverName}`, version: "1.0.0" },
    { capabilities: {} }
  )

  try {
    await client.connect(transport)
  } catch (error) {
    await closeHttpResourceIgnoringFailure(() => transport.close(), {
      resource: "transport",
      serverName: info.serverName,
      phase: "connect-failure",
    })

    const errorMessage = redactCleanupErrorMessage(error instanceof Error ? error.message : String(error))
    throw new Error(
      `Failed to connect to MCP server "${info.serverName}".\n\n` +
      `URL: ${redactUrl(config.url)}\n` +
      `Reason: ${errorMessage}\n\n` +
      `Hints:\n` +
      `  - Verify the URL is correct and the server is running\n` +
      `  - Check if authentication headers are required\n` +
      `  - Ensure the server supports MCP over HTTP`
    )
  }

  if (state.shutdownGeneration !== shutdownGenAtStart) {
    await closeHttpResourceIgnoringFailure(() => client.close(), {
      resource: "client",
      serverName: info.serverName,
      phase: "post-shutdown",
    })
    await closeHttpResourceIgnoringFailure(() => transport.close(), {
      resource: "transport",
      serverName: info.serverName,
      phase: "post-shutdown",
    })
    throw new Error(`MCP server "${info.serverName}" connection completed after shutdown`)
  }

  const managedClient = {
    client,
    transport,
    skillName: info.skillName,
    lastUsedAt: Date.now(),
    connectionType: "http",
  } satisfies ManagedClient

  state.clients.set(clientKey, managedClient)
  startCleanupTimer(state)
  return client
}

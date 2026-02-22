import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { registerProcessCleanup, startCleanupTimer } from "./cleanup"
import { buildHttpRequestInit } from "./oauth-handler"
import type { ManagedClient, SkillMcpClientConnectionParams } from "./types"

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
  } catch {
    return urlStr
  }
}

export async function createHttpClient(params: SkillMcpClientConnectionParams): Promise<Client> {
  const { state, clientKey, info, config } = params

  if (!config.url) {
    throw new Error(`MCP server "${info.serverName}" is configured for HTTP but missing 'url' field.`)
  }

  let url: URL
  try {
    url = new URL(config.url)
  } catch {
    throw new Error(
      `MCP server "${info.serverName}" has invalid URL: ${redactUrl(config.url)}\n\n` +
      `Expected a valid URL like: https://mcp.example.com/mcp`
    )
  }

  registerProcessCleanup(state)

  const requestInit = await buildHttpRequestInit(config, state.authProviders)
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit,
  })

  const client = new Client(
    { name: `skill-mcp-${info.skillName}-${info.serverName}`, version: "1.0.0" },
    { capabilities: {} }
  )

  try {
    await client.connect(transport)
  } catch (error) {
    try {
      await transport.close()
    } catch {
      // Transport may already be closed
    }

    const errorMessage = error instanceof Error ? error.message : String(error)
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

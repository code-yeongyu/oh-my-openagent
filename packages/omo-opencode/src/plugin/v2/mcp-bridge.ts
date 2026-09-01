import { log } from "../../shared/logger"
import type { V2McpServerConfig } from "./types"

/**
 * MCP bridge: convert the V1 `config.mcp` map (produced by applyMcpConfig)
 * into V2 `Mcp.ServerConfig` entries via the mcp draft.
 *
 * V1 -> V2 field mapping:
 * - `{ type: "local", command: string[], environment, enabled }`
 *     -> `{ type: "local", command, environment, disabled: !enabled }`
 * - `{ type: "remote", url, headers, enabled }`
 *     -> `{ type: "remote", url, headers, disabled: !enabled }`
 * - V1 snake_case oauth fields (`client_id`, `client_secret`) are already
 *   the V2 names; `callbackPort`/`redirectUri` are renamed to
 *   `callback_port`/`redirect_uri`.
 */

export function toV2McpServerConfig(v1: Record<string, unknown>): V2McpServerConfig | null {
  const type = v1["type"]
  const enabled = v1["enabled"] !== false
  if (type === "local") {
    const command = v1["command"]
    if (!Array.isArray(command)) return null
    const config: V2McpServerConfig = {
      type: "local",
      command: command.map((part) => String(part)),
      disabled: !enabled,
    }
    if (typeof v1["cwd"] === "string") (config as Record<string, unknown>)["cwd"] = v1["cwd"]
    if (v1["environment"] && typeof v1["environment"] === "object") {
      (config as Record<string, unknown>)["environment"] = v1["environment"]
    }
    const timeout = v1["timeout"]
    if (typeof timeout === "number") {
      (config as Record<string, unknown>)["timeout"] = { execution: timeout, catalog: timeout }
    }
    return config
  }
  if (type === "remote") {
    const url = v1["url"]
    if (typeof url !== "string") return null
    const config: V2McpServerConfig = { type: "remote", url, disabled: !enabled }
    if (v1["headers"] && typeof v1["headers"] === "object") {
      (config as Record<string, unknown>)["headers"] = v1["headers"]
    }
    const oauth = v1["oauth"]
    if (oauth && typeof oauth === "object") {
      const v2Oauth: Record<string, unknown> = { ...(oauth as Record<string, unknown>) }
      if (typeof v2Oauth["callbackPort"] === "number") {
        v2Oauth["callback_port"] = v2Oauth["callbackPort"]
        delete v2Oauth["callbackPort"]
      }
      if (typeof v2Oauth["redirectUri"] === "string") {
        v2Oauth["redirect_uri"] = v2Oauth["redirectUri"]
        delete v2Oauth["redirectUri"]
      }
      ;(config as Record<string, unknown>)["oauth"] = v2Oauth
    }
    const timeout = v1["timeout"]
    if (typeof timeout === "number") {
      (config as Record<string, unknown>)["timeout"] = { execution: timeout, catalog: timeout }
    }
    return config
  }
  return null
}

export async function registerV2McpServers(args: {
  readonly ctx: { readonly mcp: { readonly transform: (callback: (draft: unknown) => void) => Promise<unknown> } }
  readonly v1Mcp: Record<string, Record<string, unknown>>
}): Promise<void> {
  const entries = Object.entries(args.v1Mcp)
  if (entries.length === 0) return
  log("[v2-mcp-bridge] registering MCP servers", { count: entries.length })
  await args.ctx.mcp.transform((draft) => {
    const d = draft as {
      set(name: string, config: V2McpServerConfig): void
    }
    for (const [name, v1] of entries) {
      const config = toV2McpServerConfig(v1)
      if (config) d.set(name, config)
    }
  })
}

import type { HostKind, HostToolDefinition, JsonObject } from "../host-contract"
import { registerTargetTool, type TargetToolDefinition, type TargetToolRegistry } from "../host-tools"
import { loadTargetMcpInventory } from "./target-mcp-config"

const parameters: JsonObject = {
  type: "object",
  properties: {},
  additionalProperties: false,
}

export function registerTargetMcpInventoryTool(options: {
  host: Exclude<HostKind, "opencode">
  registry: TargetToolRegistry
  cwd: string
}): TargetToolDefinition {
  const tool: HostToolDefinition<JsonObject> = {
    name: "mcp_servers",
    label: "MCP Servers",
    description: "List built-in and Claude-compatible MCP server configurations available to this target.",
    parameters,
    execute: async () => {
      const inventory = loadTargetMcpInventory({ cwd: options.cwd })
      const rows = Object.entries(inventory.servers).map(([name, config]) => ({
        name,
        source: inventory.sources[name],
        type: config.type,
        enabled: config.enabled !== false,
      }))
      return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] }
    },
  }

  return registerTargetTool(options.registry, tool, {
    host: options.host,
    parameters: { kind: "json-schema", schema: parameters },
    createSessionContext: () => ({
      id: "target-session",
      cwd: options.cwd,
      actions: {
        sendUserMessage: async () => {},
        sendInternalMessage: async () => {},
        appendEntry: async () => {},
        getSessionName: () => undefined,
        setSessionName: async () => {},
        getContextUsage: () => undefined,
        compact: async () => {},
        abort: () => {},
        isIdle: () => true,
        hasPendingMessages: () => false,
      },
    }),
  })
}

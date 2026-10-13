import type { V2McpServerConfig, V2PermissionRule } from "../context-types"
import { migrateMcpConfig } from "./migrate-mcp"
import { migrateAgentConfig, migratePermissionConfig, type V2AgentPatch } from "./migrate-agent"

/** What the 1.x config hook asked for, in 2.x terms. Plain data, so two results compare by JSON. */
export type DesiredConfig = {
  readonly agents: ReadonlyArray<readonly [string, V2AgentPatch]>
  readonly globalPermissions: ReadonlyArray<V2PermissionRule>
  readonly mcp: ReadonlyArray<readonly [string, V2McpServerConfig]>
  /** MCP entries 2.x cannot represent; the bridge warns about them. */
  readonly skippedMcp: ReadonlyArray<string>
  readonly defaultAgent?: string
}

export const EMPTY_DESIRED_CONFIG: DesiredConfig = { agents: [], globalPermissions: [], mcp: [], skippedMcp: [] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function readDesiredConfig(config: Readonly<Record<string, unknown>>): DesiredConfig {
  const agents = isRecord(config.agent)
    ? Object.entries(config.agent).flatMap(([id, entry]): Array<readonly [string, V2AgentPatch]> =>
        isRecord(entry) ? [[id, migrateAgentConfig(entry)]] : [],
      )
    : []
  const mcp: Array<readonly [string, V2McpServerConfig]> = []
  const skippedMcp: string[] = []
  if (isRecord(config.mcp)) {
    for (const [name, entry] of Object.entries(config.mcp)) {
      const migrated = migrateMcpConfig(entry)
      if (migrated === undefined) skippedMcp.push(name)
      else mcp.push([name, migrated])
    }
  }
  return {
    agents,
    globalPermissions: migratePermissionConfig(config.tools, config.permission),
    mcp,
    skippedMcp,
    ...(typeof config.default_agent === "string" ? { defaultAgent: config.default_agent } : {}),
  }
}

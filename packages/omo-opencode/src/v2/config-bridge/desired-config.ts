import type { V2McpServerConfig, V2PermissionRule } from "../context-types"
import type { CommandSpec } from "./create-command-executor"
import { migrateMcpConfig } from "./migrate-mcp"
import { migrateAgentConfig, migratePermissionConfig, type V2AgentPatch } from "./migrate-agent"

/** What the 1.x config hook asked for, in 2.x terms. Plain data, so two results compare by JSON. */
export type DesiredConfig = {
  readonly agents: ReadonlyArray<readonly [string, V2AgentPatch]>
  readonly globalPermissions: ReadonlyArray<V2PermissionRule>
  readonly mcp: ReadonlyArray<readonly [string, V2McpServerConfig]>
  /** MCP entries 2.x cannot represent; the bridge warns about them. */
  readonly skippedMcp: ReadonlyArray<string>
  readonly commands: ReadonlyArray<readonly [string, CommandSpec]>
  /** Command entries without a usable template; the bridge warns about them. */
  readonly skippedCommands: ReadonlyArray<string>
  readonly defaultAgent?: string
}

export const EMPTY_DESIRED_CONFIG: DesiredConfig = { agents: [], globalPermissions: [], mcp: [], skippedMcp: [], commands: [], skippedCommands: [] }

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
  const commands: Array<readonly [string, CommandSpec]> = []
  const skippedCommands: string[] = []
  if (isRecord(config.command)) {
    for (const [name, entry] of Object.entries(config.command)) {
      if (!isRecord(entry) || typeof entry.template !== "string") {
        skippedCommands.push(name)
        continue
      }
      commands.push([
        name,
        {
          template: entry.template,
          ...(typeof entry.description === "string" ? { description: entry.description } : {}),
          ...(typeof entry.agent === "string" ? { agent: entry.agent } : {}),
          ...(typeof entry.model === "string" ? { model: entry.model } : {}),
        },
      ])
    }
  }
  return {
    agents,
    globalPermissions: migratePermissionConfig(config.tools, config.permission),
    mcp,
    skippedMcp,
    commands,
    skippedCommands,
    ...(typeof config.default_agent === "string" ? { defaultAgent: config.default_agent } : {}),
  }
}

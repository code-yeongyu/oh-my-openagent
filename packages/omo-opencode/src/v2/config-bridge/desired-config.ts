import type { V2PermissionRule } from "../context-types"
import { migrateAgentConfig, migratePermissionConfig, type V2AgentPatch } from "./migrate-agent"

/** What the 1.x config hook asked for, in 2.x terms. Plain data, so two results compare by JSON. */
export type DesiredConfig = {
  readonly agents: ReadonlyArray<readonly [string, V2AgentPatch]>
  readonly globalPermissions: ReadonlyArray<V2PermissionRule>
  readonly defaultAgent?: string
}

export const EMPTY_DESIRED_CONFIG: DesiredConfig = { agents: [], globalPermissions: [] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function readDesiredConfig(config: Readonly<Record<string, unknown>>): DesiredConfig {
  const agents = isRecord(config.agent)
    ? Object.entries(config.agent).flatMap(([id, entry]): Array<readonly [string, V2AgentPatch]> =>
        isRecord(entry) ? [[id, migrateAgentConfig(entry)]] : [],
      )
    : []
  return {
    agents,
    globalPermissions: migratePermissionConfig(config.tools, config.permission),
    ...(typeof config.default_agent === "string" ? { defaultAgent: config.default_agent } : {}),
  }
}

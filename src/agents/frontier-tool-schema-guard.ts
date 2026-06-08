import type { AgentConfig } from "@opencode-ai/sdk"
import { isGpt5_5Model } from "./types"
import type { PermissionValue } from "../shared/permission-compat"

const FRONTIER_TOOL_SCHEMA_NAMES = ["grep", "glob"] as const
type MutablePermission = Record<string, PermissionValue | Record<string, PermissionValue>>

function isOpus47Model(model: string): boolean {
  const modelName = model.includes("/") ? (model.split("/").pop() ?? model) : model
  const normalizedModelName = modelName.toLowerCase().replaceAll(".", "-")
  return normalizedModelName.includes("claude-opus-4-7")
}

export function getFrontierToolSchemaPermission(model: string): Record<string, "deny"> {
  return isOpus47Model(model) || isGpt5_5Model(model)
    ? { grep: "deny" as const, glob: "deny" as const }
    : {}
}

export function applyFrontierToolSchemaPermission(
  permission: AgentConfig["permission"] | undefined,
  model: string,
  explicitPermission?: AgentConfig["permission"],
  explicitTools?: Record<string, boolean>
): AgentConfig["permission"] | undefined {
  if (!permission) return permission

  const nextPermission: MutablePermission = { ...permission }
  const explicitPermissionMap = explicitPermission as MutablePermission | undefined
  const frontierDeny = getFrontierToolSchemaPermission(model)
  if (Object.keys(frontierDeny).length > 0) {
    Object.assign(nextPermission, frontierDeny)
    return nextPermission as AgentConfig["permission"]
  }

  for (const toolName of FRONTIER_TOOL_SCHEMA_NAMES) {
    if (explicitPermissionMap?.[toolName] === "deny") continue
    if (explicitTools?.[toolName] === false) continue
    delete nextPermission[toolName]
  }
  return nextPermission as AgentConfig["permission"]
}

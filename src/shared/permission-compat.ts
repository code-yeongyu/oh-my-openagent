import { supportsNewPermissionSystem as checkNewPermissionSystem } from "./opencode-version"

export type PermissionValue = "ask" | "allow" | "deny"
export type BashPermission = PermissionValue | Record<string, PermissionValue>

export interface StandardPermission {
  edit?: PermissionValue
  bash?: BashPermission
  webfetch?: PermissionValue
  doom_loop?: PermissionValue
  external_directory?: PermissionValue
}

export interface ToolsConfig {
  [toolName: string]: boolean
}

export interface AgentPermissionConfig {
  permission?: StandardPermission
  tools?: ToolsConfig
}

export { checkNewPermissionSystem as supportsNewPermissionSystemFromCompat }

export function createToolDenyList(toolNames: string[]): ToolsConfig {
  return Object.fromEntries(toolNames.map((name) => [name, false]))
}

export function permissionValueToBoolean(value: PermissionValue): boolean {
  return value === "allow"
}

export function booleanToPermissionValue(value: boolean): PermissionValue {
  return value ? "allow" : "deny"
}

export function convertToolsToPermission(
  tools: ToolsConfig
): Record<string, PermissionValue> {
  return Object.fromEntries(
    Object.entries(tools).map(([key, value]) => [
      key,
      booleanToPermissionValue(value),
    ])
  )
}

export function convertPermissionToTools(
  permission: Record<string, PermissionValue>
): ToolsConfig {
  return Object.fromEntries(
    Object.entries(permission)
      .filter(([, value]) => value !== "ask")
      .map(([key, value]) => [key, permissionValueToBoolean(value)])
  )
}

export function createAgentRestrictions(config: {
  denyTools?: string[]
  permission?: StandardPermission
}): AgentPermissionConfig {
  const result: AgentPermissionConfig = {}

  if (config.denyTools && config.denyTools.length > 0) {
    result.tools = createToolDenyList(config.denyTools)
  }

  if (config.permission) {
    result.permission = config.permission
  }

  return result
}

import { supportsNewPermissionSystem } from "./opencode-version"

export { supportsNewPermissionSystem }

export type PermissionValue = "ask" | "allow" | "deny"

export interface LegacyToolsFormat {
  tools: Record<string, boolean>
}

export interface NewPermissionFormat {
  permission: Record<string, PermissionValue>
}

export type VersionAwareRestrictions = LegacyToolsFormat | NewPermissionFormat

export function createAgentToolRestrictions(
  denyTools: string[]
): VersionAwareRestrictions {
  if (supportsNewPermissionSystem()) {
    return {
      permission: Object.fromEntries(
        denyTools.map((tool) => [tool, "deny" as const])
      ),
    }
  }

  return {
    tools: Object.fromEntries(denyTools.map((tool) => [tool, false])),
  }
}

/**
 * Common tools that should be denied when using allowlist approach.
 * Used for legacy fallback when `*: deny` pattern is not supported.
 */
const COMMON_TOOLS_TO_DENY = [
  "write",
  "edit",
  "bash",
  "task",
  "sisyphus_task",
  "call_omo_agent",
  "webfetch",
  "glob",
  "grep",
  "lsp_diagnostics",
  "lsp_prepare_rename",
  "lsp_rename",
  "ast_grep_search",
  "ast_grep_replace",
  "session_list",
  "session_read",
  "session_search",
  "session_info",
  "background_output",
  "background_cancel",
  "skill",
  "skill_mcp",
  "look_at",
  "todowrite",
  "todoread",
  "interactive_bash",
] as const

/**
 * Creates tool restrictions that ONLY allow specified tools.
 * All other tools are denied by default.
 *
 * Uses `*: deny` pattern for new permission system,
 * falls back to explicit deny list for legacy systems.
 */
export function createAgentToolAllowlist(
  allowTools: string[]
): VersionAwareRestrictions {
  if (supportsNewPermissionSystem()) {
    return {
      permission: {
        "*": "deny" as const,
        ...Object.fromEntries(
          allowTools.map((tool) => [tool, "allow" as const])
        ),
      },
    }
  }

  // Legacy fallback: explicitly deny common tools except allowed ones
  const allowSet = new Set(allowTools)
  const denyTools = COMMON_TOOLS_TO_DENY.filter((tool) => !allowSet.has(tool))

  return {
    tools: Object.fromEntries(denyTools.map((tool) => [tool, false])),
  }
}

export function migrateToolsToPermission(
  tools: Record<string, boolean>
): Record<string, PermissionValue> {
  return Object.fromEntries(
    Object.entries(tools).map(([key, value]) => [
      key,
      value ? ("allow" as const) : ("deny" as const),
    ])
  )
}

export function migratePermissionToTools(
  permission: Record<string, PermissionValue>
): Record<string, boolean> {
  return Object.fromEntries(
    Object.entries(permission)
      .filter(([, value]) => value !== "ask")
      .map(([key, value]) => [key, value === "allow"])
  )
}

export function migrateAgentConfig(
  config: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...config }

  if (supportsNewPermissionSystem()) {
    if (result.tools && typeof result.tools === "object") {
      const existingPermission =
        (result.permission as Record<string, PermissionValue>) || {}
      const migratedPermission = migrateToolsToPermission(
        result.tools as Record<string, boolean>
      )
      result.permission = { ...migratedPermission, ...existingPermission }
      delete result.tools
    }
  } else {
    if (result.permission && typeof result.permission === "object") {
      const existingTools = (result.tools as Record<string, boolean>) || {}
      const migratedTools = migratePermissionToTools(
        result.permission as Record<string, PermissionValue>
      )
      result.tools = { ...migratedTools, ...existingTools }
      delete result.permission
    }
  }

  return result
}

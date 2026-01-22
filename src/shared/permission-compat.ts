/**
 * Permission system utilities for OpenCode 1.1.1+.
 * This module only supports the new permission format.
 */

export type PermissionValue = "ask" | "allow" | "deny"

export interface PermissionFormat {
  permission: Record<string, PermissionValue>
}

/**
 * Creates tool restrictions that deny specified tools.
 */
export function createAgentToolRestrictions(
  denyTools: string[]
): PermissionFormat {
  return {
    permission: Object.fromEntries(
      denyTools.map((tool) => [tool, "deny" as const])
    ),
  }
}

/**
 * Creates tool restrictions that ONLY allow specified tools.
 * All other tools are denied by default using `*: deny` pattern.
 */
export function createAgentToolAllowlist(
  allowTools: string[]
): PermissionFormat {
  return {
    permission: {
      "*": "deny" as const,
      ...Object.fromEntries(
        allowTools.map((tool) => [tool, "allow" as const])
      ),
    },
  }
}

/**
 * Converts legacy tools format to permission format.
 * For migrating user configs from older versions.
 */
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

/**
 * Migrates agent config from legacy tools format to permission format.
 * If config has `tools`, converts to `permission`.
 */
export function migrateAgentConfig(
  config: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...config }

  if (result.tools && typeof result.tools === "object") {
    const existingPermission =
      (result.permission as Record<string, PermissionValue>) || {}
    const migratedPermission = migrateToolsToPermission(
      result.tools as Record<string, boolean>
    )
    result.permission = { ...migratedPermission, ...existingPermission }
    delete result.tools
  }

  return result
}

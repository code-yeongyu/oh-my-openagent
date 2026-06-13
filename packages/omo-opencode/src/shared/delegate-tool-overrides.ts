import { migrateToolsToPermission } from "./permission-compat"
import type { SessionPermissionRule } from "./question-denied-session-permission"

export type DelegateToolOverrides = Record<string, boolean>

export function mergeDelegatePromptTools(input: {
  readonly defaults: Record<string, boolean>
  readonly configuredTools?: DelegateToolOverrides
  readonly hardRestrictions?: Record<string, boolean>
}): Record<string, boolean> {
  return {
    ...input.defaults,
    ...(input.configuredTools ?? {}),
    question: false,
    ...(input.hardRestrictions ?? {}),
  }
}

export function buildDelegateSessionPermission(
  configuredTools?: DelegateToolOverrides,
  hardRestrictions?: Record<string, boolean>,
): SessionPermissionRule[] {
  const promptTools = mergeDelegatePromptTools({
    defaults: {},
    configuredTools,
    hardRestrictions,
  })
  const permission = migrateToolsToPermission(promptTools)

  const rules: SessionPermissionRule[] = []
  for (const [toolName, action] of Object.entries(permission)) {
    if (action === "allow" || action === "deny") {
      rules.push({ permission: toolName, action, pattern: "*" })
    }
  }
  return rules
}

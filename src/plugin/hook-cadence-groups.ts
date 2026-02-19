import type { HookName } from "../config"

export type CadenceGroup = "tool_guidance" | "context_injection" | "reminders" | "continuation" | "error_recovery"

/**
 * Maps each cadence group to the hook names it controls.
 * 
 * Only 13 of 45 hooks are cadence-gatable. The remaining 32 are either:
 * - Zero token cost (toasts, events, notifications)
 * - Reactive safety hooks (only fire on errors, must not be skipped)
 * - Transform/infrastructure (breaking if skipped)
 * - State-critical (needed at exact moments)
 */
export const CADENCE_GROUPS: Record<CadenceGroup, HookName[]> = {
  tool_guidance: [
    "agent-usage-reminder",      // teaches agent delegation patterns
    "category-skill-reminder",   // reminds about available skills
    "atlas",                     // delegation guidance for orchestrators
  ],
  context_injection: [
    "rules-injector",            // project .rules files (~medium tokens)
    "directory-agents-injector", // directory-level agent configs
    "directory-readme-injector", // README content injection
    "start-work",                // boulder state + plan context (~heavy)
  ],
  reminders: [
    "sisyphus-junior-notepad",   // notepad directive for Atlas workers
    "anthropic-effort",          // effort=max param injection
  ],
  continuation: [
    // Note: todo-continuation-enforcer has a complex type with additional methods,
    // so it cannot be wrapped. It will always fire (cadence=1).
  ],
  error_recovery: [
    "edit-error-recovery",                      // edit failure recovery guidance
    "json-error-recovery",                      // JSON parse error recovery
    "delegate-task-retry",                      // task delegation failure retry
    // Note: session-recovery has a complex type with additional methods,
    // so it cannot be wrapped. It will always fire (cadence=1).
    "anthropic-context-window-limit-recovery",  // token limit compaction trigger
  ],
}

/** Default cadence values per group */
export const CADENCE_DEFAULTS: Record<CadenceGroup, number> = {
  tool_guidance: 2,
  context_injection: 3,
  reminders: 3,
  continuation: 2,
  error_recovery: 1,
}

/**
 * Resolve the cadence value for a specific hook name.
 * Returns the group's configured cadence, or the group default, or 1 if not in any group.
 */
export function resolveHookCadence(
  hookName: HookName,
  config?: Partial<Record<CadenceGroup, number>>
): number {
  for (const [group, hooks] of Object.entries(CADENCE_GROUPS)) {
    if (hooks.includes(hookName)) {
      const groupKey = group as CadenceGroup
      return config?.[groupKey] ?? CADENCE_DEFAULTS[groupKey]
    }
  }
  // Hook not in any group = always fire
  return 1
}

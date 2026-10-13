import type { V2ModelRef, V2PermissionRule } from "../context-types"

/** What to change on a 2.x agent, derived from a 1.x agent config entry. */
export type V2AgentPatch = {
  readonly remove: boolean
  readonly model?: V2ModelRef
  readonly system?: string
  readonly description?: string
  readonly mode?: "subagent" | "primary" | "all"
  readonly hidden?: boolean
  readonly color?: string
  readonly steps?: number
  readonly requestBody: Record<string, unknown>
  readonly permissions: V2PermissionRule[]
}

const KNOWN_KEYS: ReadonlySet<string> = new Set([
  "name", "model", "variant", "temperature", "top_p", "prompt", "tools", "disable", "description",
  "mode", "hidden", "options", "color", "steps", "maxSteps", "permission",
])

type Effect = V2PermissionRule["effect"]
type PermissionValue = Effect | Readonly<Record<string, Effect>>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Ported from OpenCode 2.x `ConfigMigrateV1.normalizeAction`: 1.x tool names to their 2.x actions. */
export function normalizeAction(action: string): string {
  if (action === "write" || action === "patch") return "edit"
  if (action === "task") return "subagent"
  if (action === "bash") return "shell"
  return action
}

function parseModel(model: unknown, variant: unknown): V2ModelRef | undefined {
  if (typeof model !== "string" || !/^[^/#]+\/[^#]+$/.test(model)) return undefined
  const separator = model.indexOf("/")
  const useVariant = typeof variant === "string" && variant.length > 0 && !variant.includes("#")
  return {
    providerID: model.slice(0, separator),
    id: model.slice(separator + 1),
    ...(useVariant ? { variant } : {}),
  }
}

/**
 * Mirrors 2.x `ConfigAgentV1` normalization: `tools` entries become allow/deny rules (write and patch
 * are edit), `permission` entries override by key while keeping the key's first position, and a bare
 * string permission applies to every action.
 */
export function migratePermissionConfig(tools: unknown, permission: unknown): V2PermissionRule[] {
  const byKey = new Map<string, PermissionValue>()
  if (isRecord(tools)) {
    for (const [tool, enabled] of Object.entries(tools)) {
      byKey.set(tool === "write" || tool === "patch" ? "edit" : tool, enabled === true ? "allow" : "deny")
    }
  }
  const entries: Array<[string, unknown]> =
    typeof permission === "string" ? [["*", permission]] : isRecord(permission) ? Object.entries(permission) : []
  for (const [key, rule] of entries) byKey.set(key, rule as PermissionValue)

  const rules: V2PermissionRule[] = []
  for (const [key, rule] of byKey) {
    const action = normalizeAction(key)
    if (typeof rule === "string") rules.push({ action, resource: "*", effect: rule })
    else for (const [resource, effect] of Object.entries(rule)) rules.push({ action, resource, effect })
  }
  return rules
}

export function migrateAgentConfig(v1: Readonly<Record<string, unknown>>): V2AgentPatch {
  const extra: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(v1)) if (!KNOWN_KEYS.has(key)) extra[key] = value
  const requestBody: Record<string, unknown> = {
    ...(isRecord(v1.options) ? v1.options : {}),
    ...extra,
    ...(typeof v1.temperature === "number" ? { temperature: v1.temperature } : {}),
    ...(typeof v1.top_p === "number" ? { top_p: v1.top_p } : {}),
  }
  const steps = typeof v1.steps === "number" ? v1.steps : typeof v1.maxSteps === "number" ? v1.maxSteps : undefined
  const model = parseModel(v1.model, v1.variant)
  return {
    remove: v1.disable === true,
    ...(model === undefined ? {} : { model }),
    ...(typeof v1.prompt === "string" ? { system: v1.prompt } : {}),
    ...(typeof v1.description === "string" ? { description: v1.description } : {}),
    ...(v1.mode === "subagent" || v1.mode === "primary" || v1.mode === "all" ? { mode: v1.mode } : {}),
    ...(typeof v1.hidden === "boolean" ? { hidden: v1.hidden } : {}),
    ...(typeof v1.color === "string" ? { color: v1.color.startsWith("#") ? v1.color : "#aaaaaa" } : {}),
    ...(steps === undefined ? {} : { steps }),
    requestBody,
    permissions: migratePermissionConfig(v1.tools, v1.permission),
  }
}

import { getAgentConfigKey } from "../../shared/agent-display-names"
import { DEFAULT_CATEGORIES } from "./constants"
import { SISYPHUS_JUNIOR_AGENT } from "./sisyphus-junior-agent"
import { sanitizeSubagentType } from "./subagent-discovery"

/**
 * Built-in agents that @-mentions and `subagent_type` invoke directly.
 * These must never be paired with `category` when calling OpenCode task().
 */
const NAMED_SUBAGENT_KEYS = new Set([
  "explore",
  "librarian",
  "oracle",
  "metis",
  "momus",
  "multimodal-looker",
  "hephaestus",
  "plan",
])

export type ExclusiveTaskTarget = {
  category?: string
  subagent_type?: string
}

function nonemptyString(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed === "" ? undefined : trimmed
}

export function isNamedSubagentTarget(value: string | undefined): boolean {
  const raw = nonemptyString(value)
  if (!raw) return false
  const key = getAgentConfigKey(sanitizeSubagentType(raw))
  return NAMED_SUBAGENT_KEYS.has(key)
}

export function isKnownTaskCategory(value: string | undefined): boolean {
  const raw = nonemptyString(value)
  if (!raw) return false
  return Object.prototype.hasOwnProperty.call(DEFAULT_CATEGORIES, raw)
}

/**
 * OpenCode task() accepts category XOR subagent_type.
 * @explore / other named-agent mentions must emit only subagent_type (#7920).
 * Real categories still win over a conflicting subagent_type (issue #3624).
 */
export function normalizeExclusiveTaskTarget(input: ExclusiveTaskTarget): ExclusiveTaskTarget {
  const category = nonemptyString(input.category)
  const subagentType = nonemptyString(input.subagent_type)

  if (isNamedSubagentTarget(subagentType) && !isKnownTaskCategory(category)) {
    return { subagent_type: sanitizeSubagentType(subagentType!) }
  }

  if (isNamedSubagentTarget(category)) {
    return { subagent_type: sanitizeSubagentType(category!) }
  }

  if (category) {
    return { category, subagent_type: SISYPHUS_JUNIOR_AGENT }
  }

  if (subagentType) {
    return { subagent_type: subagentType }
  }

  return {}
}

export function applyExclusiveTaskTarget(
  args: Record<string, unknown>,
  target: ExclusiveTaskTarget,
): Record<string, unknown> {
  const next = { ...args }
  if (target.category === undefined) {
    delete next.category
  } else {
    next.category = target.category
  }
  if (target.subagent_type === undefined) {
    delete next.subagent_type
  } else {
    next.subagent_type = target.subagent_type
  }
  return next
}

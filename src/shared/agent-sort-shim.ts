/**
 * Agent sort scoped helper.
 *
 * OpenCode 1.4.x ignores the agent `order` field (sst/opencode#19127) and
 * sorts the agent list by `agent.name` via Remeda `sortBy(x => x.name, "asc")`
 * at packages/opencode/src/agent/agent.ts. Earlier OMO versions (v4.1.0+)
 * attempted to override that ordering with a global `Array.prototype.sort`
 * and `Array.prototype.toSorted` monkey-patch. That global patch caused TUI
 * rendering anomalies (issue #3998): any third-party array whose elements
 * happened to expose a `.name` matching a core agent display name was
 * silently re-ordered, producing first-character truncation and similar
 * visual regressions reminiscent of the original ZWSP bug.
 *
 * This module no longer mutates `Array.prototype`. The exported
 * `installAgentSortShim` is kept as a no-op so call sites and mocked tests
 * remain stable, and `sortAgentList` is provided as an OPT-IN scoped helper
 * for callers that own the array they want sorted. Without prototype
 * interception OpenCode's internal `Agent.list()` falls back to its native
 * alphabetical ordering for the TUI tab bar; the plugin's
 * `reorderAgentsByPriority` continues to control the order of agent config
 * keys emitted to OpenCode.
 *
 * Remove the remaining helpers once OpenCode honors the agent `order` field
 * (sst/opencode#19127).
 */

import { DEFAULT_AGENT_ORDER, resolveAgentOrderDisplayNames } from "./agent-ordering"
import { getAgentListDisplayName } from "./agent-display-names"

let agentRank: ReadonlyMap<string, number> = createAgentRank(undefined)
const AGENT_ARRAY_SENTINELS = new Set(
  DEFAULT_AGENT_ORDER.map((configKey) => getAgentListDisplayName(configKey)),
)

const UNRANKED = Number.MAX_SAFE_INTEGER

function extractAgentName(value: unknown): string {
  if (value === null || typeof value !== "object") return ""
  const candidate = value as { name?: unknown }
  return typeof candidate.name === "string" ? candidate.name : ""
}

function isAgentArray(arr: ReadonlyArray<unknown>): boolean {
  if (arr.length < 2) return false

  let rankedCount = 0
  for (const element of arr) {
    if (element === null || typeof element !== "object") return false
    const name = (element as { name?: unknown }).name
    if (typeof name !== "string") return false
    if (AGENT_ARRAY_SENTINELS.has(name)) rankedCount++
  }

  return rankedCount >= 2
}

function agentComparator(
  a: unknown,
  b: unknown,
  fallback: ((a: unknown, b: unknown) => number) | undefined,
): number {
  const aRank = agentRank.get(extractAgentName(a)) ?? UNRANKED
  const bRank = agentRank.get(extractAgentName(b)) ?? UNRANKED

  if (aRank !== bRank) return aRank - bRank
  if (fallback) return fallback(a, b)
  return 0
}

function createAgentRank(agentOrder: readonly string[] | undefined): ReadonlyMap<string, number> {
  return new Map(
    resolveAgentOrderDisplayNames(agentOrder).map(
      (displayName, index): [string, number] => [displayName, index + 1],
    ),
  )
}

export function setAgentSortOrder(agentOrder: readonly string[] | undefined): void {
  agentRank = createAgentRank(agentOrder)
}

export function setDefaultAgentForSort(agentName: string | undefined): void {
  if (!agentName) return
  if (agentRank.get(agentName) === 0) return
  const updated = new Map<string, number>()
  updated.set(agentName, 0)
  for (const [key, rank] of agentRank) {
    if (key !== agentName) updated.set(key, rank + 1)
  }
  agentRank = updated
}

/**
 * Sort an agent list array using the active agent rank in a scoped, opt-in
 * way. Returns a new array; the input is not mutated.
 *
 * Callers MUST own the array they pass in. This helper never touches
 * `Array.prototype` and has no global side effects.
 */
export function sortAgentList<T>(
  arr: ReadonlyArray<T>,
  compareFn?: (a: T, b: T) => number,
): T[] {
  if (!isAgentArray(arr)) {
    return compareFn ? [...arr].sort(compareFn) : [...arr].sort()
  }
  const fallback = compareFn
    ? (a: unknown, b: unknown): number => compareFn(a as T, b as T)
    : undefined
  return [...arr].sort((a, b) => agentComparator(a, b, fallback))
}

/**
 * Backwards-compatible no-op kept so existing call sites and mocked tests
 * keep compiling. The plugin no longer mutates `Array.prototype`; see the
 * module header and issue #3998 for the rationale.
 */
export function installAgentSortShim(): void {
  // intentionally empty — prototype interception was removed in fix for #3998
}

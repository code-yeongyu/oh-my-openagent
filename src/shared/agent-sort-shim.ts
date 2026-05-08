/**
 * Agent sort shim.
 *
 * OpenCode 1.4.x ignores the agent `order` field (sst/opencode#19127) and
 * sorts the agent list by `agent.name` via Remeda `sortBy(x => x.name, "asc")`
 * at packages/opencode/src/agent/agent.ts. Without intervention, core agents
 * collapse into name order, which can invert the default sisyphus -> hephaestus
 * -> prometheus -> atlas order or a user's configured `agent_order`.
 *
 * Earlier attempts to bias the sort key with invisible characters (ZWSP,
 * U+2060 WORD JOINER, U+00AD SOFT HYPHEN, ANSI escape) caused visible-gap
 * and column-truncation regressions in the TUI status bar (#3259, #3238).
 *
 * This shim is the narrowly-scoped alternative from PR #3267 with the Cubic
 * P1 mitigations applied:
 *   1. `isAgentArray` rejects any array element that is null, non-object, or
 *      lacks a string `name`, eliminating the throw-on-mixed-array failure
 *      mode that closed the original PR.
 *   2. The activation predicate requires >= 2 elements whose `.name` is ranked
 *      by the active agent order, so unrelated `.sort()` and `.toSorted()` calls
 *      (string arrays, number arrays, generic objects) execute native behavior
 *      unchanged.
 *
 * Remove this shim once OpenCode honors the agent `order` field
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

let installed = false

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

export function installAgentSortShim(): void {
  if (installed) return

  const originalToSorted = Array.prototype.toSorted
  const originalSort = Array.prototype.sort

  function patchedToSorted(
    this: unknown[],
    compareFn?: (a: unknown, b: unknown) => number,
  ): unknown[] {
    if (isAgentArray(this)) {
      return originalToSorted.call(this, (a, b) => agentComparator(a, b, compareFn))
    }
    return originalToSorted.call(this, compareFn)
  }

  function patchedSort(
    this: unknown[],
    compareFn?: (a: unknown, b: unknown) => number,
  ): unknown[] {
    if (isAgentArray(this)) {
      return originalSort.call(this, (a, b) => agentComparator(a, b, compareFn))
    }
    return originalSort.call(this, compareFn)
  }

  Object.defineProperty(Array.prototype, "toSorted", {
    value: patchedToSorted,
    configurable: true,
    writable: true,
    enumerable: false,
  })

  Object.defineProperty(Array.prototype, "sort", {
    value: patchedSort,
    configurable: true,
    writable: true,
    enumerable: false,
  })

  installed = true
}

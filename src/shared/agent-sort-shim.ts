/**
 * Agent sort shim.
 *
 * OpenCode 1.4.x ignores the agent `order` field (sst/opencode#19127) and
 * sorts the agent list by `agent.name` via Remeda `sortBy(x => x.name, "asc")`
 * at packages/opencode/src/agent/agent.ts. Without intervention, the four
 * core agents collapse into Atlas -> Hephaestus -> Prometheus -> Sisyphus,
 * which inverts the canonical sisyphus -> hephaestus -> prometheus -> atlas
 * order this project ships.
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
 *   2. The activation predicate requires >= 2 elements whose `.name` is one
 *      of the four canonical core display names, so unrelated `.sort()` and
 *      `.toSorted()` calls (string arrays, number arrays, generic objects)
 *      execute native behavior unchanged.
 *
 * Remove this shim once OpenCode honors the agent `order` field
 * (sst/opencode#19127).
 */

import { CANONICAL_CORE_AGENT_ORDER } from "../plugin-handlers/agent-priority-order"
import { AGENT_DISPLAY_NAMES } from "./agent-display-names"

const AGENT_RANK: ReadonlyMap<string, number> = new Map(
  CANONICAL_CORE_AGENT_ORDER.map(
    (configKey, index): [string, number] => [AGENT_DISPLAY_NAMES[configKey], index + 1],
  ),
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
    if (AGENT_RANK.has(name)) rankedCount++
  }

  return rankedCount >= 2
}

function agentComparator(
  a: unknown,
  b: unknown,
  fallback: ((a: unknown, b: unknown) => number) | undefined,
): number {
  const aRank = AGENT_RANK.get(extractAgentName(a)) ?? UNRANKED
  const bRank = AGENT_RANK.get(extractAgentName(b)) ?? UNRANKED

  if (aRank !== bRank) return aRank - bRank
  if (fallback) return fallback(a, b)
  return 0
}

let installed = false

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

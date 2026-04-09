// Temporary shim: patches Array.prototype.toSorted/.sort to enforce agent
// picker order. OpenCode 1.4.x ignores the `order` field (sst/opencode#19127)
// and ZWSP prefixes cause TUI rendering artifacts (#3259).
// Remove once OpenCode ships `order` field support.

import { AGENT_DISPLAY_NAMES } from "./agent-display-names"

interface AgentLike {
  name: string
  [key: string]: unknown
}

const AGENT_RANK: Record<string, number> = {}
const PRIORITY_ORDER = [
  "sisyphus",
  "hephaestus",
  "prometheus",
  "atlas",
  "sisyphus-junior",
  "metis",
  "momus",
  "athena",
  "athena-junior",
]

for (let i = 0; i < PRIORITY_ORDER.length; i++) {
  const displayName = AGENT_DISPLAY_NAMES[PRIORITY_ORDER[i]]
  if (displayName) {
    AGENT_RANK[displayName] = i + 1
  }
}

const UNRANKED = 9999

function isAgentArray(arr: unknown[]): boolean {
  let knownCount = 0
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i]
    if (item == null || typeof item !== "object" || !("name" in item)) return false
    const name = (item as AgentLike).name
    if (typeof name !== "string") return false
    if (AGENT_RANK[name] !== undefined) knownCount++
  }
  return knownCount >= 2
}

function agentComparator(
  a: unknown,
  b: unknown,
  fallback?: (a: unknown, b: unknown) => number,
): number {
  const aName = a != null && typeof a === "object" && "name" in a ? (a as AgentLike).name : undefined
  const bName = b != null && typeof b === "object" && "name" in b ? (b as AgentLike).name : undefined
  const ra = (aName !== undefined ? AGENT_RANK[aName] : undefined) ?? UNRANKED
  const rb = (bName !== undefined ? AGENT_RANK[bName] : undefined) ?? UNRANKED
  if (ra !== rb) return ra - rb
  return fallback ? fallback(a, b) : 0
}

export function installAgentSortShim(): void {
  const origToSorted = Array.prototype.toSorted
  Array.prototype.toSorted = function (this: unknown[], compareFn?: (a: unknown, b: unknown) => number) {
    if (this.length >= 2 && isAgentArray(this)) {
      return origToSorted.call(this, (a: unknown, b: unknown) =>
        agentComparator(a, b, compareFn),
      )
    }
    return origToSorted.call(this, compareFn)
  } as typeof Array.prototype.toSorted

  const origSort = Array.prototype.sort
  Array.prototype.sort = function (this: unknown[], compareFn?: (a: unknown, b: unknown) => number) {
    if (this.length >= 2 && isAgentArray(this)) {
      return origSort.call(this, (a: unknown, b: unknown) =>
        agentComparator(a, b, compareFn),
      )
    }
    return origSort.call(this, compareFn)
  } as typeof Array.prototype.sort
}

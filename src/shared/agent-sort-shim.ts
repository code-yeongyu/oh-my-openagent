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

function isAgentArray(arr: unknown[]): arr is AgentLike[] {
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i]
    if (
      item != null &&
      typeof item === "object" &&
      "name" in item &&
      typeof (item as AgentLike).name === "string" &&
      AGENT_RANK[(item as AgentLike).name] !== undefined
    ) {
      return true
    }
  }
  return false
}

function agentComparator(
  a: AgentLike,
  b: AgentLike,
  fallback?: (a: AgentLike, b: AgentLike) => number,
): number {
  const ra = AGENT_RANK[a.name] ?? UNRANKED
  const rb = AGENT_RANK[b.name] ?? UNRANKED
  if (ra !== rb) return ra - rb
  return fallback ? fallback(a, b) : 0
}

export function installAgentSortShim(): void {
  const origToSorted = Array.prototype.toSorted
  Array.prototype.toSorted = function (this: unknown[], compareFn?: (a: unknown, b: unknown) => number) {
    if (this.length >= 2 && isAgentArray(this)) {
      return origToSorted.call(this, (a: unknown, b: unknown) =>
        agentComparator(a as AgentLike, b as AgentLike, compareFn as (a: AgentLike, b: AgentLike) => number),
      )
    }
    return origToSorted.call(this, compareFn)
  } as typeof Array.prototype.toSorted

  const origSort = Array.prototype.sort
  Array.prototype.sort = function (this: unknown[], compareFn?: (a: unknown, b: unknown) => number) {
    if (this.length >= 2 && isAgentArray(this)) {
      return origSort.call(this, (a: unknown, b: unknown) =>
        agentComparator(a as AgentLike, b as AgentLike, compareFn as (a: AgentLike, b: AgentLike) => number),
      )
    }
    return origSort.call(this, compareFn)
  } as typeof Array.prototype.sort
}

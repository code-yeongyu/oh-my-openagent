import type { PreferenceCycleState } from "./preference-types"

const MAX_OSCILLATIONS = 5

export function updateCycleState(
  state: PreferenceCycleState,
  oldValue: number,
  newValue: number
): PreferenceCycleState {
  if (state.frozen) return state

  const direction: "up" | "down" | "none" =
    newValue > oldValue ? "up" : newValue < oldValue ? "down" : "none"

  const isOscillation =
    direction !== "none" &&
    state.lastDirection !== "none" &&
    direction !== state.lastDirection

  const oscillationCount = isOscillation
    ? state.oscillationCount + 1
    : state.oscillationCount

  const frozen = oscillationCount >= MAX_OSCILLATIONS

  return {
    cycleCount: state.cycleCount + 1,
    lastDirection: direction === "none" ? state.lastDirection : direction,
    oscillationCount,
    frozen,
  }
}

export function createInitialCycleState(): PreferenceCycleState {
  return { cycleCount: 0, lastDirection: "none", oscillationCount: 0, frozen: false }
}

export function detectPreferenceCycle(preferences: Array<{ superior: string; inferior: string }>): {
  detected: boolean
  path: string[]
} {
  const adjacency = new Map<string, string[]>()

  for (const preference of preferences) {
    const edges = adjacency.get(preference.superior) ?? []
    edges.push(preference.inferior)
    adjacency.set(preference.superior, edges)
  }

  for (const start of adjacency.keys()) {
    const cyclePath = findCyclePath(start, adjacency, [], new Set())
    if (cyclePath) {
      return { detected: true, path: cyclePath }
    }
  }

  return { detected: false, path: [] }
}

function findCyclePath(
  node: string,
  adjacency: Map<string, string[]>,
  stack: string[],
  visiting: Set<string>,
): string[] | null {
  if (visiting.has(node)) {
    const cycleStart = stack.indexOf(node)
    return cycleStart >= 0 ? [...stack.slice(cycleStart), node] : [node, node]
  }

  visiting.add(node)
  stack.push(node)

  for (const next of adjacency.get(node) ?? []) {
    const cyclePath = findCyclePath(next, adjacency, stack, visiting)
    if (cyclePath) {
      return cyclePath
    }
  }

  stack.pop()
  visiting.delete(node)
  return null
}

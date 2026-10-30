import { describe, expect, test } from "bun:test"

import { closesCycle, type CausalEdge } from "./causal"

function isAcyclic(nodes: number, edges: readonly CausalEdge[]): boolean {
  const indegree = new Map<string, number>()
  const next = new Map<string, string[]>()
  for (let node = 0; node < nodes; node++) indegree.set(String(node), 0)
  for (const edge of edges) {
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1)
    next.set(edge.from, [...(next.get(edge.from) ?? []), edge.to])
  }
  const ready = [...indegree].filter(([, count]) => count === 0).map(([node]) => node)
  let visited = 0
  while (ready.length > 0) {
    const node = ready.pop() as string
    visited++
    for (const target of next.get(node) ?? []) {
      const remaining = (indegree.get(target) ?? 0) - 1
      indegree.set(target, remaining)
      if (remaining === 0) ready.push(target)
    }
  }
  return visited === nodes
}

function prng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

describe("causal cycle detector", () => {
  test("#given 543 random edge streams #when each edge is admitted only if it closes no cycle #then every accepted graph is a DAG and every refused edge would have closed one", () => {
    const random = prng(20260929)
    let offered = 0
    let refused = 0
    for (let graph = 0; graph < 543; graph++) {
      const nodes = 3 + Math.floor(random() * 10)
      const accepted: CausalEdge[] = []
      const attempts = 4 + Math.floor(random() * 24)
      for (let attempt = 0; attempt < attempts; attempt++) {
        const edge = { from: String(Math.floor(random() * nodes)), to: String(Math.floor(random() * nodes)) }
        offered++
        if (closesCycle(accepted, edge.from, edge.to)) {
          refused++
          expect(edge.from === edge.to || !isAcyclic(nodes, [...accepted, edge])).toBe(true)
          continue
        }
        accepted.push(edge)
        expect(isAcyclic(nodes, accepted)).toBe(true)
      }
    }
    expect(offered).toBeGreaterThan(8_000)
    expect(refused).toBeGreaterThan(0)
  })

  test("#given A->B->C #when C->A, A->A and B->A are offered #then each closes a cycle while A->C does not", () => {
    const edges = [{ from: "A", to: "B" }, { from: "B", to: "C" }]
    expect(closesCycle(edges, "C", "A")).toBe(true)
    expect(closesCycle(edges, "A", "A")).toBe(true)
    expect(closesCycle(edges, "B", "A")).toBe(true)
    expect(closesCycle(edges, "A", "C")).toBe(false)
  })
})

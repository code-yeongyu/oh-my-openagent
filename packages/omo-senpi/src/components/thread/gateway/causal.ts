export type CausalEdge = { readonly from: string; readonly to: string }

export function reaches(edges: readonly CausalEdge[], start: string, goal: string): boolean {
  const next = new Map<string, string[]>()
  for (const edge of edges) {
    const targets = next.get(edge.from)
    if (targets === undefined) next.set(edge.from, [edge.to])
    else targets.push(edge.to)
  }
  const seen = new Set<string>([start])
  const pending = [start]
  while (pending.length > 0) {
    const node = pending.pop() as string
    if (node === goal) return true
    for (const target of next.get(node) ?? []) {
      if (seen.has(target)) continue
      seen.add(target)
      pending.push(target)
    }
  }
  return false
}

export function closesCycle(edges: readonly CausalEdge[], from: string, to: string): boolean {
  return from === to || reaches(edges, to, from)
}

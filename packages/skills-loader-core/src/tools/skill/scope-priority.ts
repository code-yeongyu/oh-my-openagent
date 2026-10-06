export const SCOPE_PRIORITY: Record<string, number> = {
  project: 4,
  user: 3,
  opencode: 2,
  "opencode-project": 2,
  shared: 1,
  plugin: 1,
  config: 1,
  builtin: 1,
}

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

/**
 * Orders items by scope priority, then by name. The name tie-break makes the order
 * independent of discovery order, so listings built from it render byte-identically
 * across processes (#9432). Code-unit comparison keeps it independent of locale too.
 */
export function sortByScopePriority<TItem extends { scope: string; name: string }>(items: TItem[]): TItem[] {
  return [...items].sort((left, right) => {
    const leftPriority = SCOPE_PRIORITY[left.scope] || 0
    const rightPriority = SCOPE_PRIORITY[right.scope] || 0
    return rightPriority - leftPriority || compareCodeUnits(left.name, right.name)
  })
}

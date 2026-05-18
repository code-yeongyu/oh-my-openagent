export const SCOPE_PRIORITY: Record<string, number> = {
  project: 4,
  user: 3,
  opencode: 2,
  "opencode-project": 2,
  plugin: 1,
  config: 1,
  builtin: 1,
}

export function sortByScopePriority<TItem extends { scope: string }>(items: TItem[]): TItem[] {
  return [...items].sort((left, right) => {
    const leftPriority = SCOPE_PRIORITY[left.scope] || 0
    const rightPriority = SCOPE_PRIORITY[right.scope] || 0
    return rightPriority - leftPriority
  })
}

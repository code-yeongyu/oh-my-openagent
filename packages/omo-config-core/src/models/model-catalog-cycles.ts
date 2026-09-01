import type { OmoModelCatalog } from "../schema"

export function findModelCatalogCycles(catalog: OmoModelCatalog): readonly string[] {
  const cycleNames = new Set<string>()
  const path: string[] = []
  const visited = new Set<string>()
  const visiting = new Set<string>()

  function visit(name: string): void {
    if (visited.has(name)) return

    visiting.add(name)
    path.push(name)
    const next = catalog[name]?.model
    if (next !== undefined && Object.hasOwn(catalog, next)) {
      if (visiting.has(next)) {
        const cycleStart = path.indexOf(next)
        for (const cycleName of path.slice(cycleStart)) cycleNames.add(cycleName)
      } else {
        visit(next)
      }
    }
    path.pop()
    visiting.delete(name)
    visited.add(name)
  }

  for (const name of Object.keys(catalog)) visit(name)
  return [...cycleNames].sort()
}

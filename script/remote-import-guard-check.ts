import type { Resolver } from "./remote-import-guard-resolve"
import type { FileFacts, ImportEdge } from "./remote-import-guard-scan"

export type GuardedOrigin = {
  readonly names: readonly string[]
  readonly modules: readonly string[]
}

export type GuardRules = {
  readonly testFile: (file: string) => boolean
  readonly s1: readonly { readonly target: string; readonly allowedImporters: readonly string[] }[]
  readonly s2Origins: readonly GuardedOrigin[]
  readonly s2AllowedImporters: readonly string[]
}

export type GuardFindings = {
  readonly s1: ReadonlyMap<string, readonly string[]>
  readonly s2: ReadonlyMap<string, readonly string[]>
  readonly nonLiteralImports: ReadonlyMap<string, number>
}

const under = (file: string, prefixes: readonly string[]): boolean =>
  prefixes.some((prefix) => (prefix.endsWith("/") ? file.startsWith(prefix) : file === prefix))

function add(map: Map<string, Set<string>>, key: string, value: string): boolean {
  const set = map.get(key) ?? new Set<string>()
  map.set(key, set)
  if (set.has(value)) return false
  set.add(value)
  return true
}

const sorted = (map: Map<string, Set<string>>): ReadonlyMap<string, readonly string[]> =>
  new Map([...map.keys()].toSorted().map((key) => [key, [...(map.get(key) ?? [])].toSorted()]))

// The guarded names each module exports: the origin modules export theirs, and any module that re-exports one
// (`export { x } from`, `export * from`, or `import { x }` then `export { x }`) exports it too, so a consumer that
// reaches the value through a barrel or a runtime shim is still matched by where the value comes from.
function guardedExports(
  facts: readonly FileFacts[],
  resolve: Resolver,
  origins: readonly GuardedOrigin[],
): (module: string | undefined) => ReadonlySet<string> {
  const propagated = new Map<string, Set<string>>()
  const exportsOf = (module: string | undefined): ReadonlySet<string> => {
    if (module === undefined) return new Set()
    const own = origins.filter((origin) => under(module, origin.modules)).flatMap((origin) => origin.names)
    return new Set([...own, ...(propagated.get(module) ?? [])])
  }
  let changed = true
  while (changed) {
    changed = false
    for (const fact of facts) {
      for (const edge of fact.edges) {
        if (edge.typeOnly || (edge.kind !== "export-from" && edge.kind !== "import")) continue
        const exported = exportsOf(resolve(fact.file, edge.specifier))
        if (exported.size === 0) continue
        if (edge.kind === "export-from" && edge.whole)
          for (const name of exported) changed ||= add(propagated, fact.file, name)
        for (const named of edge.names) {
          if (named.typeOnly || !exported.has(named.name)) continue
          const reExportedAs = edge.kind === "export-from" ? named.local : fact.localExports.get(named.local)
          if (reExportedAs !== undefined) changed ||= add(propagated, fact.file, reExportedAs)
        }
      }
    }
  }
  return exportsOf
}

function valueUses(edge: ImportEdge, exported: ReadonlySet<string>, identifiers: ReadonlySet<string>): string[] {
  if (edge.typeOnly) return []
  const named = edge.names.filter((entry) => !entry.typeOnly && exported.has(entry.name)).map((entry) => entry.name)
  if (!edge.whole) return named
  if (edge.kind === "export-from") return [...named, ...exported]
  return [...named, ...[...exported].filter((name) => identifiers.has(name))]
}

export function checkImports(facts: readonly FileFacts[], resolve: Resolver, rules: GuardRules): GuardFindings {
  const exportsOf = guardedExports(facts, resolve, rules.s2Origins)
  const s1 = new Map<string, Set<string>>()
  const s2 = new Map<string, Set<string>>()
  const nonLiteralImports = new Map<string, number>()
  for (const fact of facts) {
    if (fact.nonLiteralImportLines.length > 0) nonLiteralImports.set(fact.file, fact.nonLiteralImportLines.length)
    if (rules.testFile(fact.file)) continue
    for (const edge of fact.edges) {
      const target = resolve(fact.file, edge.specifier)
      if (target === undefined) continue
      for (const rule of rules.s1) {
        if (target.startsWith(rule.target) && !under(fact.file, rule.allowedImporters)) add(s1, fact.file, rule.target)
      }
      if (under(fact.file, rules.s2AllowedImporters)) continue
      const ownNames = new Set(
        rules.s2Origins.filter((origin) => under(fact.file, origin.modules)).flatMap((o) => o.names),
      )
      for (const name of valueUses(edge, exportsOf(target), fact.identifiers)) {
        if (!ownNames.has(name)) add(s2, fact.file, name)
      }
    }
  }
  return { s1: sorted(s1), s2: sorted(s2), nonLiteralImports: new Map([...nonLiteralImports].toSorted()) }
}

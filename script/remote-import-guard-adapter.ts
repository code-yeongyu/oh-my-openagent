import type { Resolver } from "./remote-import-guard-resolve"
import type { FileFacts } from "./remote-import-guard-scan"

// Guard family A (#14943 design 7.5): an adapter parses, makes one SDK call and renders. Its imports, and those of every
// helper it reaches that is not an SDK entry, may not reach address or device resolution, transport or port construction,
// account or credential handling, or policy, nor a socket built-in. The walk stops at an SDK entry: what the SDK reaches
// is the core's business. Findings are compared with an offender list that only shrinks.

export type AdapterRules = {
  readonly adapter: (file: string) => boolean
  readonly testFile: (file: string) => boolean
  readonly sdkEntries: readonly string[]
  readonly forbidden: readonly string[]
  readonly forbiddenBuiltins: readonly string[]
}

const layerOf = (target: string, forbidden: readonly string[]): string | undefined =>
  forbidden.find((prefix) => (prefix.endsWith("/") ? target.startsWith(prefix) : target === prefix))

type OffenderRecord = Readonly<Record<string, { readonly uses: readonly string[] }>>

// The record may only shrink against the merge base (review 6061267823 H5): a new offending file, or a new layer for a
// file the base listed, fails; removing either passes. A base with no record (the pull request that introduces it) admits
// the record as it is.
export function offenderGrowth(base: OffenderRecord | undefined, head: OffenderRecord): string[] {
  if (base === undefined) return []
  const problems: string[] = []
  for (const [file, offender] of Object.entries(head)) {
    const before = base[file]
    if (before === undefined) {
      problems.push(`${file} is a new adapter offender (${offender.uses.join(", ")}); route it through the SDK instead`)
      continue
    }
    for (const use of offender.uses)
      if (!before.uses.includes(use))
        problems.push(`${file} gained ${use}, which the merge base's record does not list; route it through the SDK`)
  }
  return problems
}

export function checkAdapterImports(
  facts: readonly FileFacts[],
  resolve: Resolver,
  rules: AdapterRules,
): ReadonlyMap<string, readonly string[]> {
  const byFile = new Map(facts.map((fact) => [fact.file, fact]))
  const resolved = new Map<string, string | undefined>()
  const resolveOnce = (from: string, specifier: string): string | undefined => {
    const key = `${from}\0${specifier}`
    if (!resolved.has(key)) resolved.set(key, resolve(from, specifier))
    return resolved.get(key)
  }
  const findings = new Map<string, readonly string[]>()
  for (const fact of facts) {
    if (!rules.adapter(fact.file) || rules.testFile(fact.file)) continue
    const reached = new Set<string>()
    const seen = new Set<string>([fact.file])
    const queue = [fact]
    while (queue.length > 0) {
      const current = queue.shift()
      if (current === undefined) break
      for (const edge of current.edges) {
        if (edge.typeOnly) continue
        const builtin = edge.specifier.replace(/^node:/, "")
        if (rules.forbiddenBuiltins.includes(builtin)) reached.add(`node:${builtin}`)
        const target = resolveOnce(current.file, edge.specifier)
        if (target === undefined || rules.sdkEntries.includes(target)) continue
        const layer = layerOf(target, rules.forbidden)
        if (layer !== undefined && layer !== fact.file && !target.startsWith(fact.file)) {
          reached.add(layer)
          continue
        }
        const next = byFile.get(target)
        if (next !== undefined && !seen.has(target)) {
          seen.add(target)
          queue.push(next)
        }
      }
    }
    if (reached.size > 0) findings.set(fact.file, [...reached].toSorted())
  }
  return new Map([...findings].toSorted(([a], [b]) => a.localeCompare(b)))
}

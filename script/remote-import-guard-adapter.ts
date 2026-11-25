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
  // An adapter may name a core's types; a layer whose every import is a dependency (the account core) counts them too.
  readonly includeTypeOnly?: boolean
}

const layerOf = (target: string, forbidden: readonly string[]): string | undefined =>
  forbidden.find((prefix) => (prefix.endsWith("/") ? target.startsWith(prefix) : target === prefix))

type OffenderRecord = Readonly<Record<string, { readonly uses: readonly string[] }>>

// The record may only shrink against the merge base (review 6061267823 H5): a new offending file, or a new layer for a
// file the base listed, fails; removing either passes. A base with no record (the pull request that introduces it) admits
// the record as it is. A base use of a layer whose code moved also admits the layer it moved to.
export function offenderGrowth(
  base: OffenderRecord | undefined,
  head: OffenderRecord,
  renames: Readonly<Record<string, string>> = {},
): string[] {
  if (base === undefined) return []
  const problems: string[] = []
  for (const [file, offender] of Object.entries(head)) {
    const before = base[file]
    if (before === undefined) {
      problems.push(`${file} is a new adapter offender (${offender.uses.join(", ")}); route it through the SDK instead`)
      continue
    }
    const beforeUses = before.uses.flatMap((use) => [use, ...(renames[use] === undefined ? [] : [renames[use]])])
    for (const use of offender.uses)
      if (!beforeUses.includes(use))
        problems.push(`${file} gained ${use}, which the merge base's record does not list; route it through the SDK`)
  }
  return problems
}

// Each file outside `owner` that holds one of the markers, with the kinds of logic it names. Sources are the caller's:
// tracked, non-test files.
export function logicOutside(
  sources: readonly { readonly file: string; readonly text: string }[],
  owner: string,
  markers: Readonly<Record<string, readonly string[]>>,
): ReadonlyMap<string, readonly string[]> {
  const found = new Map<string, readonly string[]>()
  for (const { file, text } of sources) {
    if (file.startsWith(owner)) continue
    const kinds = Object.entries(markers)
      .filter(([, literals]) => literals.some((literal) => text.includes(literal)))
      .map(([kind]) => kind)
    if (kinds.length > 0) found.set(file, kinds)
  }
  return new Map([...found].toSorted(([a], [b]) => a.localeCompare(b)))
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
        if (edge.typeOnly && rules.includeTypeOnly !== true) continue
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

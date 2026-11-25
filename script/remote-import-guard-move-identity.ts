import type { Resolver } from "./remote-import-guard-resolve"

// A moved file may change its module specifiers and nothing else, and each changed specifier must still name the same
// module (#14364, design lane ruling on review 6065350035): the same file it resolved to at the merge base, that file's
// moved counterpart, or, one hop, the single module that base file purely re-exports, where "purely" is checked: every
// statement is an export-from of that one module, and every name the moved file imports through it is re-exported as a
// star or under its own name.

// One alternative per specifier position, in document order; `import(` is tried before a side-effect `import "x"`.
const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s*)(["'])([^"'\n]*)\2/g
const REEXPORT = /export\s+(?:type\s+)?(\*|\{[^}]*\})\s*from\s*(["'])([^"'\n]*)\2\s*;?/g
const COMMENTS = /\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm

type SpecifierUse = { readonly index: number; readonly lead: string; readonly specifier: string }

const specifierUses = (text: string): SpecifierUse[] =>
  [...text.matchAll(SPECIFIER)].map((match) => ({
    index: match.index,
    lead: match[1] ?? "",
    specifier: match[3] ?? "",
  }))

/** The text with every module specifier blanked and nothing else touched: the comparison a pure move must pass. */
export function blankModuleSpecifiers(text: string): string {
  return text.replace(SPECIFIER, "$1$2$2")
}

// The names an `import { a, type B, c as d } from` statement asks the module for; undefined for any other shape
// (default, namespace, side-effect, dynamic, export-from), which a re-export hop cannot vouch for.
function requestedNames(text: string, use: SpecifierUse): readonly string[] | undefined {
  if (!use.lead.startsWith("from")) return undefined
  const before = text.slice(0, use.index)
  const keyword = [...before.matchAll(/\bimport\b/g)].at(-1)
  if (keyword === undefined) return undefined
  const clause = before
    .slice(keyword.index + "import".length)
    .replace(/^\s*type\s+/, "")
    .trim()
  const braces = /^\{([^}]*)\}$/.exec(clause)
  if (braces === null) return undefined
  return (braces[1] ?? "")
    .split(",")
    .map((entry) => entry.trim().replace(/^type\s+/, ""))
    .filter((entry) => entry !== "")
    .map((entry) => entry.split(/\s+as\s+/)[0] ?? entry)
}

export type PureReexport = { readonly specifier: string; readonly star: boolean; readonly names: ReadonlySet<string> }

/** The one module a file re-exports when export-from of that module is all it holds; undefined otherwise. */
export function pureReexport(text: string): PureReexport | undefined {
  const code = text.replace(COMMENTS, "")
  const statements = [...code.matchAll(REEXPORT)]
  if (statements.length === 0 || code.replace(REEXPORT, "").trim() !== "") return undefined
  const specifiers = new Set(statements.map((statement) => statement[3] ?? ""))
  if (specifiers.size !== 1) return undefined
  const names = new Set<string>()
  let star = false
  for (const statement of statements) {
    const list = statement[1] ?? ""
    if (list === "*") star = true
    for (const entry of list === "*" ? [] : list.slice(1, -1).split(",")) {
      const name = entry.trim().replace(/^type\s+/, "")
      if (name !== "" && !/\sas\s/.test(name)) names.add(name)
    }
  }
  return { specifier: [...specifiers][0] ?? "", star, names }
}

export type IdentitySides = {
  readonly resolveBase: Resolver
  readonly resolveHead: Resolver
  readonly readBase: (path: string) => string | undefined
  readonly pairs: Readonly<Record<string, string>>
}

export type IdentityResult = { readonly problems: readonly string[]; readonly hops: readonly string[] }

/** Each changed specifier of one moved pair (texts already equal with specifiers blanked) against module identity. */
export function specifierIdentity(
  from: string,
  to: string,
  before: string,
  after: string,
  sides: IdentitySides,
): IdentityResult {
  const old = specifierUses(before)
  const now = specifierUses(after)
  const problems: string[] = []
  const hops: string[] = []
  const same = (target: string, wanted: string): boolean => target === wanted || sides.pairs[target] === wanted
  for (const [index, use] of now.entries()) {
    const was = old[index]
    if (was === undefined || was.specifier === use.specifier) continue
    const change = `${to}: "${was.specifier}" -> "${use.specifier}"`
    const baseTarget = sides.resolveBase(from, was.specifier)
    const headTarget = sides.resolveHead(to, use.specifier)
    if (baseTarget === undefined || headTarget === undefined) {
      problems.push(`${change} changes a module outside this repository or one that does not resolve`)
      continue
    }
    if (same(baseTarget, headTarget)) continue
    const reexport = pureReexport(sides.readBase(baseTarget) ?? "")
    const through = reexport === undefined ? undefined : sides.resolveBase(baseTarget, reexport.specifier)
    const names = requestedNames(after, use)
    const provided =
      reexport !== undefined &&
      names !== undefined &&
      names.every((name) => name !== "default" && (reexport.star || reexport.names.has(name)))
    if (through !== undefined && provided && same(through, headTarget)) {
      hops.push(`${change} through ${baseTarget}`)
      continue
    }
    problems.push(
      `${change} resolves to ${headTarget}, not ${baseTarget}, its moved counterpart or the module it purely re-exports`,
    )
  }
  return { problems, hops }
}

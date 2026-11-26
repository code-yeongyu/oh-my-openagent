import type { CliEntry, Edition, Row } from "./schema"

// The descriptor seam (design 3.2, reviews 6061267823 M8 and 6061624223 M3): the rows are the descriptors, and this is
// the one dispatch over them. An argv selects one entry by its longest route, then by the branch flags (`when`) it
// carries, then by whether its positionals are given and are among the entry's values; the selected row's call is
// invoked on the root with the input the entry's mappings build. An argv two rows answer equally is ambiguous.

export type Selection =
  | { readonly kind: "selected"; readonly row: Row; readonly entry: CliEntry }
  | { readonly kind: "ambiguous"; readonly rows: readonly string[] }
  | { readonly kind: "none" }

// Targets that build no input: the adapter's rendering, process control, branch selectors, parse-only flags, root options.
const NOT_INPUT = new Set(["render", "process", "when", "parse"])
const isInputTarget = (target: string): boolean => !NOT_INPUT.has(target) && !target.startsWith("root.")

const whenFlags = (entry: CliEntry): string[] =>
  Object.entries(entry.flags)
    .filter(([, target]) => target === "when")
    .map(([flag]) => flag)

// The parsing contract is the descriptor's own notation (review 6061874518 M4): a flag mapped to `field` takes the next
// word as its value, a presence flag is written `field=true` (or another fixed value). No type annotation is read, and
// arity-check.ts ties the notation to each command's real parser.
export function takesValue(entry: CliEntry, flag: string): boolean {
  const target = entry.flags[flag]
  return target !== undefined && isInputTarget(target) && !target.includes("=")
}

function positionalsOf(row: Row, entry: CliEntry, rest: readonly string[]): string[] {
  const out: string[] = []
  for (let index = 0; index < rest.length; index++) {
    const word = rest[index] ?? ""
    if (word.startsWith("-")) {
      if (takesValue(entry, word)) index++
      continue
    }
    out.push(word)
  }
  return out
}

// A root entry with no branch flag is an option carrier (`--platform`), not a route, except the bare launch of the engine.
export const isDescriptor = (row: Row, entry: CliEntry): boolean =>
  row.kind !== "render" && (entry.route.length > 0 || whenFlags(entry).length > 0 || entry.via === "engine")

export function selectDescriptor(rows: readonly Row[], edition: Edition, argv: readonly string[]): Selection {
  const candidates = rows.flatMap((row) =>
    row.cli
      .filter((entry) => entry.edition === edition && isDescriptor(row, entry))
      .filter((entry) => entry.route.every((word, index) => argv[index] === word))
      .map((entry) => ({ row, entry })),
  )
  const longest = Math.max(-1, ...candidates.map(({ entry }) => entry.route.length))
  const scored = candidates
    .filter(({ entry }) => entry.route.length === longest)
    .flatMap(({ row, entry }) => {
      const rest = argv.slice(entry.route.length)
      const branch = whenFlags(entry)
      if (!branch.every((flag) => rest.includes(flag))) return []
      const positionals = positionalsOf(row, entry, rest)
      const takes = Object.keys(entry.positionals).length > 0
      if (takes !== positionals.length > 0) return []
      const [first] = positionals
      if (first !== undefined && entry.values.length > 0 && !entry.values.includes(first)) return []
      const valued = first !== undefined && entry.values.includes(first) ? 1 : 0
      return [{ row, entry, score: branch.length * 2 + valued }]
    })
  const best = Math.max(-1, ...scored.map(({ score }) => score))
  const top = scored.filter(({ score }) => score === best)
  const ids = [...new Set(top.map(({ row }) => row.id))]
  const [chosen] = top
  if (chosen === undefined) return { kind: "none" }
  if (ids.length > 1) return { kind: "ambiguous", rows: ids }
  return { kind: "selected", row: chosen.row, entry: chosen.entry }
}

function setPath(input: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split(".")
  let node = input
  for (const segment of segments.slice(0, -1)) {
    const next = node[segment]
    node = typeof next === "object" && next !== null ? (next as Record<string, unknown>) : (node[segment] = {})
  }
  node[segments.at(-1) ?? ""] = value
}

function buildInput(row: Row, entry: CliEntry, rest: readonly string[]): Record<string, unknown> {
  const input: Record<string, unknown> = {}
  for (const [flag, target] of Object.entries(entry.flags)) {
    const at = rest.indexOf(flag)
    if (at < 0 || !isInputTarget(target)) continue
    const [path = "", fixed] = target.split("=")
    const value = fixed !== undefined ? fixed : takesValue(entry, flag) ? rest[at + 1] : true
    setPath(input, path, fixed === "true" ? true : fixed === "false" ? false : value)
  }
  const targets = Object.values(entry.positionals)
  positionalsOf(row, entry, rest).forEach((word, index) => {
    const target = targets[index]
    if (target !== undefined && isInputTarget(target) && input[target] === undefined) setPath(input, target, word)
  })
  return input
}

export function dispatch(rows: readonly Row[], edition: Edition, argv: readonly string[], root: unknown): Selection {
  const selection = selectDescriptor(rows, edition, argv)
  if (selection.kind !== "selected") return selection
  let member: unknown = root
  for (const key of selection.row.sdk.split(".")) member = Reflect.get(Object(member), key)
  const input = buildInput(selection.row, selection.entry, argv.slice(selection.entry.route.length))
  Reflect.apply(member as (input: unknown) => unknown, undefined, [input])
  return selection
}

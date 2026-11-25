import type { CliEntry, Edition, Row } from "./schema"

// The descriptor seam (design 3.2, review 6061267823 M8): the rows are the descriptors, and this is the one dispatch over
// them. An argv selects one entry by its longest route, then by the branch flags (`when`) it carries, then by whether a
// positional is given and is one of the entry's values; the selected row's call is invoked on the root with the input
// built from the entry's mappings. An argv two rows answer equally is ambiguous, never resolved by order.

export type Selection =
  | { readonly kind: "selected"; readonly row: Row; readonly entry: CliEntry }
  | { readonly kind: "ambiguous"; readonly rows: readonly string[] }
  | { readonly kind: "none" }

const whenFlags = (entry: CliEntry): string[] =>
  Object.entries(entry.flags)
    .filter(([, target]) => target === "when")
    .map(([flag]) => flag)

// A root entry with no branch flag is an option carrier (`--platform`), not a route, except the bare launch of the engine.
const isDescriptor = (row: Row, entry: CliEntry): boolean =>
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
      const positional = rest.find((word) => !word.startsWith("-"))
      const takes = Object.keys(entry.positionals).length > 0
      if (takes !== (positional !== undefined)) return []
      if (positional !== undefined && entry.values.length > 0 && !entry.values.includes(positional)) return []
      const valued = positional !== undefined && entry.values.includes(positional) ? 1 : 0
      return [{ row, entry, score: branch.length * 2 + valued }]
    })
  const best = Math.max(-1, ...scored.map(({ score }) => score))
  const top = scored.filter(({ score }) => score === best)
  const ids = [...new Set(top.map(({ row }) => row.id))]
  const [first] = top
  if (first === undefined) return { kind: "none" }
  if (ids.length > 1) return { kind: "ambiguous", rows: ids }
  return { kind: "selected", row: first.row, entry: first.entry }
}

export function buildInput(entry: CliEntry, rest: readonly string[]): Record<string, unknown> {
  const input: Record<string, unknown> = {}
  for (const [flag, target] of Object.entries(entry.flags)) {
    if (!rest.includes(flag) || ["render", "process", "when", "parse"].includes(target) || target.startsWith("root."))
      continue
    const [path = "", value] = target.split("=")
    input[path] = value ?? rest[rest.indexOf(flag) + 1] ?? true
  }
  const [positional] = rest.filter((word) => !word.startsWith("-"))
  const [target] = Object.values(entry.positionals)
  if (positional !== undefined && target !== undefined && !["process", "when"].includes(target))
    input[target] = positional
  return input
}

export function dispatch(rows: readonly Row[], edition: Edition, argv: readonly string[], root: unknown): Selection {
  const selection = selectDescriptor(rows, edition, argv)
  if (selection.kind !== "selected") return selection
  let member: unknown = root
  for (const key of selection.row.sdk.split(".")) member = Reflect.get(Object(member), key)
  Reflect.apply(member as (input: unknown) => unknown, undefined, [
    buildInput(selection.entry, argv.slice(selection.entry.route.length)),
  ])
  return selection
}

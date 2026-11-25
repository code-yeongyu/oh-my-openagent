import { describe, expect, test } from "bun:test"

import { dispatch, isDescriptor, selectDescriptor } from "./descriptor-dispatch"
import { recordCalls, recordInvocations } from "./recording-root"
import { allRows, loadDomainFiles } from "./registry"
import { type CliEntry, type Row, schemaAt } from "./schema"

// Design 3.2 and 7.2 (reviews 6061267823 M8, 6061624223 M3): every registered descriptor, driven through the one dispatch
// seam against a recording root, selects its own row, invokes exactly that row's SDK member, and passes the input its
// mappings promise: every mapped flag with its value and every positional, each at a field the row's input names.

const rows = allRows(loadDomainFiles())

// Entries that are not routes (no route, no branch flag): options the parent command reads. Exact both ways.
const OPTION_CARRIERS: Readonly<Record<string, string>> = {
  "install.plugin opencode --platform": "a root option of omo install; the install route carries the call",
}
const carrierKey = (row: Row, entry: CliEntry): string =>
  `${row.id} ${entry.edition} ${Object.keys(entry.flags).join(" ")}`

const sample = (index: number): string => `v${index}`

function fullArgv(row: Row, entry: CliEntry): { readonly argv: string[]; readonly expected: Record<string, unknown> } {
  const argv = [...entry.route]
  const expected: Record<string, unknown> = {}
  let next = 0
  for (const [flag, target] of Object.entries(entry.flags)) {
    if (["render", "process", "parse"].includes(target) || target.startsWith("root.")) continue
    argv.push(flag)
    if (target === "when") continue
    const [path = "", fixed] = target.split("=")
    if (fixed !== undefined) expected[path] = fixed === "true" ? true : fixed === "false" ? false : fixed
    else {
      const value = sample(next++)
      argv.push(value)
      expected[path] = value
    }
  }
  Object.values(entry.positionals).forEach((target, index) => {
    const value = index === 0 && entry.values.length > 0 ? (entry.values[0] ?? "x") : sample(next++)
    argv.push(value)
    if (!["process", "when"].includes(target) && expected[target] === undefined) expected[target] = value
  })
  return { argv, expected }
}

const flatten = (value: unknown, prefix = ""): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value).flatMap(([key, inner]) =>
          Object.entries(flatten(inner, prefix === "" ? key : `${prefix}.${key}`)),
        ),
      )
    : { [prefix]: value }

function descriptorProblems(all: readonly Row[]): string[] {
  const problems: string[] = []
  const carriers = new Set<string>()
  for (const row of all)
    for (const entry of row.cli) {
      if (row.kind === "render") continue
      if (!isDescriptor(row, entry)) {
        carriers.add(carrierKey(row, entry))
        if (OPTION_CARRIERS[carrierKey(row, entry)] === undefined)
          problems.push(`${carrierKey(row, entry)} is neither a route nor a listed option carrier`)
        continue
      }
      const { argv, expected } = fullArgv(row, entry)
      const selection = selectDescriptor(all, entry.edition, argv)
      if (selection.kind === "none") {
        problems.push(`${entry.edition} "${argv.join(" ")}" of ${row.id} selects no descriptor`)
        continue
      }
      if (selection.kind === "ambiguous") {
        problems.push(
          `${entry.edition} "${argv.join(" ")}" is ambiguous between ${selection.rows.join(", ")}; give the branch a when flag`,
        )
        continue
      }
      if (selection.row.id !== row.id) {
        problems.push(`${entry.edition} "${argv.join(" ")}" of ${row.id} selects ${selection.row.id}`)
        continue
      }
      const invocations = recordInvocations((root) => dispatch(all, entry.edition, argv, root))
      const [only] = invocations
      if (invocations.length !== 1 || only?.member !== row.sdk) {
        problems.push(
          `${entry.edition} "${argv.join(" ")}" invokes ${invocations.map((call) => call.member).join(", ") || "nothing"}, but ${row.id}'s call is ${row.sdk}`,
        )
        continue
      }
      const passed = flatten(only.args[0] ?? {})
      // A flag mapped to an object field whose children other flags also map (--worktree with --branch) is satisfied by
      // those children: the object exists with them inside it.
      const isParent = (path: string): boolean => Object.keys(expected).some((other) => other.startsWith(`${path}.`))
      for (const path of Object.keys(expected).filter(isParent)) {
        if (!Object.keys(passed).some((key) => key.startsWith(`${path}.`)))
          problems.push(`${entry.edition} "${argv.join(" ")}" passes no ${path} to ${row.sdk}`)
        Reflect.deleteProperty(expected, path)
      }
      if (
        JSON.stringify(passed, Object.keys(passed).toSorted()) !==
        JSON.stringify(expected, Object.keys(expected).toSorted())
      )
        problems.push(
          `${entry.edition} "${argv.join(" ")}" passes ${JSON.stringify(passed)} to ${row.sdk}; its mappings promise ${JSON.stringify(expected)}`,
        )
      for (const path of Object.keys(passed))
        if (schemaAt(row.input, path) === undefined)
          problems.push(`${entry.edition} "${argv.join(" ")}" passes ${path}, which ${row.sdk}'s input does not name`)
    }
  for (const key of Object.keys(OPTION_CARRIERS))
    if (!carriers.has(key)) problems.push(`OPTION_CARRIERS lists ${key}, which is not an option carrier; remove it`)
  return problems
}

const withRow = (id: string, change: (row: Row) => Row): Row[] => rows.map((row) => (row.id === id ? change(row) : row))
const rowOf = (id: string): Row => {
  const found = rows.find((row) => row.id === id)
  if (found === undefined) throw new Error(`no ${id} row`)
  return found
}

describe("descriptor dispatch over the registry (reviews M8, M3)", () => {
  test("#given every CLI descriptor of both editions with all its flags and positionals #then dispatch selects its row and passes the mapped input to exactly that row's member", () => {
    expect(descriptorProblems(rows)).toEqual([])
  })

  test("#given a descriptor whose route another row also claims #then the selection is named as ambiguous", () => {
    const close = rowOf("threads.close")
    const stolen = withRow("threads.archive", (archive) => ({
      ...archive,
      cli: [...archive.cli, ...close.cli.filter((entry) => entry.route.join(" ") === "thread close")],
    }))
    expect(descriptorProblems(stolen)).toContainEqual(
      expect.stringContaining("is ambiguous between threads.archive, threads.close"),
    )
  })

  test("#given a row whose call names another member #then the recorded invocation names it", () => {
    const renamed = withRow("threads.close", (row) => ({ ...row, sdk: "threads.archive" }))
    expect(recordCalls((root) => dispatch(renamed, "native", ["thread", "close", "t"], root))).toEqual([
      "threads.archive",
    ])
  })

  test("#given a flag mapped to a field the row's input does not name #then the passed field is named", () => {
    const broken = withRow("threads.read", (row) => ({
      ...row,
      cli: row.cli.map((entry) =>
        entry.route.join(" ") === "thread read" ? { ...entry, flags: { ...entry.flags, "--cursor": "cursr" } } : entry,
      ),
    }))
    expect(descriptorProblems(broken)).toContainEqual(
      expect.stringContaining("passes cursr, which threads.read's input does not name"),
    )
  })

  test("#given an entry with two positionals #then both reach their fields in order", () => {
    const exportHtml = rowOf("engine.sessions.exportHtml")
    const [entry] = exportHtml.cli
    if (entry === undefined) throw new Error("no export entry")
    const invocations = recordInvocations((root) => dispatch(rows, "native", ["--export", "s.jsonl", "out.html"], root))
    expect(invocations).toEqual([
      { member: "engine.sessions.exportHtml", args: [{ session: "s.jsonl", out: "out.html" }] },
    ])
  })

  test("#given an unlisted option carrier #then it is named", () => {
    const carrier = withRow("threads.read", (row) => ({
      ...row,
      cli: [
        ...row.cli,
        { edition: "native", via: "launcher", route: [], flags: { "--x": "limit" }, positionals: {}, values: [] },
      ],
    }))
    expect(descriptorProblems(carrier)).toContainEqual(
      "threads.read native --x is neither a route nor a listed option carrier",
    )
  })
})

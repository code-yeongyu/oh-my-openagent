import { describe, expect, test } from "bun:test"

import { dispatch, selectDescriptor } from "./descriptor-dispatch"
import { recordCalls } from "./recording-root"
import { allRows, loadDomainFiles } from "./registry"
import type { CliEntry, Row } from "./schema"

// Design 3.2 and 7.2 (review 6061267823 M8): every registered descriptor, driven through the one dispatch seam against a
// recording root, selects its own row and invokes exactly that row's SDK member. An ambiguous route or a descriptor that
// reaches another member fails, naming the row.

const rows = allRows(loadDomainFiles())

const argvOf = (entry: CliEntry): string[] => {
  const branch = Object.entries(entry.flags)
    .filter(([, target]) => target === "when")
    .map(([flag]) => flag)
  const positional = Object.keys(entry.positionals).length > 0 ? [entry.values[0] ?? "x"] : []
  return [...entry.route, ...branch, ...positional]
}

function descriptorProblems(all: readonly Row[]): string[] {
  const problems: string[] = []
  for (const row of all)
    for (const entry of row.cli) {
      if (row.kind === "render") continue
      const argv = argvOf(entry)
      const selection = selectDescriptor(all, entry.edition, argv)
      if (selection.kind === "none") continue
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
      const calls = recordCalls((root) => dispatch(all, entry.edition, argv, root))
      if (calls.length !== 1 || calls[0] !== row.sdk)
        problems.push(
          `${entry.edition} "${argv.join(" ")}" invokes ${calls.join(", ") || "nothing"}, but ${row.id}'s call is ${row.sdk}`,
        )
    }
  return problems
}

describe("descriptor dispatch over the registry (review M8)", () => {
  test("#given every CLI descriptor of both editions #then dispatch selects its own row and invokes exactly that row's member", () => {
    expect(descriptorProblems(rows)).toEqual([])
  })

  test("#given a descriptor whose route another row also claims #then the selection is named as ambiguous", () => {
    const archive = rows.find((row) => row.id === "threads.archive")
    const close = rows.find((row) => row.id === "threads.close")
    if (archive === undefined || close === undefined) throw new Error("rows missing")
    const stolen: Row = {
      ...archive,
      cli: [...archive.cli, ...close.cli.filter((entry) => entry.route.join(" ") === "thread close")],
    }
    expect(descriptorProblems(rows.map((row) => (row.id === "threads.archive" ? stolen : row)))).toContainEqual(
      'native "thread close x" is ambiguous between threads.archive, threads.close; give the branch a when flag',
    )
  })

  test("#given a descriptor row whose call names another member #then the recorded invocation names both", () => {
    const close = rows.find((row) => row.id === "threads.close")
    if (close === undefined) throw new Error("no threads.close row")
    const renamed = rows.map((row) => (row.id === "threads.close" ? { ...row, sdk: "threads.archive" } : row))
    const calls = recordCalls((root) => dispatch(renamed, "native", ["thread", "close", "t"], root))
    expect(calls).toEqual(["threads.archive"])
    expect(calls).not.toEqual([close.sdk])
  })
})

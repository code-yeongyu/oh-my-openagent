import { describe, expect, test } from "bun:test"
import { gateReport } from "./gate"
import { input, rows, unresolved } from "./gate-fixture"
import type { Row } from "./schema"
import { registryProblems } from "./schema"
import {
  withoutAhead,
  tool,
  state,
  baseRows,
  rowReport,
  rowFailures,
  file,
  list,
  withAliasesOnBase,
} from "./tool-ahead-fixture"

// Negative controls of design 7.6 for the tool-ahead rule (LEAD ruling on #15076), row descriptors: each breaks one
// condition and must fail, measured against the admitted change.

describe("negative controls: the tool-ahead rule, row descriptors", () => {
  const descriptor = (edit: (row: Row) => Row) =>
    gateReport(
      input({
        base: { ...input().base, unresolved: withoutAhead(unresolved.entries) },
        head: { ...input().head, rows: rows.map((row) => (row.id === "threads.list" ? edit(row) : row)) },
      }),
    ).failures.filter((line) => line.startsWith("threads.list: its descriptor changed"))

  test("#given a declared alias remapped to another field the branch reads #then it fails", () => {
    expect(
      descriptor((row) => ({ ...row, tool: row.tool.map((entry) => ({ ...entry, aliases: { search: "state" } })) })),
    ).toHaveLength(1)
  })

  test("#given a listed field dropped from the branch and the row input #then it fails", () => {
    const { query: _query, ...properties } = list.input.properties
    expect(
      descriptor((row) => ({
        ...row,
        input: { ...row.input, properties },
        tool: row.tool.map((entry) => ({ ...entry, reads: entry.reads.filter((name) => name !== "query") })),
      })),
    ).toHaveLength(1)
  })

  test("#given a listed field made required #then it fails", () => {
    expect(
      descriptor((row) => ({ ...row, input: { ...row.input, required: [...row.input.required, "query"] } })),
    ).toHaveLength(1)
  })

  test("#given a listed field that is on the base, removed from the row and the branch #then it fails", () => {
    const read = rows.find((row) => row.id === "threads.read") as Row
    const devRead: Row = {
      ...read,
      tool: read.tool.map(({ aliases: _aliases, ...entry }) => ({
        ...entry,
        reads: entry.reads.filter((name) => name !== "limit"),
      })),
    }
    const report = gateReport(
      input({
        base: {
          ...input().base,
          rows: baseRows.map((row) => (row.id === "threads.read" ? devRead : row)),
          unresolved: withoutAhead(unresolved.entries),
        },
        head: {
          ...input().head,
          rows: rows.map((row) => {
            if (row.id !== "threads.read") return row
            const { limit: _limit, ...properties } = row.input.properties
            return {
              ...row,
              input: { ...row.input, properties },
              tool: row.tool.map((entry) => ({ ...entry, reads: entry.reads.filter((name) => name !== "limit") })),
            }
          }),
        },
      }),
    )
    expect(report.failures.filter((line) => line.startsWith("threads.read: its descriptor changed"))).toHaveLength(1)
  })

  test("#given an unchanged control #then the rolled-back threads.read is admitted", () => {
    expect(
      rowFailures("threads.read", (row) => {
        const { limit: _limit, ...properties } = row.input.properties
        return { ...row, input: { ...row.input, properties: { ...properties, limit: row.input.properties.limit } } }
      }),
    ).toEqual([])
  })

  test("#given the head rows against the rolled-back base #then the listed fields and aliases are admitted and reported", () => {
    const report = rowReport("threads.list", (row) => row)
    expect(report.failures.filter((line) => line.startsWith("threads.list:"))).toEqual([])
    expect(report.toolAhead).toContain("threads.list")
  })

  test("#given an unlisted property added to the row #then it fails", () => {
    expect(
      rowFailures("threads.list", (row) => ({
        ...row,
        input: { ...row.input, properties: { ...row.input.properties, extra: { type: "string" } } },
      })),
    ).toHaveLength(1)
  })

  test("#given an unlisted property removed from the row #then it fails", () => {
    expect(
      rowFailures("threads.list", (row) => {
        const { archived: _archived, ...properties } = row.input.properties
        return { ...row, input: { ...row.input, properties } }
      }),
    ).toHaveLength(1)
  })

  const judge = (base: readonly Row[], head: readonly Row[], entries = unresolved.entries) =>
    gateReport(
      input({
        base: { ...input().base, rows: base, unresolved: withoutAhead(unresolved.entries) },
        head: { ...input().head, rows: head, unresolved: entries },
      }),
    ).failures
  const editRow = (source: readonly Row[], id: string, edit: (row: Row) => Row) =>
    source.map((row) => (row.id === id ? edit(row) : row))

  test("#given a listed name the base branch already reads, where only an alias changes #then it fails", () => {
    const entries = unresolved.entries.map((entry) =>
      entry.id === "threads.read" && entry.toolAhead !== undefined
        ? { ...entry, toolAhead: { ...entry.toolAhead, fields: [...(entry.toolAhead.fields ?? []), "cursor"] } }
        : entry,
    )
    expect(
      judge(baseRows, rows, entries).filter((line) => line.startsWith("threads.read: its descriptor")),
    ).toHaveLength(1)
  })

  test.each([
    [
      "removed",
      (aliases: Record<string, string>) =>
        Object.fromEntries(Object.entries(aliases).filter(([name]) => name !== "search")),
    ],
    [
      "remapped to another field the branch reads",
      (aliases: Record<string, string>) => ({ ...aliases, search: "state" }),
    ],
  ])("#given a base alias %s #then it fails", (_how, change) => {
    const head = editRow(rows, "threads.list", (row) => ({
      ...row,
      tool: row.tool.map((entry) => ({ ...entry, aliases: change({ ...(entry.aliases ?? {}) }) })),
    }))
    expect(
      judge(withAliasesOnBase, head).filter((line) => line.startsWith("threads.list: its descriptor")),
    ).toHaveLength(1)
  })

  test("#given an alias to a field its branch does not read #then the row is refused", () => {
    const row = { ...list, tool: list.tool.map((entry) => ({ ...entry, aliases: { search: "device" } })) }
    expect(registryProblems(file(row))).toContainEqual(expect.stringContaining('alias "search" maps to "device"'))
  })

  test("#given an alias equal to a real field #then the row is refused", () => {
    const row = { ...list, tool: list.tool.map((entry) => ({ ...entry, aliases: { state: "query" } })) }
    expect(registryProblems(file(row))).toContainEqual(expect.stringContaining('alias "state" is a real field'))
  })
})

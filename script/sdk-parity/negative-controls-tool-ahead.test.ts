import { describe, expect, test } from "bun:test"

import type { BaselineEntry } from "./baseline"
import { gateReport } from "./gate"
import { input, rows, unresolved } from "./gate-fixture"
import type { FieldSchema, Row } from "./schema"
import { registryProblems } from "./schema"
import type { Scenario } from "./scenarios"

// Negative controls of design 7.6 for the tool-ahead rule (LEAD ruling on #15076): each breaks one condition and must
// fail; the first case is the admitted change they are measured against.

const withoutAhead = (entries: readonly BaselineEntry[]): BaselineEntry[] =>
  entries.map(({ toolAhead: _ahead, ...entry }) => entry)
const tool = (name: string, properties: Record<string, FieldSchema>) => [{ name, parameters: { properties } }]
const run = (
  name: string,
  before: Record<string, FieldSchema>,
  after: Record<string, FieldSchema>,
  base: readonly BaselineEntry[] = withoutAhead(unresolved.entries),
) =>
  gateReport(
    input({
      base: { ...input().base, tools: tool(name, before), unresolved: base },
      head: { ...input().head, tools: tool(name, after) },
    }),
  )
const named = (failures: readonly string[], tool: string) => failures.filter((line) => line.includes(`tool ${tool} `))
const runParams = (name: string, before: object, after: object) =>
  gateReport(
    input({
      base: { ...input().base, tools: [{ name, parameters: before }], unresolved: withoutAhead(unresolved.entries) },
      head: { ...input().head, tools: [{ name, parameters: after }] },
    }),
  )
const state = { type: "array", items: { anyOf: [{ type: "string", const: "idle" }] } }
// The merge base as the entries describe it: each row without the fields its entry lists and without aliases.
const listedOf = (id: string) => new Set(unresolved.entries.find((entry) => entry.id === id)?.toolAhead?.fields ?? [])
const baseRows = rows.map((row): Row => {
  const listed = listedOf(row.id)
  return {
    ...row,
    input: {
      ...row.input,
      properties: Object.fromEntries(Object.entries(row.input.properties).filter(([name]) => !listed.has(name))),
    },
    tool: row.tool.map(({ aliases: _aliases, ...entry }) => ({
      ...entry,
      reads: entry.reads.filter((name) => !listed.has(name)),
    })),
  }
})
const rowReport = (id: string, edit: (row: Row) => Row) =>
  gateReport(
    input({
      base: { ...input().base, rows: baseRows, unresolved: withoutAhead(unresolved.entries) },
      head: { ...input().head, rows: rows.map((row) => (row.id === id ? edit(row) : row)) },
    }),
  )
const rowFailures = (id: string, edit: (row: Row) => Row) =>
  rowReport(id, edit).failures.filter((line) => line.startsWith(`${id}: its descriptor changed`))
const file = (row: Row) => [{ domain: "threads", rows: [row], tables: [] }]
const list = rows.find((row) => row.id === "threads.list") as Row

describe("negative controls: the tool-ahead rule", () => {
  test("#given a listed optional field added in the pull request that adds the entry #then it passes and is reported", () => {
    const report = run(
      "thread_list",
      { all_scope: { type: "boolean" } },
      { all_scope: { type: "boolean" }, query: { type: "string" } },
    )
    expect(named(report.failures, "thread_list")).toEqual([])
    expect(report.toolAhead).toContain("threads.list")
  })

  test("#given a listed field removed #then it fails", () => {
    const report = run("thread_list", { query: { type: "string" } }, {})
    expect(named(report.failures, "thread_list")[0]).toContain("thread_list.query: removed")
  })

  test("#given a widened field whose bound is narrowed #then it fails", () => {
    const report = run(
      "thread_read",
      { wait_ms: { type: "integer", minimum: 0 } },
      { wait_ms: { type: "integer", minimum: 1 } },
    )
    expect(named(report.failures, "thread_read")[0]).toContain("thread_read.wait_ms: minimum narrowed")
  })

  test("#given an added field the entry does not list #then it fails", () => {
    const report = run("thread_list", {}, { state: { type: "array" } })
    expect(named(report.failures, "thread_list")[0]).toContain("thread_list.state: added but not listed")
  })

  test("#given the entry already on the merge base #then it admits nothing", () => {
    const report = run("thread_list", {}, { query: { type: "string" } }, unresolved.entries)
    expect(named(report.failures, "thread_list").length).toBeGreaterThan(0)
  })

  test("#given a widened field whose type changes #then it fails", () => {
    const report = run(
      "thread_read",
      { wait_ms: { type: "integer", minimum: 1 } },
      { wait_ms: { type: "number", minimum: 0 } },
    )
    expect(named(report.failures, "thread_read")[0]).toContain("thread_read.wait_ms: type")
  })

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

  test.each([
    ["additionalProperties false added at the top", { additionalProperties: false }],
    ["a top-level anyOf added", { anyOf: [{ required: ["query"] }, { required: ["state"] }] }],
    ["the top type changed", { type: "array" }],
  ])("#given %s #then it fails", (_name, extra) => {
    const before = { type: "object", properties: { query: { type: "string" } } }
    const report = runParams("thread_list", before, { ...before, ...extra })
    expect(report.failures.filter((line) => line.startsWith("threads.list: tool thread_list")).length).toBeGreaterThan(
      0,
    )
  })

  test("#given a widened field whose maximum is lowered #then it fails", () => {
    const report = run(
      "thread_read",
      { wait_ms: { type: "integer", minimum: 1, maximum: 10 } },
      { wait_ms: { type: "integer", minimum: 0, maximum: 5 } },
    )
    expect(named(report.failures, "thread_read")[0]).toContain("wait_ms: maximum narrowed")
  })

  test("#given a tool field made required #then it fails", () => {
    const report = runParams("thread_list", { properties: { state } }, { properties: { state }, required: ["state"] })
    expect(named(report.failures, "thread_list")[0]).toContain("required changed")
  })

  test("#given an existing field the entry does not widen whose enum grows #then it fails", () => {
    const grown = {
      type: "array",
      items: {
        anyOf: [
          { type: "string", const: "idle" },
          { type: "string", const: "x" },
        ],
      },
    }
    const report = run("thread_list", { state }, { state: grown })
    expect(named(report.failures, "thread_list").length).toBeGreaterThan(0)
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

  test("#given an entry on a row whose own branch did not change #then it admits and reports nothing", () => {
    const entries = unresolved.entries.map((entry) =>
      entry.id === "threads.receipt"
        ? { ...entry, toolAhead: { pr: "#15076", until: "T1b", fields: ["limit"] } }
        : entry,
    )
    const report = gateReport(
      input({
        base: {
          ...input().base,
          tools: tool("thread_read", { thread: { type: "string" } }),
          unresolved: withoutAhead(unresolved.entries),
        },
        head: {
          ...input().head,
          tools: tool("thread_read", { thread: { type: "string" }, limit: { type: "integer" } }),
          unresolved: entries,
        },
      }),
    )
    expect(report.toolAhead).not.toContain("threads.receipt")
  })

  test("#given an alias-marked scenario for a field the base already has #then base and head are still compared", () => {
    const scenario: Scenario = {
      id: "marked",
      capability: "threads.list",
      surface: "tool",
      tool: "thread_list",
      args: { state: ["idle"] },
      alias: { row: "threads.list", field: "state" },
    }
    const report = gateReport(
      input({
        scenarios: [scenario],
        base: {
          ...input().base,
          outcomes: { marked: { result: { kind: "ok" } } },
          unresolved: withoutAhead(unresolved.entries),
        },
        head: { ...input().head, outcomes: { marked: { result: { kind: "error" } } } },
      }),
    )
    expect(report.failures).toContainEqual(expect.stringContaining("scenario marked answers differently"))
  })

  test("#given an alias to a field its branch does not read #then the row is refused", () => {
    const row = { ...list, tool: list.tool.map((entry) => ({ ...entry, aliases: { search: "device" } })) }
    expect(registryProblems(file(row))).toContainEqual(expect.stringContaining('alias "search" maps to "device"'))
  })

  test("#given an alias equal to a real field #then the row is refused", () => {
    const row = { ...list, tool: list.tool.map((entry) => ({ ...entry, aliases: { state: "query" } })) }
    expect(registryProblems(file(row))).toContainEqual(expect.stringContaining('alias "state" is a real field'))
  })

  test("#given an alias that answers unlike its field, or a disagreeing pair that is not refused #then both fail", () => {
    const alias = (id: string, extra: object): Scenario => ({
      id,
      capability: "threads.list",
      surface: "tool",
      tool: "thread_list",
      args: {},
      alias: { row: "threads.list", ...extra },
    })
    const report = gateReport(
      input({
        scenarios: [alias("a-field", {}), alias("a", { twin: "a-field" }), alias("a-conflict", { conflict: true })],
        head: {
          ...input().head,
          outcomes: {
            "a-field": { result: { kind: "ok" } },
            a: { result: { kind: "error" } },
            "a-conflict": { result: { kind: "ok" } },
          },
        },
      }),
    )
    expect(report.failures).toContainEqual(expect.stringContaining("alias scenario a answers differently from a-field"))
    expect(report.failures).toContainEqual(expect.stringContaining("alias scenario a-conflict must be refused"))
  })
})

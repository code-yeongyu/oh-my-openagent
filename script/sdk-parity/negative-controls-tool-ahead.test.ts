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
    const report = run("thread_list", {}, { bogus: { type: "string" } })
    expect(named(report.failures, "thread_list")[0]).toContain("thread_list.bogus: added but not listed")
  })

  test("#given the entry already on the merge base #then it admits nothing", () => {
    const report = run("thread_list", {}, { query: { type: "string" } }, unresolved.entries)
    expect(named(report.failures, "thread_list").length).toBeGreaterThan(0)
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

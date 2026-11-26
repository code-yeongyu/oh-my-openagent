import { describe, expect, test } from "bun:test"
import { gateReport } from "./gate"
import { input, rows, unresolved } from "./gate-fixture"
import type { Row } from "./schema"
import type { Scenario } from "./scenarios"
import { withoutAhead, tool, state, baseRows, list, withAliasesOnBase } from "./tool-ahead-fixture"

// Negative controls of design 7.6 for the tool-ahead rule (LEAD ruling on #15076), alias scenarios: each breaks one
// condition and must fail, measured against the admitted change.

describe("negative controls: the tool-ahead rule, alias scenarios", () => {
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

  const marked = (
    args: Record<string, unknown>,
    alias: NonNullable<Extract<Scenario, { surface: "tool" }>["alias"]>,
    base: readonly Row[] = baseRows,
  ) =>
    gateReport(
      input({
        scenarios: [{ id: "x", capability: "threads.read", surface: "tool", tool: "thread_read", args, alias }],
        base: {
          ...input().base,
          rows: base,
          outcomes: { x: { result: { kind: "ok" } } },
          unresolved: withoutAhead(unresolved.entries),
        },
        head: { ...input().head, outcomes: { x: { result: { kind: "error", error: { code: "invalid_arguments" } } } } },
      }),
    ).failures.some((line) => line.includes("scenario x answers differently"))

  test("#given a mark naming another real row that lacks an alias its own row declares #then base and head are compared", () => {
    // given only threads.read declares tail on the base; threads.readAfterWait reads limit through the same tool
    const base = withAliasesOnBase.map((row): Row =>
      row.id === "threads.readAfterWait"
        ? { ...row, tool: row.tool.map(({ aliases: _aliases, ...entry }) => entry) }
        : row,
    )

    // when the threads.read scenario's mark points at threads.readAfterWait
    const compared = marked(
      { thread: "t", tail: 3 },
      { row: "threads.readAfterWait", field: "limit", name: "tail" },
      base,
    )

    // then
    expect(compared).toBe(true)
  })

  test.each([
    ["an alias that exists nowhere", { row: "threads.read", field: "limit", name: "no-such-alias" }],
    ["a field that exists nowhere", { row: "threads.read", field: "no-such-field" }],
    ["a row that does not exist", { row: "no.such.row", field: "max_bytes" }],
    ["another row whose tool is not this one", { row: "threads.send", field: "max_bytes" }],
    ["an alias the args do not contain", { row: "threads.read", field: "limit", name: "tail" }],
    ["a field the base branch already reads", { row: "threads.read", field: "max_bytes" }],
  ])(
    "#given a scenario exercising an existing field whose mark names %s #then base and head are compared",
    (_name, alias) => {
      expect(marked({ thread: "t", max_bytes: 4096 }, alias)).toBe(true)
    },
  )

  test("#given a scenario on its own row through a tool that row has no branch for #then base and head are compared", () => {
    const failures = gateReport(
      input({
        scenarios: [
          {
            id: "x",
            capability: "threads.read",
            surface: "tool",
            tool: "thread_send",
            args: { thread: "t", max_bytes: 4096 },
            alias: { row: "threads.read", field: "max_bytes" },
          },
        ],
        base: {
          ...input().base,
          rows: baseRows,
          outcomes: { x: { result: { kind: "ok" } } },
          unresolved: withoutAhead(unresolved.entries),
        },
        head: { ...input().head, outcomes: { x: { result: { kind: "error", error: { code: "invalid_arguments" } } } } },
      }),
    ).failures
    expect(failures.some((line) => line.includes("scenario x answers differently"))).toBe(true)
  })

  test("#given a generated alias scenario whose alias the base already declares #then it is compared", () => {
    expect(
      marked({ thread: "t", tail: 3 }, { row: "threads.read", field: "limit", name: "tail" }, withAliasesOnBase),
    ).toBe(true)
  })

  test("#given a generated alias scenario whose alias is new on the head #then it is exempt", () => {
    expect(marked({ thread: "t", tail: 3 }, { row: "threads.read", field: "limit", name: "tail" })).toBe(false)
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

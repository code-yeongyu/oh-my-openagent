import { describe, expect, test } from "bun:test"
import { gateReport } from "./gate"
import { input, unresolved } from "./gate-fixture"
import { withoutAhead, tool, run, named, runParams, state, list } from "./tool-ahead-fixture"

// Negative controls of design 7.6 for the tool-ahead rule (LEAD ruling on #15076), tool schemas: each breaks one
// condition and must fail, measured against the admitted change.

describe("negative controls: the tool-ahead rule, tool schemas", () => {
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
})

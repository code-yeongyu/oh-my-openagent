import { describe, expect, it } from "bun:test"
import { rendererVisibleWidth, type ResolvedModelRecord } from "@oh-my-opencode/senpi-task"
import { runRows, type DagRunRowsOptions, type DagStatusNode, type DagStatusRunSnapshot } from "./dag-status-row-format"
import { createDagStatusUi } from "./dag-status-ui"

const NOW = Date.parse("2026-09-12T12:00:00Z")
type DisplayRecord = NonNullable<ReturnType<NonNullable<DagRunRowsOptions["taskRecord"]>>>
const RESOLVED: ResolvedModelRecord = { provider: "mock", model_id: "luna", display: "mock/luna", source: "category", reasoning: "low" }

function node(overrides: Partial<DagStatusNode> = {}): DagStatusNode {
  return {
    id: "memory", state: "running", route: { kind: "category", category: "quick" },
    taskId: "st_first", dependsOn: [], startedAt: new Date(NOW - 65_000).toISOString(),
    ...overrides,
  }
}

function snapshot(nodes: readonly DagStatusNode[]): DagStatusRunSnapshot {
  return { runId: "dag_model", name: "models", status: "running", nodes, waves: [{ index: 0, nodeIds: nodes.map((n) => n.id) }] }
}

function render(record: Partial<DisplayRecord> | undefined, overrides: Partial<DagStatusNode> = {}): string {
  return runRows(snapshot([node(overrides)]), undefined, { now: NOW, taskRecord: () => record === undefined ? undefined : { model: "", ...record } })[1] ?? ""
}

describe("DAG attached task model", () => {
  it.each([
    [{ ...RESOLVED, reasoning_effort: "high", variant: "max" }, "low"],
    [{ ...RESOLVED, reasoning: undefined, reasoning_effort: "high", variant: "max" }, "high"],
    [{ ...RESOLVED, reasoning: undefined, variant: "max" }, "max"],
  ] satisfies readonly (readonly [ResolvedModelRecord, string])[])("#given resolved tuning %j #when rendered #then effort is %s", (resolved, effort) => {
    // given / when
    const row = render({ model: "stale/default:medium", resolved_model: resolved })
    // then
    expect(row.split(" · ")[1]).toBe(`category:quick(mock/luna:${effort})`)
    expect(row).not.toContain("stale")
  })

  it.each(["completed", "failed", "cancelled", "skipped"])("#given a %s node #when rendered #then its last attached model remains", (state) => {
    // given / when
    const row = render({ resolved_model: RESOLVED }, { state, completedAt: new Date(NOW - 5_000).toISOString() })
    // then
    expect(row.split(" · ")[1]).toBe("category:quick(mock/luna:low)")
    expect(row).toEndWith("1m 0s")
  })

  it("#given an agent with a stale explicit selector #when resolved metadata exists #then the actual model wins", () => {
    // given / when
    const row = render({ resolved_model: RESOLVED }, { route: { kind: "agent", agent: "explore", model: "stale/model" } })
    // then
    expect(row.split(" · ")[1]).toBe("agent:explore(mock/luna:low)")
  })

  it.each([
    [undefined, "category:quick"],
    [{ model: "" }, "category:quick"],
    [{ model: "mock/raw:medium" }, "category:quick(mock/raw:medium)"],
    [{ model: "mock/raw:medium", resolved_model: { ...RESOLVED, provider: "", model_id: "invalid" } }, "category:quick(mock/raw:medium)"],
    [{ model: "", resolved_model: { ...RESOLVED, reasoning: undefined } }, "category:quick(mock/luna)"],
  ] satisfies readonly (readonly [DisplayRecord | undefined, string])[])("#given incomplete metadata %j #when rendered #then the safe target is %s", (record, target) => {
    // given / when
    const row = render(record)
    // then
    expect(row.split(" · ")[1]).toBe(target)
  })

  it("#given a taskless waiting node #when rendered #then no task resolution is invented or queried", () => {
    // given
    const lookups: string[] = []
    const waiting = node({ taskId: undefined, state: "blocked", startedAt: undefined, createdAt: new Date(NOW - 9_000).toISOString() })
    // when
    const rows = runRows(snapshot([waiting]), undefined, { now: NOW, taskRecord: (id) => { lookups.push(id); return { model: "", resolved_model: RESOLVED } } })
    // then
    expect(lookups).toEqual([])
    expect(rows[1]?.split(" · ")[1]).toBe("category:quick")
    expect(rows[1]).toEndWith("waiting 9s")
  })

  it.each([50, 60, 80, 120, 220])("#given %i columns and long activity #when rendered #then model detail survives within the row budget", (maxWidth) => {
    // given
    const current = node({ attempt: 2 })
    // when
    const rows = runRows(snapshot([current]), new Map([[current.id, "inspecting ".repeat(40)]]), {
      now: NOW, maxWidth, taskRecord: () => ({ model: "", resolved_model: RESOLVED }),
    })
    // then
    const row = rows[1] ?? ""
    expect(row).toContain("mock/")
    if (maxWidth >= 80) expect(row).toContain("mock/luna:low)")
    expect(row).toContain("x2")
    expect(row).toEndWith("1m 5s")
    expect(rendererVisibleWidth(row)).toBeLessThanOrEqual(maxWidth)
  })

  it("#given terminal controls and wide glyphs in metadata #when rendered #then output is sanitized and width bounded", () => {
    // given / when
    const rows = runRows(snapshot([node({ label: "메모리 검토" })]), undefined, {
      now: NOW, maxWidth: 80,
      taskRecord: () => ({ model: "", resolved_model: { ...RESOLVED, provider: "mock\u001b[31m", model_id: "luna\n모델", reasoning: "low\r" } }),
    })
    // then
    expect(rows[1]).not.toMatch(/[\u001b\r\n]/)
    expect(rows[1]).toContain("mock/luna 모델:low")
    expect(rendererVisibleWidth(rows[1] ?? "")).toBeLessThanOrEqual(80)
  })
})

describe("DAG widget model refresh", () => {
  it("#given an 80-column host with padded text widgets #when activity fills a model row #then elapsed stays on the same line", () => {
    // given
    let rendered: string[] = []
    const ui = createDagStatusUi({
      manager: { list: () => [{ runId: "dag_model", status: "running" }], snapshot: () => snapshot([node()]) },
      taskRecord: () => ({ model: "", resolved_model: RESOLVED }),
      now: () => NOW, terminalWidth: () => 80,
      timers: { set: () => 1, clear: () => undefined },
      runtime: {
        sessionId: () => "owner", mode: () => "tui",
        ui: () => ({
          notify: () => undefined, setStatus: () => undefined,
          setWidget: (_key, rows) => { rendered = rows ?? [] },
          select: async () => undefined, confirm: async () => false,
        }),
      },
    })
    ui.onActivity({ runId: "dag_model", nodeId: "memory", taskId: "st_first", activity: "inspecting ".repeat(30), turns: 1 })
    // when
    ui.syncNow()
    ui.dispose()
    // then: Senpi wraps string widgets in Text(line, 1, 0).
    expect(rendererVisibleWidth(rendered[1] ?? "") + 2).toBeLessThanOrEqual(80)
    expect(rendered[1]).toContain("mock/luna:low)")
    expect(rendered[1]).toEndWith("1m 5s")
  })

  it.each(["fallback", "retry", "missing"])("#given a painted task #when %s changes its record #then the refresh uses the current attachment", (change) => {
    // given
    let current = node()
    const records = new Map<string, DisplayRecord>([["st_first", { model: "", resolved_model: RESOLVED }]])
    let rendered: string[] = []
    const callbacks = new Map<number, () => void>()
    let timerId = 0
    const ui = createDagStatusUi({
      manager: { list: () => [{ runId: "dag_model", status: "running" }], snapshot: () => snapshot([current]) },
      taskRecord: (id) => records.get(id),
      now: () => NOW, terminalWidth: () => 120,
      timers: {
        set: (callback) => { callbacks.set(++timerId, callback); return timerId },
        clear: (id) => { if (typeof id === "number") callbacks.delete(id) },
      },
      runtime: {
        sessionId: () => "owner", mode: () => "tui",
        ui: () => ({
          notify: () => undefined, setStatus: () => undefined,
          setWidget: (_key, rows) => { rendered = rows ?? [] },
          select: async () => undefined, confirm: async () => false,
        }),
      },
    })
    ui.syncNow()
    expect(rendered[1]).toContain("mock/luna:low")
    switch (change) {
      case "fallback": records.set("st_first", { model: "", resolved_model: { ...RESOLVED, provider: "other", model_id: "sol", reasoning: "high" } }); break
      case "retry":
        records.set("st_second", { model: "other/sol:high" })
        current = node({ taskId: "st_second", attempt: 2 })
        break
      case "missing": records.delete("st_first"); break
    }
    // when: the existing live refresh fires; no new DAG event is needed.
    const pending = [...callbacks.values()]
    callbacks.clear()
    for (const callback of pending) callback()
    ui.dispose()
    // then
    expect(rendered[1]?.split(" · ")[1]).toBe(change === "missing" ? "category:quick" : "category:quick(other/sol:high)")
    expect(rendered[1]).not.toContain("mock/luna")
    if (change === "retry") expect(rendered[1]).toContain("x2")
    expect(callbacks.size).toBe(0)
  })
})

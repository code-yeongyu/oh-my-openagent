import { describe, expect, it } from "bun:test"

import { rendererVisibleWidth, type TaskRecord, type TaskStatus } from "@oh-my-opencode/senpi-task"

import { backgroundWidgetRows, buildWidgetRows, formatTaskRow } from "./status-row-format"

function record(overrides: Partial<TaskRecord> & { task_id: string; status: TaskStatus }): TaskRecord {
  return {
    parent_session_id: "session-a",
    root_session_id: "session-a",
    depth: 0,
    execution_mode: "in-process",
    model: "anthropic/claude-sonnet-4-6",
    residency_state: "resident",
    created_at: "2026-07-07T00:00:00.000Z",
    updated_at: "2026-07-07T00:00:01.000Z",
    notification: { run_epoch: 0, notified_epoch: -1 },
    notify_on_terminal: false,
    ...overrides,
  }
}

function longActiveRecord(): TaskRecord {
  return record({
    task_id: "st_01active0123456789",
    name: "active-child",
    status: "running",
    category: "ultrabrain",
    resolved_model: {
      provider: "omo-mock",
      model_id: "mock-1",
      display: "omo-mock/mock-1",
      reasoning_effort: "xhigh",
      variant: "xhigh",
      source: "category",
    },
  })
}

describe("buildWidgetRows", () => {
  it("#given active and completed records #when selecting rows #then only resident team members follow active rows before the cap", () => {
    const alpha = record({ task_id: "st_alpha", name: "team:12345678-1234-1234-1234-123456789abc:alpha", task_summary: "settled alpha", status: "completed" })
    const beta = record({ task_id: "st_beta", name: "team:12345678-1234-1234-1234-123456789abc:beta", task_summary: "settled beta", status: "completed" })
    const ordinary = record({ task_id: "st_ordinary", task_summary: "ordinary task", status: "completed" })
    const stale = record({ task_id: "st_stale", name: "team:12345678-1234-1234-1234-123456789abc:stale", task_summary: "stale member", status: "completed" })
    const active = Array.from({ length: 4 }, (_value, index) => record({ task_id: `st_${index}`, status: "running" }))
    const rows = buildWidgetRows([alpha, ordinary, stale, ...active, beta], new Set([alpha.task_id, beta.task_id, ordinary.task_id]))
    expect(rows.slice(0, 4).every((row) => row.includes("running"))).toBe(true)
    expect(rows[4]).toContain("settled alpha")
    expect(rows[4]).toContain("completed")
    expect(rows[5]).toBe("+1 more")
    expect(rows.join("\n")).not.toMatch(/ordinary task|stale member/u)
  })

  it("#given an active task #when building a row #then useful identity and execution context remain", () => {
    const row = buildWidgetRows([
      record({ task_id: "st_row", name: "finder", status: "running", agent_type: "explore", pid: 4242 }),
    ])[0] ?? ""
    expect(row).toContain("finder")
    expect(row).toContain("agent:explore")
    expect(row).toContain("anthropic/")
    expect(row).toContain("in-process")
    expect(row).toContain("running")
    expect(rendererVisibleWidth(row)).toBeLessThanOrEqual(72)
  })

  it("#given a 137-column active task #when building its widget row #then it remains one physical line", () => {
    const row = buildWidgetRows([longActiveRecord()])[0] ?? ""
    expect(row).not.toContain("\n")
    for (const columns of [70, 72, 120]) expect(rendererVisibleWidth(row)).toBeLessThanOrEqual(columns)
    expect(row).toContain("category:ultrabrain")
    expect(row).toContain("omo-mock/mock-1")
    expect(row).toContain("xhigh")
    expect(row).toContain("in-process")
    expect(row).toContain("running")
  })
})

describe("task_summary identity", () => {
  it("#given a record with a task_summary #when building the widget row #then the summary leads over name and description", () => {
    const row = buildWidgetRows([
      record({ task_id: "st_sum", name: "finder", description: "quick label", task_summary: "Audit auth session flow", status: "running", category: "quick" }),
    ])[0] ?? ""
    expect(row.startsWith("Audi")).toBe(true)
    expect(row).not.toContain("finder")
    expect(row).not.toContain("quick label")
  })

  it("#given a record with a task_summary #when formatting the full row #then the summary is the identity", () => {
    const row = formatTaskRow(record({ task_id: "st_sum", name: "finder", task_summary: "Audit auth session flow", status: "running" }))
    expect(row.startsWith("Audit auth session flow")).toBe(true)
  })
})

describe("backgroundWidgetRows", () => {
  const now = Date.parse("2026-07-07T00:01:00.000Z")
  const stats = {
    turns: 2,
    tool_calls: 4,
    runtime_ms: 60_000,
    cost_usd: 0.1303,
    cache_hit_rate_last: 0.89,
    tokens_per_second: 97,
  }

  it("#given a wide terminal #when a live task row renders #then the longer summary and adjacent metadata remain visible", () => {
    const row = backgroundWidgetRows([
      record({
        task_id: "st_wide",
        task_summary: "Plan the complete Spider-Man media library migration",
        status: "running",
        category: "unspecified-high",
        resolved_model: {
          provider: "anthropic",
          model_id: "claude-opus-5",
          display: "anthropic/claude-opus-5",
          reasoning_effort: "xhigh",
          source: "category",
        },
      }),
    ], new Map([["st_wide", "running read src/library.ts"]]), now, () => stats, 220)[0] ?? ""

    expect(row).toContain("Plan the complete Spider-Man media library migration")
    expect(row).toContain("category:unspecified-high(anthropic/claude-opus-5:xhigh)")
    expect(row).toContain("turn 2 (4 tools)")
    expect(row).toContain("$0.1303")
    expect(row).not.toContain("CH:")
    expect(row).toContain("97 tok/s")
    expect(row).toContain("running read src/library.ts")
    expect(row).toEndWith("1m 0s")
    expect(rendererVisibleWidth(row)).toBeLessThanOrEqual(220)
  })

  it("#given a narrow terminal #when a live task row renders #then it stays on one bounded physical line", () => {
    const row = backgroundWidgetRows([
      record({
        task_id: "st_narrow",
        task_summary: "Plan the complete Spider-Man media library migration",
        status: "running",
        category: "unspecified-high",
      }),
    ], new Map([["st_narrow", "running"]]), now, () => stats, 90)[0] ?? ""

    expect(row).not.toContain("\n")
    expect(rendererVisibleWidth(row)).toBeLessThanOrEqual(90)
    expect(row).toContain("Plan")
    expect(row).toContain("category:unspec")
    expect(row).toContain("running")
    expect(row).toEndWith("1m 0s")
  })
})

describe("suspended residency labeling", () => {
  it("#given a persisted_only record #when formatting a full row #then the status shows suspended", () => {
    const row = formatTaskRow(record({ task_id: "st_susp", status: "running", residency_state: "persisted_only" }))
    expect(row).toContain("suspended")
    expect(row).not.toContain("status:running")
  })

  it("#given an rpc_detached record #when formatting a full row #then the status shows suspended", () => {
    const row = formatTaskRow(record({ task_id: "st_susp", status: "running", residency_state: "rpc_detached" }))
    expect(row).toContain("suspended")
    expect(row).not.toContain("status:running")
  })

  it("#given a resident record #when formatting a full row #then the status label is unchanged (regression pin)", () => {
    const row = formatTaskRow(record({ task_id: "st_live", status: "running", residency_state: "resident" }))
    expect(row).toContain("status:running")
    expect(row).not.toContain("suspended")
  })

  it("#given a persisted_only record #when building a widget row #then it contains suspended", () => {
    const row = buildWidgetRows([record({ task_id: "st_susp", status: "running", residency_state: "persisted_only" })])
    expect(row.length).toBeGreaterThan(0)
    expect(row[0]).toContain("suspended")
  })

  it("#given an rpc_detached record #when building a widget row #then it contains suspended", () => {
    const row = buildWidgetRows([record({ task_id: "st_susp", status: "running", residency_state: "rpc_detached" })])
    expect(row.length).toBeGreaterThan(0)
    expect(row[0]).toContain("suspended")
  })

  it("#given a persisted_only record #when building a background widget row #then it contains suspended", () => {
    const now = Date.parse("2026-07-07T00:01:00.000Z")
    const row = backgroundWidgetRows([record({ task_id: "st_susp", status: "running", residency_state: "persisted_only" })], new Map([]), now, () => undefined, 220)[0] ?? ""
    expect(row).toContain("suspended")
  })
})

describe("formatTaskRow", () => {
  it("#given resolved category metadata #when formatting #then the unified target carries the model and effort", () => {
    const task = record({
      task_id: "st_resolved",
      name: "planner",
      status: "running",
      category: "ultrabrain",
      execution_mode: "rpc",
      model: "category/raw-fallback",
      resolved_model: {
        provider: "openai",
        model_id: "gpt-5.6-sol",
        display: "openai/gpt-5.6-sol",
        reasoning_effort: "xhigh",
        variant: "sol",
        source: "category",
      },
    })
    expect(formatTaskRow(task)).toBe(
      "planner (st_resolved) category:ultrabrain(openai/gpt-5.6-sol:xhigh) mode:rpc status:running",
    )
  })

  it("#given a description #when formatting #then the human label leads", () => {
    const row = formatTaskRow(record({
      task_id: "st_described",
      name: "task-2",
      description: "Audit the waiting line",
      status: "running",
      category: "quick",
    }))
    expect(row).toStartWith("Audit the waiting line (st_described) category:quick")
  })

  it("#given no resolved model #when formatting #then raw model remains", () => {
    const row = formatTaskRow(record({
      task_id: "st_legacy",
      status: "running",
      agent_type: "explore",
      model: "anthropic/claude-sonnet-4-6",
    }))
    expect(row).toBe("st_legacy agent:explore(anthropic/claude-sonnet-4-6) mode:in-process status:running")
  })

  it("#given empty resolved detail labels #when formatting #then they are omitted", () => {
    const row = formatTaskRow(record({
      task_id: "st_empty",
      status: "running",
      category: "ultrabrain",
      model: "category/raw-fallback",
      resolved_model: {
        provider: "google",
        model_id: "gemini-3.1-pro",
        display: "google/gemini-3.1-pro",
        reasoning_effort: "",
        variant: "",
        source: "category",
      },
    }))
    expect(row).toBe("st_empty category:ultrabrain(google/gemini-3.1-pro) mode:in-process status:running")
  })

  it("#given matching reasoning and variant #when formatting #then the effort renders once inside the target", () => {
    const row = formatTaskRow(longActiveRecord())
    expect(row).toContain("category:ultrabrain(omo-mock/mock-1:xhigh)")
    expect(row).not.toContain("variant:")
    expect(row).not.toContain("reasoning:")
  })

  it("#given malformed running progress #when formatting #then the excerpt is width-safe", () => {
    const row = formatTaskRow(record({
      task_id: "st_cjk",
      status: "running",
      agent_type: "explore",
      final_response: `${"界".repeat(40)}tail`,
    }))
    const progressPrefix = " progress:"
    const progressIndex = row.indexOf(progressPrefix)
    const progress = progressIndex >= 0 ? row.slice(progressIndex + progressPrefix.length) : ""
    expect(progress).toContain("...")
    expect(progress).not.toContain("tail")
    expect(rendererVisibleWidth(progress)).toBeLessThanOrEqual(60)
  })
})

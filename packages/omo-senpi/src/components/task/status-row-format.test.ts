import { describe, expect, it } from "bun:test"

import { rendererVisibleWidth, type TaskRecord, type TaskStatus } from "@oh-my-opencode/senpi-task"

import { buildWidgetRows, formatTaskRow } from "./status-row-format"

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
  it("#given more than five active tasks #when building rows #then it caps at five and adds a +N more row", () => {
    const records = Array.from({ length: 7 }, (_value, index) => record({ task_id: `st_${index}`, status: "running" }))
    const rows = buildWidgetRows(records)
    expect(rows).toHaveLength(6)
    expect(rows[5]).toBe("+2 more")
  })

  it("#given only terminal tasks #when building rows #then no rows render", () => {
    expect(buildWidgetRows([record({ task_id: "st_done", status: "completed" })])).toHaveLength(0)
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

describe("formatTaskRow", () => {
  it("#given resolved category metadata #when formatting #then target, model, reasoning, variant, mode, and status render", () => {
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
      "planner (st_resolved) category:ultrabrain model:openai/gpt-5.6-sol reasoning:xhigh variant:sol mode:rpc status:running",
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
    expect(row).toBe("st_legacy agent:explore model:anthropic/claude-sonnet-4-6 mode:in-process status:running")
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
    expect(row).toBe("st_empty category:ultrabrain model:google/gemini-3.1-pro mode:in-process status:running")
  })

  it("#given matching reasoning and variant #when formatting #then duplicate variant is omitted", () => {
    const row = formatTaskRow(longActiveRecord())
    expect(row).toContain("reasoning:xhigh")
    expect(row).not.toContain("variant:xhigh")
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

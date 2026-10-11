import { describe, expect, it } from "bun:test"

import { composeStatusLine, rendererVisibleWidth, type TaskRecord, type TaskStatus } from "@oh-my-opencode/senpi-task"

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
          model_id: "claude-opus-5-5",
          display: "anthropic/claude-opus-5-5",
          reasoning_effort: "xhigh",
          source: "category",
        },
      }),
    ], new Map([["st_wide", "running read src/library.ts"]]), now, () => stats, 220)[0] ?? ""

    expect(row).toContain("Plan the complete Spider-Man media library migration")
    expect(row).toContain("category:unspecified-high(anthropic/claude-opus-5-5:xhigh)")
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

describe("automatic recovery residency labeling", () => {
  it("every unfinished parked record shape renders recovery without a cancel hint", () => {
    for (const status of ["pending", "running"] as const) {
      for (const residency_state of ["resident", "persisted_only", "rpc_detached", "evicted", "disposed"] as const) {
        for (const suspension_reason of [undefined, "daemon_unavailable", "handoff_parked", "host_draining", "host_incompatible", "idle_evicted", "own_host_unreachable", "revival_deferred", "store_index_unavailable"] as const) {
          if (residency_state === "resident" && suspension_reason === undefined) continue
          const parked = record({ task_id: "st_recovery", status, residency_state, suspension_reason })
          const rows = [formatTaskRow(parked), ...buildWidgetRows([parked]),
            ...backgroundWidgetRows([parked], new Map(), 0, undefined, 90),
            ...backgroundWidgetRows([parked], new Map(), 0, undefined, 220)]
          for (const row of rows) {
            expect(row).toContain(suspension_reason === "host_incompatible" ? "ending" : "resuming")
            expect(row).not.toMatch(/suspended|\/task-kill/u)
          }
        }
      }
    }
  })
  it("#given a persisted_only record #when formatting a full row #then the status shows resuming", () => {
    const row = formatTaskRow(record({ task_id: "st_susp", status: "running", residency_state: "persisted_only" }))
    expect(row).toContain("resuming")
    expect(row).not.toContain("status:running")
  })

  it("#given an rpc_detached record #when formatting a full row #then the status shows resuming", () => {
    const row = formatTaskRow(record({ task_id: "st_susp", status: "running", residency_state: "rpc_detached" }))
    expect(row).toContain("resuming")
    expect(row).not.toContain("status:running")
  })

  it("#given a resident record #when formatting a full row #then the status label is unchanged (regression pin)", () => {
    const row = formatTaskRow(record({ task_id: "st_live", status: "running", residency_state: "resident" }))
    expect(row).toContain("status:running")
    expect(row).not.toContain("suspended")
  })

  it("#given a persisted_only record #when building a widget row #then it contains resuming", () => {
    const row = buildWidgetRows([record({ task_id: "st_susp", status: "running", residency_state: "persisted_only" })])
    expect(row.length).toBeGreaterThan(0)
    expect(row[0]).toContain("resuming")
  })

  it("#given an rpc_detached record #when building a widget row #then it contains resuming", () => {
    const row = buildWidgetRows([record({ task_id: "st_susp", status: "running", residency_state: "rpc_detached" })])
    expect(row.length).toBeGreaterThan(0)
    expect(row[0]).toContain("resuming")
  })

  it("#given a suspended background child #when the live row repaints over time #then it neither spins nor counts", () => {
    // given a child parked since 00:05 that the parent restarted away from
    const parked = record({
      task_id: "st_parked",
      task_summary: "parked child",
      status: "running",
      residency_state: "rpc_detached",
      created_at: "2026-07-07T00:00:00.000Z",
      updated_at: "2026-07-07T00:05:00.000Z",
    })
    const at = (iso: string) => backgroundWidgetRows([parked], new Map(), Date.parse(iso), () => undefined, 220)[0] ?? ""

    // when it repaints a quarter second later, and again hours later
    const first = at("2026-07-07T06:00:00.000Z")
    const later = at("2026-07-07T06:00:00.250Z")
    const muchLater = at("2026-07-07T09:30:00.000Z")

    // then the row is static, shows no running time, and says why and what to do
    expect(later).toBe(first)
    expect(muchLater).toBe(first)
    expect(first).toStartWith("‖ ")
    expect(first).not.toMatch(/\d+m \d+s|\b\d+s\b/u)
    expect(first).toContain("parent session restarted")
    expect(first).toContain("resuming")
    expect(first).not.toMatch(/suspended|\/task-kill|resumes on session restart/u)
  })

  it("#given a recovering child on a 118-column terminal #when building the live row #then no user action is needed", () => {
    // given a parked child and a common terminal width
    const parked = record({ task_id: "st_narrow", task_summary: "parked child", status: "running", residency_state: "persisted_only" })

    // when the live row renders at 118 columns
    const row = backgroundWidgetRows([parked], new Map(), Date.parse("2026-07-07T01:00:00.000Z"), () => undefined, 118)[0] ?? ""

    // then the recovery state survives the width budget without a user action
    expect(rendererVisibleWidth(row)).toBeLessThanOrEqual(118)
    expect(row).toContain("resuming (parent session restarted)")
    expect(row).not.toMatch(/suspended|\/task-kill/u)
  })

  it.each([
    ["cancelled", "disposed"],
    ["completed", "evicted"],
    ["error", "disposed"],
  ] as const)("#given a %s task whose residency is %s #when formatting rows #then it keeps its own status", (status, residency) => {
    // given a finished child, released from memory as finished children are
    const finished = record({ task_id: "st_done", status, residency_state: residency })

    // when the full and compact rows render
    const full = formatTaskRow(finished)
    const compact = buildWidgetRows([finished], new Set(["st_done"]))[0] ?? ""

    // then neither calls it suspended
    expect(full).toContain(`status:${status}`)
    expect(full).not.toContain("suspended")
    expect(compact).not.toContain("suspended")
  })

  it.each([
    ["an in-process child left by a parent restart", { residency_state: "persisted_only" }, "resumes on session restart"],
    ["a pending daemon-hosted child", { status: "pending", residency_state: "rpc_detached", runner_kind: "host-session", host_session: { socket: "/tmp/host.sock", routing_id: "route-1", session_path: "/tmp/child.jsonl", instance_id: "inst-1" }, suspension_reason: "own_host_unreachable" }, "resumes on session restart"],
    ["a running daemon-hosted child whose host was lost", { residency_state: "rpc_detached", runner_kind: "host-session", host_session: { socket: "/tmp/host.sock", routing_id: "route-1", session_path: "/tmp/child.jsonl", instance_id: "inst-1" }, suspension_reason: "own_host_unreachable" }, "resumes on session restart or a message"],
    ["a running daemon-hosted child evicted while idle", { residency_state: "rpc_detached", runner_kind: "host-session", host_session: { socket: "/tmp/host.sock", routing_id: "route-1", session_path: "/tmp/child.jsonl", instance_id: "inst-1" }, suspension_reason: "idle_evicted" }, "resumes on a message"],
    ["a child on an incompatible host", { residency_state: "rpc_detached", suspension_reason: "host_incompatible" }, "will not resume"],
    ["an in-process child whose deferred revival ends in lost", { residency_state: "persisted_only", suspension_reason: "revival_deferred", revival_deferred_reason: "model_unavailable" }, "retried a few times, then marked lost"],
    ["a child deferred for capacity", { residency_state: "persisted_only", suspension_reason: "revival_deferred", revival_deferred_reason: "capacity" }, "retried when a running child ends, else on session restart"],
  ] as const)("#given %s #when building the live row #then recovery needs no manual action", (_label, overrides) => {
    // given a parked child of that kind
    const parked = record({ task_id: "st_promise", status: "running", ...overrides })

    // when the live row renders on a wide line
    const row = backgroundWidgetRows([parked], new Map(), Date.parse("2026-07-07T01:00:00.000Z"), () => undefined, 220)[0] ?? ""

    // then every public row uses a transient state, never an instruction to the user
    for (const rendered of [row, formatTaskRow(parked), ...buildWidgetRows([parked])]) {
      expect(rendered).toContain(parked.suspension_reason === "host_incompatible" ? "ending" : "resuming")
      expect(rendered).not.toMatch(/suspended|\/task-kill|resumes on session restart/u)
    }
  })

  it.each([
    ["own_host_unreachable", "host lost"],
    ["daemon_unavailable", "task daemon unavailable"],
    ["idle_evicted", "evicted while idle"],
  ] as const)("#given a %s suspension #when building the live row #then it names the cause", (reason, phrase) => {
    // given a child the host parked for that reason, still marked resident in the store
    const parked = record({ task_id: "st_reason", status: "running", residency_state: "resident", suspension_reason: reason })

    // when the live row renders
    const row = backgroundWidgetRows([parked], new Map(), Date.parse("2026-07-07T01:00:00.000Z"), () => undefined, 220)[0] ?? ""

    // then it reads as suspended for that cause, not as running
    expect(row).toStartWith("‖ ")
    expect(row).toContain(phrase)
    expect(row).not.toContain("running")
  })

  it("#given a revival deferred for a named reason #when building the live row #then the deferral reason is shown", () => {
    // given a child whose revival the reconcile deferred for capacity
    const parked = record({
      task_id: "st_deferred",
      status: "running",
      residency_state: "persisted_only",
      suspension_reason: "revival_deferred",
      revival_deferred_reason: "capacity",
    })

    // when the live row renders
    const row = backgroundWidgetRows([parked], new Map(), Date.parse("2026-07-07T01:00:00.000Z"), () => undefined, 220)[0] ?? ""

    // then the row names the deferral and its reason
    expect(row).toContain("revival deferred: capacity")
  })

  it("#given a persisted_only record #when building a background widget row #then it contains resuming", () => {
    const now = Date.parse("2026-07-07T00:01:00.000Z")
    const row = backgroundWidgetRows([record({ task_id: "st_susp", status: "running", residency_state: "persisted_only" })], new Map([]), now, () => undefined, 220)[0] ?? ""
    expect(row).toContain("resuming")
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

describe("backgroundWidgetRows not-yet-started grammar", () => {
  const now = Date.parse("2026-07-07T00:01:00.000Z")

  it("#given a freshly spawned child with zero stats #when the live row renders #then it reads starting with no turn or cost token", () => {
    const row = backgroundWidgetRows([
      record({ task_id: "st_fresh", task_summary: "Not yet started child", status: "running", category: "quick" }),
    ], new Map([]), now, () => ({ runtime_ms: 2_000, turns: 0, tool_calls: 0, failed_turns: 0 }), 220)[0] ?? ""

    expect(row).toContain("starting")
    expect(row).not.toContain("turn ")
    expect(row).not.toContain("$")
  })

  it("#given failed provider attempts #when the live row renders #then the failed counter replaces the turn token and the verb reads retrying", () => {
    const row = backgroundWidgetRows([
      record({ task_id: "st_retry", task_summary: "Retrying child", status: "running", category: "deep-low" }),
    ], new Map([]), now, () => ({
      runtime_ms: 41_000,
      turns: 0,
      tool_calls: 0,
      failed_turns: 2,
      token_status: "unavailable",
      cost_status: "unavailable",
    }), 220)[0] ?? ""

    expect(row).toContain("failed 2")
    expect(row).toContain("retrying")
    expect(row).not.toContain("turn ")
    expect(row).not.toContain("$")
  })

  it("#given an ordinary successful run #when the live row renders #then the turn and cost tokens stay exactly as before", () => {
    const row = backgroundWidgetRows([
      record({ task_id: "st_ok", task_summary: "Ordinary child", status: "running", category: "quick" }),
    ], new Map([]), now, () => ({ runtime_ms: 65_000, turns: 3, tool_calls: 5, cost_usd: 0.12, tokens_per_second: 42 }), 220)[0] ?? ""

    expect(row).toContain("turn 3 (5 tools)")
    expect(row).toContain("$0.1200")
    expect(row).toContain("42 tok/s")
  })

  it("#given a child with no stats at all #when the live row renders #then the legacy running default holds", () => {
    const row = backgroundWidgetRows([
      record({ task_id: "st_legacy", task_summary: "Legacy child", status: "running", category: "quick" }),
    ], new Map([]), now, () => undefined, 220)[0] ?? ""

    expect(row).toContain("running")
    expect(row).not.toContain("starting")
  })

  it("#given the same stats #when both renderers draw them #then composeStatusLine and the live row emit the same stats tokens", () => {
    const ordinary = { runtime_ms: 65_000, turns: 3, tool_calls: 5, cost_usd: 0.12, tokens_per_second: 42 }
    const failedOnly = { runtime_ms: 41_000, turns: 0, tool_calls: 0, failed_turns: 2 }
    for (const stats of [ordinary, failedOnly]) {
      const composed = composeStatusLine({ identity: "Ordinary child", target: "category:quick", stats, verb: "running" })
      const row = backgroundWidgetRows([
        record({ task_id: "st_agree", task_summary: "Ordinary child", status: "running", category: "quick" }),
      ], new Map([]), now, () => stats, 220)[0] ?? ""

      const composedTokens = composed.split(" · ").slice(2).filter((token) => token !== "running")
      const rowTokens = row.split(" · ").slice(2).slice(0, -2)
      expect(composedTokens).toEqual(rowTokens)
    }

    // the ordinary shape keeps its turn and cost tokens; the failed-only shape replaces them
    expect(composeStatusLine({ identity: "t", stats: ordinary, verb: "running" })).toContain("turn 3 (5 tools)")
    expect(composeStatusLine({ identity: "t", stats: ordinary, verb: "running" })).toContain("$0.1200")
    expect(composeStatusLine({ identity: "t", stats: failedOnly, verb: "retrying" })).toBe("t · failed 2 · retrying")
  })
})

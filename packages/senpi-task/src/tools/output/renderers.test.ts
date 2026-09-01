import { describe, expect, test } from "bun:test"

import type { ThemeColor } from "@code-yeongyu/senpi"

import { rendererVisibleWidth } from "../task/renderers"
import { toolResult } from "../control"
import { renderTaskOutputCall, renderTaskOutputResult, type OutputRenderTheme } from "./renderers"
import type { TaskOutputDetails, TaskSnapshot } from "./types"

const TEST_THEME: OutputRenderTheme = {
  fg: (color: ThemeColor, text: string) => `[${color}]${text}[/${color}]`,
}

const ANSI_THEME: OutputRenderTheme = {
  fg: (_color: ThemeColor, text: string) => `\u001b[33m${text}\u001b[0m`,
}

const RESULT_OPTIONS = { expanded: false, isPartial: false }
const TERMINAL_CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u

function firstLine(component: { render(width: number): string[] }, width: number): string {
  return component.render(width)[0] ?? ""
}

function expectNoTerminalControls(value: string): void {
  expect(value).not.toMatch(TERMINAL_CONTROL_PATTERN)
}

function snapshot(overrides: Partial<TaskSnapshot> = {}): TaskSnapshot {
  return {
    task_id: "st_done",
    status: "completed",
    residency_state: "resident",
    execution_mode: "in-process",
    model: "raw-model",
    parent_session_id: "session-parent",
    root_session_id: "session-root",
    age_ms: 10,
    ...overrides,
  }
}

describe("task_output renderers", () => {
  test("#given task_output arguments #when rendering calls #then rows show target mode peek and only relevant tail lines", () => {
    // given / when
    const tailLine = firstLine(
      renderTaskOutputCall({ name: "long-running-explorer", mode: "tail", tail_lines: 20 }, TEST_THEME),
      96,
    )
    const statusLine = firstLine(
      renderTaskOutputCall({ task_id: "st_1", mode: "status", tail_lines: 20 }, TEST_THEME),
      96,
    )

    // then
    expect(tailLine).toContain("task_output")
    expect(tailLine).toContain("target:long-running-explorer")
    expect(tailLine).toContain("mode:tail")
    expect(tailLine).toContain("peek")
    expect(tailLine).toContain("tail_lines:20")
    expect(statusLine).toContain("peek")
    expect(statusLine).not.toContain("tail_lines")
  })

  test("#given a long multiline Korean and English target #when rendering with ANSI at width 72 #then target is normalized truncated and column-safe", () => {
    // given / when
    const line = firstLine(
      renderTaskOutputCall(
        {
          name: "한국어 작업 이름이 아주 길게 이어집니다.\nEnglish task name also continues long enough to require truncation.",
          mode: "tail",
          tail_lines: 7,
        },
        ANSI_THEME,
      ),
      72,
    )

    // then
    expect(line).not.toContain("\n")
    expect(line).toContain("한국어 작업")
    expect(line).toContain("...")
    expect(rendererVisibleWidth(line)).toBeLessThanOrEqual(72)
  })

  test("#given a width smaller than the fixed call tokens #when rendering task_output #then the complete ANSI row is clamped", () => {
    // given / when
    const line = firstLine(
      renderTaskOutputCall({ name: "abcdef", mode: "status" }, ANSI_THEME),
      20,
    )

    // then
    expect(line).toContain("...")
    expect(rendererVisibleWidth(line)).toBeLessThanOrEqual(20)
  })

  test("#given every result detail kind #when rendering compact rows #then rows are exhaustive and transcripts are not echoed", () => {
    // given
    const details: readonly TaskOutputDetails[] = [
      { kind: "status", snapshot: snapshot({ status: "running" }) },
      {
        kind: "transcript",
        mode: "full",
        source: "event-log",
        transcript: "secret transcript body that must stay out of compact rows",
        truncated: true,
        snapshot: snapshot(),
      },
      { kind: "not_found", reason: "No task 'missing' in this session.", known_tasks: ["alpha"] },
      { kind: "invalid_arguments", reason: "Provide task_id or name." },
    ]

    // when
    const lines = details.map((detail) => firstLine(renderTaskOutputResult(toolResult("ignored", detail), RESULT_OPTIONS, TEST_THEME), 120))

    // then
    expect(lines).toHaveLength(details.length)
    expect(lines.join("\n")).toContain("task_output st_done running")
    expect(lines.join("\n")).toContain("task_output transcript st_done")
    expect(lines.join("\n")).toContain("source:event-log")
    expect(lines.join("\n")).toContain("truncated")
    expect(lines.join("\n")).toContain("task_output not found")
    expect(lines.join("\n")).toContain("known:alpha")
    expect(lines.join("\n")).toContain("task_output invalid")
    expect(lines.join("\n")).not.toContain("secret transcript body")
  })

  test("#given a task_summary snapshot #when the status row renders #then the summary leads over the description", () => {
    // given / when
    const line = firstLine(
      renderTaskOutputResult(
        toolResult("ignored", {
          kind: "status",
          snapshot: snapshot({ name: "task-1", description: "quick label", task_summary: "Audit the waiting line" }),
        }),
        RESULT_OPTIONS,
        TEST_THEME,
      ),
      200,
    )

    // then
    expect(line).toStartWith("[success]task_output Audit the waiting line (st_done) completed")
  })

  test("#given a described task #when the status row renders #then the human label leads and the id trails", () => {
    // given / when
    const line = firstLine(
      renderTaskOutputResult(
        toolResult("ignored", { kind: "status", snapshot: snapshot({ name: "task-1", description: "Audit the waiting line" }) }),
        RESULT_OPTIONS,
        TEST_THEME,
      ),
      200,
    )

    // then
    expect(line).toStartWith("[success]task_output Audit the waiting line (st_done) completed")
  })

  test("#given long multiline Korean and English known tasks #when rendering not_found at width 96 #then known list is normalized truncated and column-safe", () => {
    // given
    const detail: TaskOutputDetails = {
      kind: "not_found",
      reason: "No task 'missing' in this session.",
      known_tasks: [
        "한국어 알려진 작업 이름이 아주 길게 이어집니다.\nEnglish known task also continues long enough to require truncation.",
      ],
    }

    // when
    const line = firstLine(renderTaskOutputResult(toolResult("ignored", detail), RESULT_OPTIONS, ANSI_THEME), 96)

    // then
    expect(line).not.toContain("\n")
    expect(line).toContain("한국어 알려진")
    expect(line).toContain("...")
    expect(rendererVisibleWidth(line)).toBeLessThanOrEqual(96)
  })

  test("#given resolved model details #when the status row renders #then the canonical target token is used", () => {
    // given / when
    const withResolved = firstLine(
      renderTaskOutputResult(
        toolResult("ignored", {
          kind: "status",
          snapshot: snapshot({
            category: "quick",
            resolved_model: {
              provider: "openai",
              model_id: "gpt-5.6-sol",
              display: "GPT-5.6 Sol",
              reasoning_effort: " ",
              variant: "xhigh",
              source: "category",
            },
          }),
        }),
        RESULT_OPTIONS,
        TEST_THEME,
      ),
      200,
    )
    const raw = firstLine(
      renderTaskOutputResult(
        toolResult("ignored", { kind: "status", snapshot: snapshot({ model: "anthropic/claude-sonnet-4-5" }) }),
        RESULT_OPTIONS,
        TEST_THEME,
      ),
      200,
    )

    // then blank effort falls back to the variant, and an unresolved model keeps a model token
    expect(withResolved).toContain("category:quick(openai/gpt-5.6-sol:xhigh)")
    expect(withResolved).not.toContain("reasoning")
    expect(raw).toContain("model:anthropic/claude-sonnet-4-5")
  })

  test("#given injected controls in task_output model metadata #when the status row renders #then it is plain and sanitized", () => {
    // given
    const detail: TaskOutputDetails = {
      kind: "status",
      snapshot: snapshot({
        category: "quick",
        model: "raw\u001b[31m-model\u001b[0m",
        resolved_model: {
          provider: "openai",
          model_id: "gpt-5.6-sol",
          display: "GPT\u001b]0;hidden\u0007-5.6 Sol",
          reasoning_effort: "xhigh\u0007",
          variant: "sol\u007f",
          source: "category",
        },
      }),
    }

    // when
    const line = firstLine(renderTaskOutputResult(toolResult("ignored", detail), RESULT_OPTIONS, TEST_THEME), 200)

    // then
    expect(line).toContain("category:quick(openai/gpt-5.6-sol:xhigh)")
    expectNoTerminalControls(line)
  })

  test("#given injected controls in a task_output result #when rendered #then dynamic controls are removed before trusted theme styling", () => {
    // given
    const details: TaskOutputDetails = {
      kind: "invalid_arguments",
      reason: "누락 \u001b[31m빨강\u001b[0m \u001b]8;;https://example.com\u001b\\링크\u001b]8;;\u001b\\\u0007",
    }

    // when
    const themed = firstLine(renderTaskOutputResult(toolResult("ignored", details), RESULT_OPTIONS, ANSI_THEME), 120)
    const plain = firstLine(renderTaskOutputResult(toolResult("ignored", details), RESULT_OPTIONS, TEST_THEME), 120)

    // then
    expect(themed).toStartWith("\u001b[33m")
    expect(themed).not.toContain("\u001b[31m")
    expect(themed).not.toContain("https://example.com")
    expectNoTerminalControls(plain)
  })
})

describe("task_output run stats rendering", () => {
  test("#given a terminal snapshot with run stats #when the status row renders #then runtime and tps are shown", () => {
    // given
    const detail: TaskOutputDetails = {
      kind: "status",
      snapshot: snapshot({
        run_stats: {
          runtime_ms: 134_000,
          turns: 3,
          tool_calls: 5,
          output_tokens: 900,
          total_tokens: 4_200,
          generation_ms: 7_600,
          tokens_per_second: 118,
        },
      }),
    }

    // when
    const line = firstLine(renderTaskOutputResult(toolResult("ignored", detail), RESULT_OPTIONS, TEST_THEME), 200)

    // then
    expect(line).toContain("task_output st_done completed")
    expect(line).toContain("· ran 2m 14s")
    expect(line).toContain("· 118 tok/s")
  })

  test("#given run stats with cost and cache hits #when the status row renders #then the cost token sits immediately before tps", () => {
    // given
    const detail: TaskOutputDetails = {
      kind: "status",
      snapshot: snapshot({
        run_stats: {
          runtime_ms: 134_000,
          turns: 3,
          tool_calls: 5,
          output_tokens: 900,
          tokens_per_second: 118,
          cost_usd: 0.4213,
          cache_hit_rate_last: 0.2,
          cache_hit_rate_run: 0.8712,
        },
      }),
    }

    // when
    const line = firstLine(renderTaskOutputResult(toolResult("ignored", detail), RESULT_OPTIONS, TEST_THEME), 200)

    // then
    expect(line).toContain("· $0.4213 (CH: 87%) · 118 tok/s")
  })

  test("#given run stats with cost but no cache facts #when the status row renders #then only the cost is shown before tps", () => {
    // given
    const detail: TaskOutputDetails = {
      kind: "status",
      snapshot: snapshot({
        run_stats: { runtime_ms: 1_000, turns: 1, tool_calls: 0, tokens_per_second: 20, cost_usd: 0.5 },
      }),
    }

    // when
    const line = firstLine(renderTaskOutputResult(toolResult("ignored", detail), RESULT_OPTIONS, TEST_THEME), 200)

    // then
    expect(line).toContain("· $0.5000 · 20 tok/s")
    expect(line).not.toContain("CH:")
  })

  test("#given a snapshot without run stats #when the status row renders #then no runtime tokens appear", () => {
    // when
    const line = firstLine(
      renderTaskOutputResult(toolResult("ignored", { kind: "status", snapshot: snapshot() }), RESULT_OPTIONS, TEST_THEME),
      200,
    )

    // then
    expect(line).not.toContain("ran ")
    expect(line).not.toContain("tok/s")
  })
})

describe("task_output suspended residency rendering", () => {
  test("#given a persisted_only snapshot #when the status row renders #then it shows suspended", () => {
    // given
    const detail: TaskOutputDetails = {
      kind: "status",
      snapshot: snapshot({ status: "running", residency_state: "persisted_only", suspended: { explanation: "suspended (resumes with session)" } }),
    }

    // when
    const line = firstLine(renderTaskOutputResult(toolResult("ignored", detail), RESULT_OPTIONS, TEST_THEME), 200)

    // then
    expect(line).toContain("suspended")
    expect(line).not.toContain("running")
  })

  test("#given an rpc_detached snapshot #when the status row renders #then it shows suspended", () => {
    // given
    const detail: TaskOutputDetails = {
      kind: "status",
      snapshot: snapshot({ status: "running", residency_state: "rpc_detached", suspended: { explanation: "suspended (resumes with session)" } }),
    }

    // when
    const line = firstLine(renderTaskOutputResult(toolResult("ignored", detail), RESULT_OPTIONS, TEST_THEME), 200)

    // then
    expect(line).toContain("suspended")
    expect(line).not.toContain("running")
  })

  test("#given a resident snapshot #when the status row renders #then the status label is unchanged (regression pin)", () => {
    // given
    const detail: TaskOutputDetails = {
      kind: "status",
      snapshot: snapshot({ status: "running", residency_state: "resident" }),
    }

    // when
    const line = firstLine(renderTaskOutputResult(toolResult("ignored", detail), RESULT_OPTIONS, TEST_THEME), 200)

    // then
    expect(line).toContain("running")
    expect(line).not.toContain("suspended")
  })
})

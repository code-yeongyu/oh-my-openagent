import { describe, expect, test } from "bun:test"

import type { ThemeColor } from "@code-yeongyu/senpi"

import { rendererVisibleWidth } from "../task/renderers"
import { toolResult } from "../control"
import {
  renderTaskOutputCall,
  renderTaskOutputResult,
  taskOutputModelText,
  type OutputRenderTheme,
} from "./renderers"
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
    execution_mode: "in-process",
    model: "raw-model",
    parent_session_id: "session-parent",
    root_session_id: "session-root",
    age_ms: 10,
    ...overrides,
  }
}

describe("task_output renderers", () => {
  test("#given task_output arguments #when rendering calls #then rows show target mode wait and only relevant tail lines", () => {
    // given / when
    const tailLine = firstLine(
      renderTaskOutputCall({ name: "long-running-explorer", mode: "tail", block: false, tail_lines: 20 }, TEST_THEME),
      96,
    )
    const statusLine = firstLine(
      renderTaskOutputCall({ task_id: "st_1", mode: "status", block: true, tail_lines: 20 }, TEST_THEME),
      96,
    )

    // then
    expect(tailLine).toContain("task_output")
    expect(tailLine).toContain("target:long-running-explorer")
    expect(tailLine).toContain("mode:tail")
    expect(tailLine).toContain("peek")
    expect(tailLine).toContain("tail_lines:20")
    expect(statusLine).toContain("block")
    expect(statusLine).not.toContain("tail_lines")
  })

  test("#given a long multiline Korean and English target #when rendering with ANSI at width 72 #then target is normalized truncated and column-safe", () => {
    // given / when
    const line = firstLine(
      renderTaskOutputCall(
        {
          name: "한국어 작업 이름이 아주 길게 이어집니다.\nEnglish task name also continues long enough to require truncation.",
          mode: "tail",
          block: false,
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
      renderTaskOutputCall({ name: "abcdef", mode: "status", block: true }, ANSI_THEME),
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
      { kind: "timed_out", task_id: "st_wait", waited_ms: 5000 },
      { kind: "not_found", reason: "No task 'missing' in this session.", known_tasks: ["alpha"] },
      { kind: "invalid_arguments", reason: "Provide task_id or name." },
    ]

    // when
    const lines = details.map((detail) => firstLine(renderTaskOutputResult(toolResult("ignored", detail), RESULT_OPTIONS, TEST_THEME), 120))

    // then
    expect(lines).toHaveLength(details.length)
    expect(lines.join("\n")).toContain("task_output status")
    expect(lines.join("\n")).toContain("task_output transcript st_done")
    expect(lines.join("\n")).toContain("source:event-log")
    expect(lines.join("\n")).toContain("truncated")
    expect(lines.join("\n")).toContain("task_output timed out st_wait after 5000ms")
    expect(lines.join("\n")).toContain("task_output not found")
    expect(lines.join("\n")).toContain("known:alpha")
    expect(lines.join("\n")).toContain("task_output invalid")
    expect(lines.join("\n")).not.toContain("secret transcript body")
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

  test("#given resolved model details #when formatting model text #then display is preferred and empty labels are omitted", () => {
    // given / when
    const withResolved = taskOutputModelText(
      snapshot({
        model: "openai/gpt-5.6-sol",
        resolved_model: {
          provider: "openai",
          model_id: "gpt-5.6-sol",
          display: "GPT-5.6 Sol",
          reasoning_effort: " ",
          variant: "xhigh",
          source: "category",
        },
      }),
    )
    const raw = taskOutputModelText(snapshot({ model: "anthropic/claude-sonnet-4-5" }))

    // then
    expect(withResolved).toBe("model GPT-5.6 Sol (variant xhigh)")
    expect(withResolved).not.toContain("reasoning ")
    expect(raw).toBe("model anthropic/claude-sonnet-4-5")
  })

  test("#given injected controls in task_output model metadata #when formatted #then model text is plain and sanitized", () => {
    // given
    const task = snapshot({
      model: "raw\u001b[31m-model\u001b[0m",
      resolved_model: {
        provider: "openai",
        model_id: "gpt-5.6-sol",
        display: "GPT\u001b]0;hidden\u0007-5.6 Sol",
        reasoning_effort: "xhigh\u0007",
        variant: "sol\u007f",
        source: "category",
      },
    })

    // when
    const text = taskOutputModelText(task)

    // then
    expect(text).toBe("model GPT-5.6 Sol (reasoning xhigh, variant sol)")
    expectNoTerminalControls(text)
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

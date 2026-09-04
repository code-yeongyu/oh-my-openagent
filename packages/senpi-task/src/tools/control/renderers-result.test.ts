import { describe, expect, test } from "bun:test"

import type { ThemeColor } from "@code-yeongyu/senpi"

import { renderTaskCancelResult, renderTaskSendResult, type ControlRenderTheme } from "./renderers"
import { toolResult } from "./tool-result"
import type { CancelResultDetails, SendResultDetails } from "./types"

const TEST_THEME: ControlRenderTheme = {
  fg: (color: ThemeColor, text: string) => `[${color}]${text}[/${color}]`,
  italic: (text: string) => `<i>${text}</i>`,
}

const ANSI_THEME: ControlRenderTheme = {
  fg: (_color: ThemeColor, text: string) => `\u001b[33m${text}\u001b[0m`,
  italic: (text: string) => `\u001b[3m${text}\u001b[0m`,
}

const RESULT_OPTIONS = { expanded: false, isPartial: false }
const TERMINAL_CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u

type SendResultRenderCase = readonly [name: string, details: SendResultDetails, expected: string]

const SEND_RESULT_RENDER_CASES = [
  ["steered", { kind: "steered", task_id: "st_1", status: "running", delivered: "steer" }, "[accent]task_send delivered st_1 as steer (running)[/accent]"],
  ["revived", { kind: "revived", task_id: "st_1", run_epoch: 2 }, "[success]task_send revived st_1 epoch 2[/success]"],
  ["delivery_uncertain", { kind: "delivery_uncertain", task_id: "st_1", run_epoch: 2, reason: "Child exited.", suggestion: "Inspect output." }, "[warning]task_send delivery uncertain st_1 epoch 2: Child exited. Inspect output.[/warning]"],
  ["queued", { kind: "queued", task_id: "st_1", queue_position: 3 }, "[muted]task_send queued st_1 position 3[/muted]"],
  ["not_continuable", { kind: "not_continuable", task_id: "st_1", reason: "Task is cancelled.", suggestion: "Start a new task." }, "[warning]task_send not continuable st_1: Task is cancelled. Start a new task.[/warning]"],
  ["scope_denied", { kind: "scope_denied", task_id: "st_1", owning_session_id: "owner", reason: "Denied." }, "[error]task_send denied st_1 owner:owner[/error]"],
  ["one_shot_agent", { kind: "one_shot_agent", task_id: "st_1", agent: "momus", message: "reminder" }, "[error]task_send denied st_1 one-shot:momus[/error]"],
  ["not_found", { kind: "not_found", reason: "No task.", known_tasks: ["alpha"] }, "[error]task_send not found: No task. known:alpha[/error]"],
  ["invalid_arguments", { kind: "invalid_arguments", reason: "message is required" }, "[error]task_send invalid: message is required[/error]"],
  ["team_message", { kind: "team_message", team: { kind: "to_lead", message_id: "msg-1" } }, "[success]task_send team message msg-1 enqueued to lead[/success]"],
  ["shutdown_requested", { kind: "shutdown_requested", team_run_id: "team-1", member: "atlas" }, "[warning]task_send shutdown requested team-1 member:atlas[/warning]"],
  ["shutdown_responded", { kind: "shutdown_responded", team_run_id: "team-1", member: "atlas", approved: false }, "[warning]task_send shutdown rejected team-1 member:atlas[/warning]"],
  ["shutdown_failed", { kind: "shutdown_failed", operation: "reject", team_run_id: "team-1", member: "atlas", code: "team_state_missing", reason: "Team state is unavailable." }, "[error]task_send shutdown reject failed team-1 member:atlas: Team state is unavailable.[/error]"],
] satisfies readonly SendResultRenderCase[]


function firstLine(component: { render(width: number): string[] }, width: number): string {
  return component.render(width)[0] ?? ""
}

function expectNoTerminalControls(value: string): void {
  expect(value).not.toMatch(TERMINAL_CONTROL_PATTERN)
}


describe("task_send result renderers", () => {
  test.each(SEND_RESULT_RENDER_CASES)(
    "#given the %s task_send result mapping #when rendering #then the exact themed row is stable",
    (_name, details, expected) => {
      const line = firstLine(renderTaskSendResult(toolResult("ok", details), RESULT_OPTIONS, TEST_THEME), 120)

      expect(line).toBe(expected)
    },
  )

  test("#given a structured shutdown failure #when rendering the result #then it shows concise safe context with the error theme", () => {
    const line = firstLine(
      renderTaskSendResult(
        toolResult("safe", {
          kind: "shutdown_failed",
          operation: "approve",
          team_run_id: "team-9",
          member: "atlas",
          code: "team_state_missing",
          reason: "Team state is unavailable.",
        }),
        RESULT_OPTIONS,
        TEST_THEME,
      ),
      120,
    )

    expect(line).toBe("[error]task_send shutdown approve failed team-9 member:atlas: Team state is unavailable.[/error]")
    expect(line).not.toContain("ENOENT")
    expect(line).not.toContain("/private/secret")
    expect(line).not.toContain("state.json")
  })

  test("#given injected controls in task_send and task_cancel results #when rendered #then dynamic controls are removed before trusted theme styling", () => {
    // given
    const sendDetails: SendResultDetails = {
      kind: "invalid_arguments",
      reason: "잘못됨 \u001b[31m빨강\u001b[0m\u0007",
    }
    const cancelDetails: CancelResultDetails = {
      kind: "not_found",
      reason: "없음 \u001b]8;;https://example.com\u001b\\링크\u001b]8;;\u001b\\\u007f",
    }

    // when
    const send = firstLine(renderTaskSendResult(toolResult("ignored", sendDetails), RESULT_OPTIONS, ANSI_THEME), 120)
    const cancel = firstLine(renderTaskCancelResult(toolResult("ignored", cancelDetails), RESULT_OPTIONS, ANSI_THEME), 120)
    const plainSend = firstLine(renderTaskSendResult(toolResult("ignored", sendDetails), RESULT_OPTIONS, TEST_THEME), 120)
    const plainCancel = firstLine(renderTaskCancelResult(toolResult("ignored", cancelDetails), RESULT_OPTIONS, TEST_THEME), 120)

    // then
    expect(send).toStartWith("\u001b[33m")
    expect(cancel).toStartWith("\u001b[33m")
    expect(send).not.toContain("\u001b[31m")
    expect(cancel).not.toContain("https://example.com")
    expectNoTerminalControls(plainSend)
    expectNoTerminalControls(plainCancel)
  })

})

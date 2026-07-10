import { describe, expect, test } from "bun:test"

import type { ThemeColor } from "@code-yeongyu/senpi"
import { visibleWidth } from "@earendil-works/pi-tui"

import {
  renderTaskCancelCall,
  renderTaskCancelResult,
  renderTaskSendCall,
  renderTaskSendResult,
  type ControlRenderTheme,
} from "./renderers"
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

function firstLine(component: { render(width: number): string[] }, width: number): string {
  return component.render(width)[0] ?? ""
}

describe("control tool renderers", () => {
  test("#given a plain task_send message #when rendering the call #then it shows concise target delivery and a width-safe excerpt", () => {
    const line = firstLine(
      renderTaskSendCall(
        {
          to: "st_00000001",
          deliver_as: "steer",
          message: "Please inspect the database migration and report only the risky steps. tail-marker",
        },
        TEST_THEME,
      ),
      96,
    )

    expect(line).toContain("task_send to:st_00000001 deliver:steer")
    expect(line).not.toContain("operation:")
    expect(line).not.toContain("target:")
    expect(line).not.toContain("delivery:")
    expect(line).toContain("Please inspect")
    expect(line).not.toContain("tail-marker")
  })

  test("#given long multiline Korean and English text #when rendering with ANSI at width 72 #then text is normalized truncated and column-safe", () => {
    const line = firstLine(
      renderTaskSendCall(
        {
          to: "atlas",
          deliver_as: "followUp",
          message: "한국어 안내가 아주 길게 이어집니다.\nEnglish guidance also continues long enough to require truncation safely.",
        },
        ANSI_THEME,
      ),
      72,
    )

    expect(line).not.toContain("\n")
    expect(line).toContain("한국어 안내")
    expect(line).toContain("...")
    expect(visibleWidth(line)).toBeLessThanOrEqual(72)
  })

  test("#given structured shutdown task_send messages #when rendering calls #then summaries name request approve reject and reason without object stringification", () => {
    const request = firstLine(
      renderTaskSendCall(
        { to: "atlas", team_run_id: "team-9", message: { type: "shutdown_request", reason: "done for today" } },
        TEST_THEME,
      ),
      120,
    )
    const approve = firstLine(
      renderTaskSendCall(
        { to: "atlas", message: { type: "shutdown_response", request_id: "req-1", approve: true } },
        TEST_THEME,
      ),
      120,
    )
    const reject = firstLine(
      renderTaskSendCall(
        { to: "atlas", message: { type: "shutdown_response", request_id: "req-2", approve: false, reason: "still testing" } },
        TEST_THEME,
      ),
      120,
    )

    expect(request).toContain("task_send shutdown:request to:atlas team:team-9")
    expect(request).toContain("reason:")
    expect(approve).toContain("task_send shutdown:approve to:atlas")
    expect(approve).toContain("request:req-1")
    expect(reject).toContain("task_send shutdown:reject to:atlas")
    expect(reject).toContain("reason:")
    expect([request, approve, reject].join("\n")).not.toContain("deliver:")
    expect([request, approve, reject].join("\n")).not.toContain("[object Object]")
  })

  test("#given a structured shutdown request with a meaningful reason #when rendering at normal width #then the real reason remains visible", () => {
    const line = firstLine(
      renderTaskSendCall(
        {
          to: "member-with-long-readable-name",
          team_run_id: "team-run-with-readable-context",
          message: {
            type: "shutdown_request",
            reason: "Renderer QA request after the mixed Korean and English edge pass",
          },
        },
        TEST_THEME,
      ),
      160,
    )

    expect(line).toContain("task_send shutdown:request")
    expect(line).toContain("to:member-with-long-readable-name")
    expect(line).toContain("team:team-run-with-readable-context")
    expect(line).toContain("reason:")
    expect(line).toContain("Renderer QA request")
  })

  test("#given a structured shutdown request with no room for a meaningful reason #when rendering at the Senpi edge width #then the optional reason field is omitted", () => {
    const line = firstLine(
      renderTaskSendCall(
        {
          to: "edge-member",
          team_run_id: "edge-team-72",
          message: {
            type: "shutdown_request",
            reason: "Renderer QA request after the mixed Korean and English edge pass",
          },
        },
        ANSI_THEME,
      ),
      73,
    )

    expect(line).toContain("task_send shutdown:request")
    expect(line).toContain("to:edge-member")
    expect(line).toContain("team:edge-team-72")
    expect(line).not.toContain("reason:")
    expect(line).not.toContain('reason:"."')
    expect(visibleWidth(line)).toBeLessThanOrEqual(73)
  })

  test("#given pure interrupt task_send #when rendering the call #then it is meaningful without an empty message label", () => {
    const line = firstLine(renderTaskSendCall({ to: "atlas", deliver_as: "interrupt" }, TEST_THEME), 80)

    expect(line).toContain("task_send to:atlas deliver:interrupt")
    expect(line).not.toContain("message:")
  })

  test("#given whitespace-only control text #when rendering calls #then empty message and reason labels are omitted", () => {
    const send = firstLine(renderTaskSendCall({ to: "atlas", message: " \n\t " }, TEST_THEME), 80)
    const shutdown = firstLine(
      renderTaskSendCall({ to: "atlas", message: { type: "shutdown_request", reason: " \n\t " } }, TEST_THEME),
      80,
    )
    const cancel = firstLine(renderTaskCancelCall({ task_id: "st_1", reason: " \n\t " }, TEST_THEME), 80)

    expect(send).not.toContain("message:")
    expect(shutdown).not.toContain("reason:")
    expect(cancel).not.toContain("reason:")
    expect(`${send}\n${shutdown}\n${cancel}`).not.toContain("[object Object]")
  })

  test("#given every task_send result detail kind #when rendering results #then each maps to a concise row", () => {
    const details: readonly SendResultDetails[] = [
      { kind: "steered", task_id: "st_1", status: "running", delivered: "steer" },
      { kind: "revived", task_id: "st_1", run_epoch: 2 },
      { kind: "queued", task_id: "st_1", queue_position: 3 },
      { kind: "not_continuable", task_id: "st_1", reason: "Task is cancelled.", suggestion: "Start a new task." },
      { kind: "scope_denied", task_id: "st_1", owning_session_id: "owner", reason: "Denied." },
      { kind: "not_found", reason: "No task.", known_tasks: ["alpha"] },
      { kind: "invalid_arguments", reason: "message is required" },
      { kind: "interrupted", task_id: "st_1", previous_status: "running" },
      { kind: "noop", task_id: "st_1", previous_status: "interrupted", reason: "Already interrupted." },
      { kind: "team_message", team: { kind: "to_lead", message_id: "msg-1", delivery: "wake" } },
      { kind: "shutdown_requested", team_run_id: "team-1", member: "atlas" },
      { kind: "shutdown_responded", team_run_id: "team-1", member: "atlas", approved: false },
      {
        kind: "shutdown_failed",
        operation: "reject",
        team_run_id: "team-1",
        member: "atlas",
        code: "team_state_missing",
        reason: "Team state is unavailable.",
      },
    ]

    const lines = details.map((detail) => firstLine(renderTaskSendResult(toolResult("ok", detail), RESULT_OPTIONS, TEST_THEME), 120))

    expect(lines).toHaveLength(details.length)
    expect(lines.join("\n")).toContain("delivered st_1 as steer")
    expect(lines.join("\n")).toContain("shutdown rejected")
  })

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

  test("#given task_cancel arguments and result variants #when rendering #then identifier reason and status rows are concise", () => {
    const call = firstLine(renderTaskCancelCall({ name: "alpha", reason: "no longer needed" }, TEST_THEME), 80)
    const details: readonly CancelResultDetails[] = [
      { kind: "cancelled", task_id: "st_1", previous_status: "running", status: "cancelled" },
      { kind: "noop", task_id: "st_1", status: "cancelled", reason: "Already cancelled." },
      { kind: "not_found", reason: "No task found." },
      { kind: "invalid_arguments", reason: "Provide task_id or name." },
    ]

    const lines = details.map((detail) =>
      firstLine(renderTaskCancelResult(toolResult("ok", detail), RESULT_OPTIONS, TEST_THEME), 100),
    )

    expect(call).toContain("target:alpha")
    expect(call).toContain("reason:")
    expect(call).toContain("[warning]")
    expect(call).not.toContain("[toolTitle]")
    expect(lines.join("\n")).toContain("cancelled st_1")
    expect(lines.join("\n")).toContain("[warning]")
    expect(lines.join("\n")).toContain("[error]")
  })
})

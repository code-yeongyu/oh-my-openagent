import { describe, expect, test } from "bun:test"

import type { ThemeColor } from "@code-yeongyu/senpi"
import { visibleWidth } from "@earendil-works/pi-tui"

import {
  renderTaskCancelCall,
  renderTaskCancelResult,
  renderTaskSendCall,
  type ControlRenderTheme,
} from "./renderers"
import { toolResult } from "./tool-result"
import type { CancelResultDetails } from "./types"

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

function firstLine(component: { render(width: number): string[] }, width: number): string {
  return component.render(width)[0] ?? ""
}

function expectNoTerminalControls(value: string): void {
  expect(value).not.toMatch(TERMINAL_CONTROL_PATTERN)
}

describe("control tool renderers", () => {
  test("#given a plain task_send message #when rendering the call #then it shows a concise target and width-safe excerpt", () => {
    const line = firstLine(
      renderTaskSendCall(
        {
          to: "st_00000001",
          message: "Please inspect the database migration and report only the risky steps. tail-marker",
        },
        ANSI_THEME,
      ),
      96,
    )

    expect(line).toContain("task_send to:st_00000001")
    expect(line).not.toContain("deliver:")
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

  test("#given a long Korean continuation #when rendering task_send #then the excerpt ends at a word boundary", () => {
    // given / when
    const line = firstLine(
      renderTaskSendCall(
        {
          to: "st_1",
          message: "한국어로 긴 후속 작업 지시를 작성하고 동일한 세션의 맥락을 검증하세요.",
        },
        ANSI_THEME,
      ),
      72,
    )

    // then
    expect(line).toContain('"한국어로 긴 후속 작업 지시를 작성하고..."')
    expect(line).not.toContain("지...")
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

  test("#given task_send without a message #when rendering the call #then it is meaningful without an empty message label", () => {
    const line = firstLine(renderTaskSendCall({ to: "atlas" }, TEST_THEME), 80)

    expect(line).toContain("task_send to:atlas")
    expect(line).not.toContain("deliver:")
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

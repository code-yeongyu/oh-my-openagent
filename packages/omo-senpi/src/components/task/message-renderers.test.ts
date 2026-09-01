import { describe, expect, test } from "bun:test"

import type { MessageRenderer } from "@code-yeongyu/senpi"
import { normalizeRendererText, rendererVisibleWidth } from "@oh-my-opencode/senpi-task"

import { Theme } from "../../senpi-test-runtime"
import { renderTaskCompletion, renderTeamMemberLiveness } from "./renderers"

const TEST_FG_COLORS = {
  accent: "#000000",
  bashMode: "#000000",
  border: "#000000",
  borderAccent: "#000000",
  borderMuted: "#000000",
  customMessageLabel: "#000000",
  customMessageText: "#000000",
  dim: "#000000",
  error: "#000000",
  mdCode: "#000000",
  mdCodeBlock: "#000000",
  mdCodeBlockBorder: "#000000",
  mdHeading: "#000000",
  mdHr: "#000000",
  mdLink: "#000000",
  mdLinkUrl: "#000000",
  mdListBullet: "#000000",
  mdQuote: "#000000",
  mdQuoteBorder: "#000000",
  muted: "#000000",
  success: "#000000",
  syntaxComment: "#000000",
  syntaxFunction: "#000000",
  syntaxKeyword: "#000000",
  syntaxNumber: "#000000",
  syntaxOperator: "#000000",
  syntaxPunctuation: "#000000",
  syntaxString: "#000000",
  syntaxType: "#000000",
  syntaxVariable: "#000000",
  text: "#000000",
  thinkingHigh: "#000000",
  thinkingLow: "#000000",
  thinkingMax: "#000000",
  thinkingMedium: "#000000",
  thinkingMinimal: "#000000",
  thinkingOff: "#000000",
  thinkingText: "#000000",
  thinkingXhigh: "#000000",
  toolDiffAdded: "#000000",
  toolDiffContext: "#000000",
  toolDiffRemoved: "#000000",
  toolOutput: "#000000",
  toolTitle: "#000000",
  userMessageText: "#000000",
  warning: "#000000",
} as const satisfies ConstructorParameters<typeof Theme>[0]
const TEST_BG_COLORS = {
  customMessageBg: "#000000",
  selectedBg: "#000000",
  toolErrorBg: "#000000",
  toolPendingBg: "#000000",
  toolSuccessBg: "#000000",
  userMessageBg: "#000000",
} as const satisfies ConstructorParameters<typeof Theme>[1]
const TEST_THEME = new Theme(TEST_FG_COLORS, TEST_BG_COLORS, "truecolor")
const TERMINAL_CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u
const ADVERSARIAL_CONTENT = [
  "첫줄 \u001b[31m빨강\u001b[0m \u0007\u001b[2J\u007f\u0085 끝",
  "둘째 \u001b]8;;https://example.com\u0007링크\u001b]8;;\u0007 \u001b]0;숨긴 제목\u001b\\ 界",
  "셋째 漢字 \u001b]8;;https://example.com/unterminated",
  "넷째 줄 보존",
  "다섯째 한글 \u001bPunterminated-dcs",
  "여섯째 줄 보존",
].join("\n")
function renderContentLines<T>(
  renderer: MessageRenderer<T>,
  customType: string,
  content: string,
  details: T,
  width = 2_000,
  expanded = false,
): readonly string[] {
  const component = renderer(
    { role: "custom", customType, content, display: true, details, timestamp: 0 },
    { expanded, outputPad: 0 },
    TEST_THEME,
  )
  return component?.render(width) ?? []
}

function expectSanitizedLines(lines: readonly string[]): void {
  const normalized = lines.map(normalizeRendererText)
  for (const line of normalized) expect(line).not.toMatch(TERMINAL_CONTROL_PATTERN)
  expect(normalized.join("\n")).not.toContain("example.com")
  expect(normalized.join("\n")).not.toContain("숨긴 제목")
  expect(normalized.join("\n")).not.toContain("unterminated-dcs")
}

describe("task-family custom message renderers", () => {
  test("#given terminal control injection #when rendering task completion #then structured CJK details are sanitized", () => {
    // given
    const details = [{
      task_id: "st_1",
      name: "작업자",
      status: "completed" as const,
      model: "openai-codex/gpt-5.6-luna-fast",
      duration_ms: 10,
      final_response: ADVERSARIAL_CONTENT,
      continuation_hint: "task_send로 계속",
    }]

    // when
    const lines = renderContentLines(renderTaskCompletion, "senpi-task.completion", "<task-notification>raw</task-notification>", details)

    // then
    expectSanitizedLines(lines)
    expect(lines.join("\n")).toContain("첫줄 빨강")
    expect(lines.join("\n")).not.toContain("<task-notification>")
  })

  test("#given structured completion details #when rendering #then user-facing task facts replace protocol tags", () => {
    // given
    const details = [{
      task_id: "st_done",
      name: "worker",
      status: "completed" as const,
      category: "quick",
      model: "requested/model",
      resolved_model: {
        source: "category" as const,
        provider: "openai-codex",
        model_id: "gpt-5.6-luna-fast",
        display: "openai-codex/gpt-5.6-luna-fast",
      },
      duration_ms: 1250,
      tokens: 321,
      final_response: "검증 작업을 완료했습니다.",
      continuation_hint: 'Use task_send({ to: "st_done", message: "..." }) to continue.',
    }]

    // when
    const lines = renderContentLines(
      renderTaskCompletion,
      "senpi-task.completion",
      "<task-notification>\n<head>raw protocol body</head>\n</task-notification>",
      details,
    )
    const text = lines.join("\n")

    // then
    expect(text).toContain("Task complete · worker")
    expect(text).toContain("id st_done")
    expect(text).toContain("category:quick(openai-codex/gpt-5.6-luna-fast)")
    expect(text).toContain("duration 1.25s")
    expect(text).toContain("tokens 321")
    expect(text).toContain("검증 작업을 완료했습니다.")
    expect(text).not.toContain("task_send")
    expect(lines.every((line) => line.includes("\u001b[48;2;0;0;0m"))).toBe(true)
    expect(text).not.toContain("<task-notification>")
    expect(text).not.toContain("<head>")
  })

  test("#given a liveness event #when rendering #then member state and a sanitized crash reason are visible", () => {
    // given
    const details = {
      memberName: "alpha",
      lastKnownState: "error" as const,
      reason: ADVERSARIAL_CONTENT,
    }

    // when
    const lines = renderContentLines(
      renderTeamMemberLiveness,
      "senpi-task.team-member-liveness",
      "raw liveness protocol",
      details,
    )

    // then
    expectSanitizedLines(lines)
    const text = lines.join("\n")
    expect(text).toContain("Team member unavailable · alpha")
    expect(text).toContain("last known state was error")
    expect(lines.every((line) => line.includes("\u001b[48;2;0;0;0m"))).toBe(true)
  })

  test("#given a completed team member with a long target #when rendering at 140 cells #then minute duration tools and tps remain visible", () => {
    // given
    const details = [{
      task_id: "st_team_member",
      name: "stats-member",
      status: "completed" as const,
      category: "quick",
      model: "apitopia/z-ai/glm-5.2-ultrafast-unlocked",
      duration_ms: 65_000,
      run_stats: {
        runtime_ms: 65_000,
        turns: 3,
        tool_calls: 4,
        output_tokens: 840,
        tokens_per_second: 250,
      },
      final_response: "team statistics member complete",
      continuation_hint: 'Use task_send({ to: "stats-member", message: "..." }) to continue.',
    }]

    // when
    const lines = renderContentLines(
      renderTaskCompletion,
      "senpi-task.completion",
      "<task-notification>raw</task-notification>",
      details,
      140,
    )
    const text = lines.map(normalizeRendererText).join("\n")

    // then
    expect(text).toContain("Task complete · stats-member")
    expect(text).toContain("duration 1m 5s")
    expect(text).toContain("tools 4")
    expect(text).toContain("tps 250")
    for (const line of lines) expect(rendererVisibleWidth(line)).toBeLessThanOrEqual(140)
  })

  test("#given a long completion continuation #when rendering at 54 cells #then the actual-width excerpt preserves English word boundaries", () => {
    // given
    const details = [{
      task_id: "st_done",
      name: "worker",
      status: "completed" as const,
      model: "openai-codex/gpt-5.6-luna-fast",
      duration_ms: 1250,
      final_response: "검증 작업을 완료했습니다.",
      continuation_hint: 'Use task_send({ to: "st_done", message: "continue with the remaining evidence and report the result" }) to continue.',
    }]

    // when
    const lines = renderContentLines(renderTaskCompletion, "senpi-task.completion", "<task-notification>raw</task-notification>", details, 54, true)
    const normalizedLines = lines.map(normalizeRendererText)
    const continuationLine = normalizedLines.find((line) => line.includes("task_send")) ?? ""

    // then
    expect(continuationLine).toContain("to")
    expect(continuationLine).not.toMatch(/\b(?:durati|rea|read|ful)\.\.\.$/u)
    for (const line of lines) expect(rendererVisibleWidth(line)).toBeLessThanOrEqual(54)
  })
})

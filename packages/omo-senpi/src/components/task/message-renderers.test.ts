import { describe, expect, test } from "bun:test"

import { Theme, type MessageRenderer } from "@code-yeongyu/senpi"

import { renderTaskCompletion } from "./renderers"
import { renderTeamMessage } from "./team-renderers"

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
const EXPECTED_LINES = ["첫줄 빨강 끝", "둘째 링크 界", "셋째 漢字", "넷째 줄 보존", "다섯째 한글", "여섯째 줄 보존"]

function renderLines<T>(renderer: MessageRenderer<T>, customType: string, details: T): readonly string[] {
  const component = renderer(
    { role: "custom", customType, content: ADVERSARIAL_CONTENT, display: true, details, timestamp: 0 },
    { expanded: false },
    TEST_THEME,
  )
  return component?.render(2_000) ?? []
}

function expectSanitizedLines(lines: readonly string[]): void {
  for (const line of lines) expect(line).not.toMatch(TERMINAL_CONTROL_PATTERN)
  expect(lines.join("\n")).not.toContain("example.com")
  expect(lines.join("\n")).not.toContain("숨긴 제목")
  expect(lines.join("\n")).not.toContain("unterminated-dcs")
  expect(lines).toEqual(EXPECTED_LINES)
}

describe("task-family custom message renderers", () => {
  test("#given terminal control injection #when rendering task completion #then controls are removed and CJK line separation is preserved", () => {
    // given the shared adversarial multiline content

    // when
    const lines = renderLines(renderTaskCompletion, "senpi-task.completion", [])

    // then
    expectSanitizedLines(lines)
  })

  test("#given terminal control injection #when rendering a team message #then controls are removed and CJK line separation is preserved", () => {
    // given the shared adversarial multiline content

    // when
    const lines = renderLines(renderTeamMessage, "senpi-task.team-message", { from: "member-a", messageId: "m1" })

    // then
    expectSanitizedLines(lines)
  })
})

import { describe, expect, test } from "bun:test"

import {
  excerptRendererText,
  linesComponent,
  normalizeRendererText,
  rendererVisibleWidth,
} from "./renderers"

const TERMINAL_CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u

function expectNoTerminalControls(value: string): void {
  expect(value).not.toMatch(TERMINAL_CONTROL_PATTERN)
}

describe("renderer text", () => {
  test("#given long multiline Korean and English text #when excerpted at width 72 #then whitespace is normalized and terminal width is bounded", () => {
    // given
    const text = [
      "첫 번째 줄은 아주 긴 한국어 설명입니다.",
      "Second line keeps enough English words to prove mixed-width truncation is terminal-aware.",
    ].join("\n")

    // when
    const excerpt = excerptRendererText(text, 72)

    // then
    expect(excerpt).not.toContain("\n")
    expect(excerpt).toContain(" ")
    expect(excerpt).toContain("...")
    expectNoTerminalControls(excerpt)
    expect(rendererVisibleWidth(excerpt)).toBeLessThanOrEqual(72)
  })

  test("#given adversarial terminal sequences and Korean whitespace #when normalized #then controls are removed without damaging ordinary text", () => {
    // given
    const cases = [
      { value: "앞 \u001b[31m빨강\u001b[0m 뒤", expected: "앞 빨강 뒤" },
      { value: "앞 \u001b]8;;https://example.com\u0007링크\u001b]8;;\u0007 뒤", expected: "앞 링크 뒤" },
      { value: "한\u001b]0;창 제목\u001b\\글", expected: "한글" },
      { value: "한\u0007글", expected: "한글" },
      { value: "한\u001b[2J글", expected: "한글" },
      { value: "한\u001bc글", expected: "한글" },
      { value: "한\u007f\u0085글", expected: "한글" },
      { value: "안전\u001b]8;;https://example.com/숨김", expected: "안전" },
      { value: "  첫째\t둘째\n界  ", expected: "첫째 둘째 界" },
    ] as const

    // when
    const normalized = cases.map(({ value }) => normalizeRendererText(value))

    // then
    expect(normalized).toEqual(cases.map(({ expected }) => expected))
    for (const value of normalized) expectNoTerminalControls(value)
  })
})

describe("linesComponent", () => {
  test("#given lines #when a component is built #then render returns those lines and invalidate is callable", () => {
    // given
    const component = linesComponent(["row one", "row two"])

    // when
    const rendered = component.render(80)
    component.invalidate()

    // then
    expect(rendered).toEqual(["row one", "row two"])
  })

  test("#given long Korean and English lines #when rendered at width 72 #then every row is truncated by visible width", () => {
    // given
    const component = linesComponent([
      "요약: 한국어 텍스트가 길어도 셀 폭 기준으로 잘려야 합니다 and the English suffix should not overflow the terminal row.",
    ])

    // when
    const rendered = component.render(72)

    // then
    expect(rendered).toHaveLength(1)
    expect(rendered[0]).toContain("...")
    expect(rendererVisibleWidth(rendered[0])).toBeLessThanOrEqual(72)
  })
})

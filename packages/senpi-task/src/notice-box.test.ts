import { describe, expect, test } from "bun:test"

import type { ThemeColor } from "@code-yeongyu/senpi"
import { visibleWidth } from "@earendil-works/pi-tui"

import { buildNoticeBox } from "./notice-box"

type TaggedTheme = {
  fg(color: ThemeColor, text: string): string
  bg(color: "customMessageBg", text: string): string
}

const theme: TaggedTheme = {
  fg: (color, text) => `<fg:${color}>${text}</fg:${color}>`,
  bg: (color, text) => `<bg:${color}>${text}</bg:${color}>`,
}

function backgroundPayload(line: string): string {
  const match = /^<bg:customMessageBg>(.*)<\/bg:customMessageBg>$/u.exec(line)
  expect(match).not.toBeNull()
  return match?.[1] ?? ""
}

describe("buildNoticeBox", () => {
  test("#given a notice spec #when rendered collapsed #then every full-width line uses the custom-message background and Box padding", () => {
    // when
    const lines = buildNoticeBox(
      {
        title: "Notice title",
        tone: "warning",
        why: "Notice body",
        extra: [{ text: "Extra detail" }],
        expandedLine: "Expanded detail",
      },
      { expanded: false },
      theme,
    ).render(40)

    // then
    expect(lines).toHaveLength(5)
    expect(lines.map(backgroundPayload).map(visibleWidth)).toEqual([40, 40, 40, 40, 40])
    expect(backgroundPayload(lines[0]!)).toBe(" ".repeat(40))
    expect(backgroundPayload(lines.at(-1)!)).toBe(" ".repeat(40))
    expect(lines[1]).toContain(" <fg:warning>\u001b[1mNotice title\u001b[22m</fg:warning>")
    expect(lines[2]).toContain(" <fg:dim>Notice body</fg:dim>")
    expect(lines[3]).toContain(" <fg:dim>Extra detail</fg:dim>")
    expect(lines.join("\n")).not.toContain("Expanded detail")
  })

  test("#given an expanded notice #when rendered #then the gated detail is dim inside the same background block", () => {
    // when
    const lines = buildNoticeBox(
      { title: "Title", why: "Why", expandedLine: "Expanded detail" },
      { expanded: true },
      theme,
    ).render(60)

    // then
    expect(lines).toHaveLength(5)
    expect(lines[3]).toContain(" <fg:dim>Expanded detail</fg:dim>")
    expect(lines.map(backgroundPayload).every((line) => visibleWidth(line) === 60)).toBe(true)
  })
})

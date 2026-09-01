import { describe, expect, it } from "bun:test"
import { renderNudgeBlock, renderNudgeMessage } from "./render"

describe("renderNudgeBlock", () => {
  it("#given a judged nudge #when the block is rendered #then the hint replaces the description and excerpt inside the sourced framing", () => {
    // given
    const nudge = { path: "reference/a.md", hint: "The deploy gate requires a green smoke run." }

    // when
    const block = renderNudgeBlock(nudge)

    // then
    expect(block).toBe(
      '<recalled-memory source="[[reference/a.md]]">\n' +
        "A stored memory surfaced. It is a hint, not current state — verify before relying on it; read the source path for full context.\n" +
        "The deploy gate requires a green smoke run.\n" +
        "</recalled-memory>",
    )
  })
})

describe("renderNudgeMessage", () => {
  it("#given no nudges #when the message is rendered #then the result is empty so callers inject nothing", () => {
    // given / when / then
    expect(renderNudgeMessage([])).toBe("")
  })

  it("#given several nudges #when the message is rendered #then one sourced block per nudge keeps the judge's order", () => {
    // given
    const nudges = [
      { path: "notes/b.md", hint: "first fact" },
      { path: "people/alice.md", hint: "second fact" },
    ]

    // when
    const message = renderNudgeMessage(nudges)

    // then
    expect(message).toBe(`${renderNudgeBlock(nudges[0]!)}\n${renderNudgeBlock(nudges[1]!)}`)
    expect(message.endsWith("\n")).toBe(false)
  })
})

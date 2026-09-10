import { describe, expect, test } from "bun:test"

import type { PanelRow } from "../types"
import { createTextPopup, type PopupTui } from "./text-popup"
import { popupBudget } from "./viewport"

function tui(rows: number): PopupTui & { renders: number } {
  const handle = {
    terminal: { rows },
    renders: 0,
    requestRender(): void {
      handle.renders += 1
    },
  }
  return handle
}

const long = (count: number): readonly PanelRow[] =>
  Array.from({ length: count }, (_, index) => ({ text: `line ${index}`, color: "text" as const }))

function popup(terminalRows: number, rows: readonly PanelRow[], onKey?: (data: string) => boolean) {
  const closed: boolean[] = []
  const handle = tui(terminalRows)
  const component = createTextPopup(handle, undefined, {
    title: "tracked.txt",
    rows: () => rows,
    ...(onKey === undefined ? {} : { onKey }),
    close: () => closed.push(true),
  })
  return { component, handle, closed }
}

describe("createTextPopup", () => {
  test("#given content longer than the screen #when painted #then the closing border survives at every height", () => {
    // given
    const heights = [24, 30, 40, 50, 80]

    // when
    const painted = heights.map((rows) => popup(rows, long(600)).component.render(60))

    // then
    expect(painted.map((lines) => lines[lines.length - 1]?.endsWith("┘"))).toEqual([true, true, true, true, true])
    expect(painted.map((lines, index) => lines.length === popupBudget(heights[index] ?? 0, 0.72).total)).toEqual([
      true,
      true,
      true,
      true,
      true,
    ])
  })

  test("#given content that fits #when painted #then the frame closes right after the content", () => {
    // given
    const { component } = popup(50, long(3))

    // when
    const lines = component.render(60)

    // then
    expect(lines).toHaveLength(3 + 4)
    expect(lines[0]?.startsWith("┌")).toBe(true)
    expect(lines[lines.length - 1]?.startsWith("└")).toBe(true)
  })

  test("#given overflowing content #when painted #then the hint reports the visible range", () => {
    // given
    const { component } = popup(50, long(600))

    // when
    const lines = component.render(60)
    const hint = lines[lines.length - 2] ?? ""

    // then
    expect(hint).toContain("1-32/600")
    expect(hint).toContain("esc close")
  })

  test("#given content that fits #when painted #then the hint is just the close key", () => {
    // given
    const { component } = popup(50, long(2))

    // when
    const hint = component.render(60).at(-2) ?? ""

    // then
    expect(hint).toContain("esc close")
    expect(hint).not.toContain("/2")
  })

  test("#given each close key #when pressed #then the popup closes", () => {
    // given
    const keys = ["\x1b", "q", "\r", "\n", "\x1b[27u", "\x1b[27;5u"]

    // when
    const closes = keys.map((key) => {
      const { component, closed } = popup(50, long(10))
      component.handleInput(key)
      return closed.length
    })

    // then
    expect(closes).toEqual([1, 1, 1, 1, 1, 1])
  })

  test("#given a scroll key #when pressed #then the view moves and stays inside the content", () => {
    // given
    const { component, handle } = popup(50, long(200))

    // when
    component.handleInput("\x1b[6~")
    const afterPageDown = component.render(60)[2] ?? ""
    for (let index = 0; index < 40; index += 1) component.handleInput("\x1b[6~")
    const afterEnd = component.render(60)[2] ?? ""
    component.handleInput("\x1b[A")
    const afterLineUp = component.render(60)[2] ?? ""

    // then
    expect(afterPageDown).toContain("line 10")
    // 200 content rows in a 32-row body: the last full screen starts at 168.
    expect(afterEnd).toContain("line 168")
    expect(afterLineUp).toContain("line 167")
    expect(handle.renders).toBeGreaterThan(0)
  })

  test("#given a viewer that claims a key #when pressed #then the shell does not close on it", () => {
    // given
    const { component, closed } = popup(50, long(10), (data) => data === "f")

    // when
    component.handleInput("f")
    component.handleInput("q")

    // then
    expect(closed).toHaveLength(1)
  })

  test("#given an unhandled key #when pressed #then nothing happens", () => {
    // given
    const { component, handle, closed } = popup(50, long(10))

    // when
    component.handleInput("z")

    // then
    expect(closed).toHaveLength(0)
    expect(handle.renders).toBe(0)
  })
})

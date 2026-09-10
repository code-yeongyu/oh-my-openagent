import { describe, expect, test } from "bun:test"

import { createPanelBody } from "./body"
import type { PanelRow, PanelTheme } from "./types"

const noTheme = (): PanelTheme | undefined => undefined

const COLOURS: Record<string, string> = { accent: "\x1b[35m", muted: "\x1b[90m" }

/** Stands in for pi-tui's theme: colour arrives as escapes, which carry no printable width. */
function ansiTheme(): PanelTheme {
  return { fg: (color, text) => `${COLOURS[color] ?? ""}${text}\x1b[39m` }
}

function source(rows: readonly PanelRow[], seen?: number[]) {
  return {
    rows: (width: number) => {
      seen?.push(width)
      return rows
    },
  }
}

describe("createPanelBody", () => {
  test("#given rows shorter than the column #when rendered #then each line is padded to the full width", () => {
    // given
    const body = createPanelBody(source([{ text: "a" }, { text: "bb" }]), noTheme)

    // when
    const painted = body.render(5)

    // then
    expect(painted).toEqual(["a    ", "bb   "])
  })

  test("#given a coloured row and a theme #when rendered #then the theme paints it and padding still fits", () => {
    // given
    const body = createPanelBody(source([{ text: "USAGE", color: "accent" }]), ansiTheme)

    // when
    const painted = body.render(8)

    // then
    expect(painted).toEqual(["\x1b[35mUSAGE\x1b[39m   "])
  })

  test("#given a row without a colour #when rendered #then no escapes are added", () => {
    // given
    const body = createPanelBody(source([{ text: "plain" }]), ansiTheme)

    // when
    const painted = body.render(6)

    // then
    expect(painted).toEqual(["plain "])
  })

  test("#given a host that hands no theme #when rendered #then coloured rows fall back to plain text", () => {
    // given
    const body = createPanelBody(source([{ text: "USAGE", color: "accent" }]), noTheme)

    // when
    const painted = body.render(5)

    // then
    expect(painted).toEqual(["USAGE"])
  })

  test("#given a row wider than the column #when rendered #then it is cut to the column", () => {
    // given
    const body = createPanelBody(source([{ text: "abcdefghij" }]), noTheme)

    // when
    const painted = body.render(5)

    // then
    expect(painted).toEqual(["abcd\u2026"])
  })

  test("#given the layout reports no width #when rendered #then the source is asked for zero", () => {
    // given
    const widths: number[] = []
    const body = createPanelBody(source([], widths), noTheme)

    // when
    const painted = body.render(-4)

    // then
    expect(painted).toEqual([])
    expect(widths).toEqual([0])
  })
})

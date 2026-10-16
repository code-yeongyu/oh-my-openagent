import { describe, expect, test } from "bun:test"

import { MIN_TRANSCRIPT_COLUMNS, PANEL_MAX_COLUMNS, PANEL_MIN_COLUMNS } from "./constants"
import { resolvePanelWidth } from "./width"

describe("resolvePanelWidth", () => {
  test("#given a percentage #when resolved #then it follows the terminal width", () => {
    // given
    const configured = "25%"

    // when
    const resolved = resolvePanelWidth(configured, 240)

    // then
    expect(resolved).toBe(60)
  })

  test("#given a percentage on a wider terminal #when resolved #then it stops at the maximum", () => {
    // given
    const configured = "50%"

    // when
    const resolved = resolvePanelWidth(configured, 400)

    // then
    expect(resolved).toBe(PANEL_MAX_COLUMNS)
  })

  test("#given a fixed column count #when resolved #then it is used as configured", () => {
    // given
    const configured = 44

    // when
    const resolved = resolvePanelWidth(configured, 200)

    // then
    expect(resolved).toBe(44)
  })

  test("#given a terminal that cannot afford the panel #when resolved #then the transcript keeps its floor", () => {
    // given
    const terminalWidth = MIN_TRANSCRIPT_COLUMNS + PANEL_MIN_COLUMNS + 4

    // when
    const resolved = resolvePanelWidth(72, terminalWidth)

    // then
    expect(resolved).toBe(PANEL_MIN_COLUMNS + 4)
  })

  test("#given a terminal narrower than the transcript floor #when resolved #then it falls back to the minimum", () => {
    // given
    const terminalWidth = 40

    // when
    const resolved = resolvePanelWidth("30%", terminalWidth)

    // then
    expect(resolved).toBe(PANEL_MIN_COLUMNS)
  })

  test("#given an unmeasured terminal #when resolved #then the configured columns survive unclamped by the terminal", () => {
    // given
    const terminalWidth = 0

    // when
    const resolved = resolvePanelWidth(48, terminalWidth)

    // then
    expect(resolved).toBe(48)
  })
})

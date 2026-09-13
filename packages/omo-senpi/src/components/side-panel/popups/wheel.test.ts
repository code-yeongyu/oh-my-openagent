import { describe, expect, test } from "bun:test"

import { parsePanelWheelEvent } from "./wheel"

describe("parsePanelWheelEvent", () => {
  test("#given a wheel-up report #when parsed #then it scrolls towards the top", () => {
    // given button 64 is the wheel with direction bits clear
    expect(parsePanelWheelEvent("\u001b[<64;10;5M")).toEqual({ direction: -1, press: true })
  })

  test("#given a wheel-down report #when parsed #then it scrolls towards the bottom", () => {
    // given / when / then
    expect(parsePanelWheelEvent("\u001b[<65;10;5M")).toEqual({ direction: 1, press: true })
  })

  test("#given the release form #when parsed #then it is recognised but not a notch", () => {
    // given a stray release must still be claimed rather than reaching the surface below
    expect(parsePanelWheelEvent("\u001b[<64;10;5m")).toEqual({ direction: -1, press: false })
  })

  test("#given a plain click #when parsed #then it is not a wheel event", () => {
    // given button 0 carries no wheel bit
    expect(parsePanelWheelEvent("\u001b[<0;10;5M")).toBeUndefined()
  })

  test("#given a horizontal wheel #when parsed #then it is left alone", () => {
    // given buttons 66 and 67 are the side-tilt directions the viewer has no axis for
    expect(parsePanelWheelEvent("\u001b[<66;10;5M")).toBeUndefined()
    expect(parsePanelWheelEvent("\u001b[<67;10;5M")).toBeUndefined()
  })

  test("#given ordinary keystrokes #when parsed #then nothing is claimed", () => {
    // given / when / then
    expect(parsePanelWheelEvent("q")).toBeUndefined()
    expect(parsePanelWheelEvent("\u001b[B")).toBeUndefined()
    expect(parsePanelWheelEvent("\u001b[<64;10;5")).toBeUndefined()
  })
})

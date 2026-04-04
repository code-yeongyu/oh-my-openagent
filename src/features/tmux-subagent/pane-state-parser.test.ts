/// <reference path="../../../bun-test.d.ts" />

import { describe, expect, it } from "bun:test"
import { parsePaneStateOutput } from "./pane-state-parser"

describe("parsePaneStateOutput", () => {
  it("rejects malformed integer fields", () => {
    // given
    const stdout = "%0\t120oops\t40\t0\t0\t1\t120\t40\n"

    // when
    const result = parsePaneStateOutput(stdout)

    // then
    expect(result).toBe(null)
  })

  it("rejects negative integer fields", () => {
    // given
    const stdout = "%0\t-1\t40\t0\t0\t1\t120\t40\n"

    // when
    const result = parsePaneStateOutput(stdout)

    // then
    expect(result).toBe(null)
  })

  it("rejects empty integer fields", () => {
    // given
    const stdout = "%0\t\t40\t0\t0\t1\t120\t40\n"

    // when
    const result = parsePaneStateOutput(stdout)

    // then
    expect(result).toBe(null)
  })

  it("rejects non-binary active flags", () => {
    // given
    const stdout = "%0\t120\t40\t0\t0\tx\t120\t40\n"

    // when
    const result = parsePaneStateOutput(stdout)

    // then
    expect(result).toBe(null)
  })

  it("rejects numeric active flags other than zero or one", () => {
    // given
    const stdout = "%0\t120\t40\t0\t0\t2\t120\t40\n"

    // when
    const result = parsePaneStateOutput(stdout)

    // then
    expect(result).toBe(null)
  })

  it("rejects empty active flags", () => {
    // given
    const stdout = "%0\t120\t40\t0\t0\t\t120\t40\n"

    // when
    const result = parsePaneStateOutput(stdout)

    // then
    expect(result).toBe(null)
  })
})

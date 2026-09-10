import { describe, expect, test } from "bun:test"

import { barWidth, field, heading, LABEL_WIDTH } from "./layout"

describe("section layout", () => {
  test("#given a summary #when a heading is built #then it reads as name plus summary in the accent colour", () => {
    // given
    const name = "SESSION"

    // when
    const row = heading(name, "$1.20 · 45K")

    // then
    expect(row).toEqual({ text: "SESSION  $1.20 · 45K", color: "accent" })
  })

  test("#given no summary #when a heading is built #then only the name is rendered", () => {
    // given
    const name = "CONTEXT"

    // when
    const row = heading(name)

    // then
    expect(row.text).toBe("CONTEXT")
  })

  test("#given labels of different lengths #when fields are built #then values start at the same column", () => {
    // given
    const short = field("model", "opus")
    const long = field("elapsed", "4m30")

    // when
    const columns = [short.text.indexOf("opus"), long.text.indexOf("4m30")]

    // then
    expect(columns).toEqual([LABEL_WIDTH, LABEL_WIDTH])
  })

  test("#given a narrow column #when a bar width is asked #then it never goes negative", () => {
    // given
    const width = 4

    // when
    const resolved = barWidth(width, 5)

    // then
    expect(resolved).toBe(0)
  })
})

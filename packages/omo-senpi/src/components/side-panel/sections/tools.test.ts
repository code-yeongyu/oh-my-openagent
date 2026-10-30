import { describe, expect, test } from "bun:test"

import type { PanelToolCall } from "../store"
import { buildToolRows } from "./tools"

const texts = (rows: readonly { text: string }[]): string[] => rows.map((row) => row.text)

describe("buildToolRows", () => {
  test("#given no calls #when built #then the section stays empty", () => {
    // given
    const tools: readonly PanelToolCall[] = []

    // when
    const rows = buildToolRows(tools, 40, 4)

    // then
    expect(rows).toEqual([])
  })

  test("#given a call with a detail #when built #then name and detail share the row", () => {
    // given
    const tools = [{ name: "read", detail: "src/index.ts", at: 1 }]

    // when
    const rows = texts(buildToolRows(tools, 40, 4))

    // then
    expect(rows).toEqual(["TOOLS  1", "read  src/index.ts"])
  })

  test("#given a call without a detail #when built #then only the name is rendered", () => {
    // given
    const tools = [{ name: "bash", at: 1 }]

    // when
    const rows = texts(buildToolRows(tools, 40, 4))

    // then
    expect(rows[1]).toBe("bash")
  })

  test("#given more calls than fit #when built #then the tail is shown and the rest is counted", () => {
    // given
    const tools = [1, 2, 3, 4, 5, 6].map((index) => ({ name: `tool${index}`, at: index }))

    // when
    const rows = texts(buildToolRows(tools, 40, 2))

    // then
    expect(rows).toEqual(["TOOLS  6 · +4 earlier", "tool5", "tool6"])
  })

  test("#given no room for rows #when built #then nothing is rendered", () => {
    // given
    const tools = [{ name: "read", at: 1 }]

    // when
    const rows = buildToolRows(tools, 40, 0)

    // then
    expect(rows).toEqual([])
  })

  test("#given a long detail #when built #then the row is cut to the column", () => {
    // given
    const tools = [{ name: "read", detail: "a/very/long/path/that/keeps/going/forever.ts", at: 1 }]

    // when
    const rows = buildToolRows(tools, 18, 4)

    // then
    expect(rows[1]?.text.length).toBeLessThanOrEqual(18)
  })
})

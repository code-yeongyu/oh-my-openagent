/// <reference types="bun-types/test" />

import { describe, expect, it } from "bun:test"
import { parsePaneStateOutput } from "./pane-state-parser"

describe("parsePaneStateOutput", () => {
  it("accepts a single pane when tmux omits the empty trailing title field", () => {
    // given
    const stdout = "%0\t120\t40\t0\t0\t1\t120\t40\n"

    // when
    const result = parsePaneStateOutput(stdout)

    // then
    expect(result).not.toBe(null)
    expect(result).toEqual({
      windowWidth: 120,
      windowHeight: 40,
      panes: [
        {
          paneId: "%0",
          width: 120,
          height: 40,
          left: 0,
          top: 0,
          title: "",
          isActive: true,
        },
      ],
    })
  })

  it("handles CRLF line endings without dropping panes", () => {
    // given
    const stdout = "%0\t120\t40\t0\t0\t1\t120\t40\r\n%1\t60\t40\t60\t0\t0\t120\t40\tagent\r\n"

    // when
    const result = parsePaneStateOutput(stdout)

    // then
    expect(result).not.toBe(null)
    expect(result?.panes).toEqual([
      {
        paneId: "%0",
        width: 120,
        height: 40,
        left: 0,
        top: 0,
        title: "",
        isActive: true,
      },
      {
        paneId: "%1",
        width: 60,
        height: 40,
        left: 60,
        top: 0,
        title: "agent",
        isActive: false,
      },
    ])
  })

  it("preserves tabs inside pane titles", () => {
    // given
    const stdout = "%0\t120\t40\t0\t0\t1\t120\t40\ttitle\twith\ttabs\n"

    // when
    const result = parsePaneStateOutput(stdout)

    // then
    expect(result).not.toBe(null)
    expect(result?.panes[0]?.title).toBe("title\twith\ttabs")
  })
})

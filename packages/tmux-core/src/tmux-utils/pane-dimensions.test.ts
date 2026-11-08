import { describe, expect, it } from "bun:test"

import type { TmuxCommandResult } from "../runner"
import { getPaneDimensions } from "./pane-dimensions"

function tmuxResult(output: string, exitCode = 0): TmuxCommandResult {
  return {
    success: exitCode === 0,
    output,
    stdout: output,
    stderr: exitCode === 0 ? "" : "tmux failed",
    exitCode,
  }
}

describe("getPaneDimensions runner integration", () => {
  it("#given pane id #when getPaneDimensions called #then delegates display to injected runner", async () => {
    // given
    const calls: Array<[string, string[]]> = []
    const runTmuxCommand = async (tmuxPath: string, args: string[]): Promise<TmuxCommandResult> => {
      calls.push([tmuxPath, [...args]])
      return tmuxResult("80,160")
    }

    // when
    const result = await getPaneDimensions("%42", {
      getTmuxPath: async () => "sh",
      runTmuxCommand,
    })

    // then
    expect(result).toEqual({ paneWidth: 80, windowWidth: 160 })
    expect(calls).toEqual([
      ["sh", ["display", "-p", "-t", "%42", "#{pane_width},#{window_width}"]],
    ])
  })

  it("#given no tmux path #when getPaneDimensions called #then returns null without invoking runner", async () => {
    // given
    const calls: Array<[string, string[]]> = []
    const runTmuxCommand = async (tmuxPath: string, args: string[]): Promise<TmuxCommandResult> => {
      calls.push([tmuxPath, [...args]])
      return tmuxResult("80,160")
    }

    // when
    const result = await getPaneDimensions("%42", {
      getTmuxPath: async () => null,
      runTmuxCommand,
    })

    // then
    expect(result).toBeNull()
    expect(calls).toEqual([])
  })

  it("#given tmux command fails #when getPaneDimensions called #then returns null", async () => {
    // when
    const result = await getPaneDimensions("%42", {
      getTmuxPath: async () => "tmux",
      runTmuxCommand: async () => tmuxResult("", 1),
    })

    // then
    expect(result).toBeNull()
  })

  it("#given tmux output is not numeric #when getPaneDimensions called #then returns null", async () => {
    // when
    const result = await getPaneDimensions("%42", {
      getTmuxPath: async () => "tmux",
      runTmuxCommand: async () => tmuxResult("wide,tall"),
    })

    // then
    expect(result).toBeNull()
  })
})

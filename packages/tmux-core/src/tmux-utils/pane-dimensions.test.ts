import { describe, expect, it } from "bun:test"

import type { TmuxCommandResult } from "../runner"
import { getPaneDimensions } from "./pane-dimensions"

describe("getPaneDimensions runner integration", () => {
  it("#given pane id #when getPaneDimensions called #then delegates display to injected runner", async () => {
    // given
    const calls: Array<[string, string[]]> = []
    const runTmuxCommand = async (tmuxPath: string, args: string[]): Promise<TmuxCommandResult> => {
      calls.push([tmuxPath, [...args]])
      return {
        success: true,
        output: "80,160",
        stdout: "80,160",
        stderr: "",
        exitCode: 0,
      }
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
})

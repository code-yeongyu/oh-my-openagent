import { describe, expect, test } from "bun:test"

import type { TeamLayoutDeps } from "./layout-types"
import {
  captureTeamLayoutExecutionTarget,
  matchesTeamLayoutExecutionTarget,
} from "./execution-target"
import { runTeamTmuxCommand } from "./team-tmux-command"

function createDeps(
  environment: Readonly<Record<string, string | undefined>>,
  runnerCalls: string[][],
): TeamLayoutDeps {
  return {
    getEnvironment: () => environment,
    getTmuxPath: async () => "cmux",
    isServerRunning: async () => true,
    log: () => undefined,
    resolveCallerTmuxSession: async () => null,
    runTmuxCommand: async (_path, args) => {
      runnerCalls.push(args)
      return { success: true, output: "", stdout: "", stderr: "", exitCode: 0 }
    },
  }
}

describe("Team layout execution target identity", () => {
  test("rejects a native TMUX identity that appears after a socket-only cmux capture", async () => {
    const target = captureTeamLayoutExecutionTarget(true, {
      CMUX_SOCKET_PATH: "/tmp/cmux-a.sock",
    })
    expect(target).toEqual({
      backend: "cmux",
      cmuxSocketPath: "/tmp/cmux-a.sock",
    })
    if (!target) throw new Error("expected execution target")

    const changedEnvironment = {
      CMUX_SOCKET_PATH: "/tmp/cmux-a.sock",
      TMUX: "/tmp/native-tmux.sock,123,0",
    }
    expect(matchesTeamLayoutExecutionTarget(target, changedEnvironment)).toBe(false)
    expect(matchesTeamLayoutExecutionTarget(target, {
      CMUX_SOCKET_PATH: "/tmp/cmux-a.sock",
      TMUX: "x".repeat(4097),
    })).toBe(false)
    const runnerCalls: string[][] = []
    const result = await runTeamTmuxCommand(
      "cmux",
      target,
      {},
      createDeps(changedEnvironment, runnerCalls),
      "team-run",
      () => ["list-panes"],
    )
    expect(result.success).toBe(false)
    expect(runnerCalls).toEqual([])
  })

  test("rejects a cmux socket identity that appears after a cmuxterm-only capture", () => {
    const target = captureTeamLayoutExecutionTarget(true, {
      TMUX: "/tmp/cmuxterm.sock,123,0",
    })
    expect(target).toEqual({
      backend: "cmux",
      tmuxEnvironment: "/tmp/cmuxterm.sock,123,0",
    })
    if (!target) throw new Error("expected execution target")

    expect(matchesTeamLayoutExecutionTarget(target, {
      CMUX_SOCKET_PATH: "/tmp/cmux-b.sock",
      TMUX: "/tmp/cmuxterm.sock,123,0",
    })).toBe(false)
    expect(matchesTeamLayoutExecutionTarget(target, {
      CMUX_SOCKET_PATH: "x".repeat(4097),
      TMUX: "/tmp/cmuxterm.sock,123,0",
    })).toBe(false)
  })
})

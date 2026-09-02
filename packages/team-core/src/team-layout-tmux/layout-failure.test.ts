/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

import { createTeamLayoutWithReason, type TeamLayoutDeps } from "./layout"

const members = [
  { name: "member-1", sessionId: "session-1", worktreePath: "/tmp/member-1" },
  { name: "member-2", sessionId: "session-2", worktreePath: "/tmp/member-2" },
]

const tmuxManager = { getServerUrl: () => "http://127.0.0.1:4096" }
const originalTmux = process.env.TMUX

function result(output = "", success = true) {
  return {
    success,
    output,
    stdout: output,
    stderr: success ? "" : "tmux failed",
    exitCode: success ? 0 : 1,
  }
}

function createDeps(failAt: string) {
  let splitCount = 0
  const commands: string[][] = []
  const runTmuxCommand = mock(async (_tmuxPath: string, args: string[]) => {
    commands.push(args)
    const command = args[0]
    if (command === "list-panes") return result("%caller\n%existing")
    if (command === "split-window") {
      splitCount += 1
      if (failAt === `split-${splitCount}`) return result("", false)
      return result(`%new-${splitCount}`)
    }
    if (command === failAt) return result("", false)
    return result()
  })
  const log = mock(() => undefined)
  const deps: TeamLayoutDeps = {
    runTmuxCommand,
    isServerRunning: async () => true,
    getTmuxPath: async () => "tmux",
    resolveCallerTmuxSession: async () => ({
      sessionId: "$1",
      paneId: "%caller",
      windowTarget: "team:0",
    }),
    log,
  }
  return { commands, deps, log }
}

function killedPanes(commands: string[][]): string[] {
  return commands
    .filter((args) => args[0] === "kill-pane")
    .map((args) => args[2] ?? "")
}

describe("createTeamLayoutWithReason failure cleanup", () => {
  beforeEach(() => {
    process.env.TMUX = "/tmp/tmux-test"
  })

  afterEach(() => {
    if (originalTmux === undefined) delete process.env.TMUX
    else process.env.TMUX = originalTmux
  })

  test("#given one pane was created #when a later split fails #then only the created pane is killed", async () => {
    // given
    const { commands, deps } = createDeps("split-2")

    // when
    const attempt = await createTeamLayoutWithReason("run-split", members, tmuxManager, deps)

    // then
    expect(attempt.layout).toBeNull()
    expect(killedPanes(commands)).toEqual(["%new-1"])
  })

  test("#given a pane was created #when pane setup fails #then the created pane is killed", async () => {
    // given
    const { commands, deps } = createDeps("select-pane")

    // when
    const attempt = await createTeamLayoutWithReason("run-setup", members.slice(0, 1), tmuxManager, deps)

    // then
    expect(attempt.layout).toBeNull()
    expect(killedPanes(commands)).toEqual(["%new-1"])
  })

  test.each(["select-layout", "resize-pane"])(
    "#given team panes were created #when %s fails #then all attempt-owned panes are killed",
    async (failingCommand) => {
      // given
      const { commands, deps } = createDeps(failingCommand)

      // when
      const attempt = await createTeamLayoutWithReason(`run-${failingCommand}`, members, tmuxManager, deps)

      // then
      expect(attempt.layout).toBeNull()
      expect(killedPanes(commands)).toEqual(["%new-1", "%new-2"])
      expect(killedPanes(commands)).not.toContain("%existing")
    },
  )

  test("#given an internal tmux dependency throws #when layout creation fails #then the user reason is stable and the raw detail is logged", async () => {
    // given
    const { deps, log } = createDeps("never")
    deps.getTmuxPath = async () => {
      throw new Error("private path /tmp/secret-session and token-shaped detail")
    }

    // when
    const attempt = await createTeamLayoutWithReason("run-private-error", members, tmuxManager, deps)

    // then
    expect(attempt.skipReason).toBe("tmux visualization unavailable: internal tmux operation failed")
    expect(attempt.skipReason).not.toContain("/tmp/secret-session")
    expect(log).toHaveBeenCalledWith("tmux visualization unavailable, skipping", {
      error: "Error: private path /tmp/secret-session and token-shaped detail",
    })
  })
})

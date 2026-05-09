/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

import * as sharedModule from "../../../shared"
import * as sharedTmuxModule from "../../../shared/tmux"
import * as tmuxPathResolverModule from "../../../tools/interactive-bash/tmux-path-resolver"
import * as resolveCallerTmuxSessionModule from "./resolve-caller-tmux-session"
import { canVisualize, createTeamLayout, removeTeamLayout, type TeamLayoutCleanupTarget, type TeamLayoutDeps } from "./layout"

let nextWindowNumber = 1
let nextPaneNumber = 1
let displaySessionId = "$7"
let displaySuccess = true
const panesByWindow = new Map<string, string[]>()

function createTmuxCommandResult(output: string, success = true) {
  return {
    success,
    output,
    stdout: output,
    stderr: success ? "" : "error",
    exitCode: success ? 0 : 1,
  }
}

function defaultRunTmuxCommand(_tmuxPath: string, args: Array<string>, _options?: unknown) {
  const command = args[0]

  if (command === "display" && args.includes("#{session_name}:#{window_index}")) {
    return Promise.resolve(createTmuxCommandResult("test-session:0"))
  }

  if (command === "display" && args.includes("#{window_id}")) {
    return Promise.resolve(createTmuxCommandResult("@1"))
  }

  if (command === "display" && args.includes("#{pane_current_command}")) {
    return Promise.resolve(createTmuxCommandResult("fish"))
  }

  if (command === "display") {
    return Promise.resolve(createTmuxCommandResult(displaySessionId, displaySuccess))
  }

  if (command === "list-panes") {
    const windowTarget = args[2] ?? ""
    const allPanes = panesByWindow.get(windowTarget) ?? [process.env.TMUX_PANE ?? "%0"]
    return Promise.resolve(createTmuxCommandResult(allPanes.join("\n")))
  }

  if (command === "new-session") {
    return Promise.resolve(createTmuxCommandResult(`@${nextWindowNumber++}`))
  }

  if (command === "new-window") {
    const windowId = `@${nextWindowNumber++}`
    const paneId = `%${nextPaneNumber++}`
    panesByWindow.set(windowId, [paneId])
    return Promise.resolve(createTmuxCommandResult(`${windowId} ${paneId}`))
  }

  if (command === "split-window") {
    const paneId = `%${nextPaneNumber++}`
    const targetPane = args[args.indexOf("-t") + 1]
    const matchedEntry = Array.from(panesByWindow.entries()).find(([, panes]) => panes.includes(targetPane ?? ""))
    if (matchedEntry) {
      matchedEntry[1].push(paneId)
    }
    return Promise.resolve(createTmuxCommandResult(paneId))
  }

  return Promise.resolve(createTmuxCommandResult(""))
}

const runTmuxCommandMock = mock(defaultRunTmuxCommand)

const isServerRunningMock = mock(async (_serverUrl: string) => true)

async function loadLayoutModule() {
  const deps: TeamLayoutDeps = {
    runTmuxCommand: runTmuxCommandMock,
    isServerRunning: isServerRunningMock,
    getTmuxPath: async () => "tmux",
    resolveCallerTmuxSession: async () => {
      if (!process.env.TMUX_PANE || !displaySuccess || !/^\$[0-9]+$/.test(displaySessionId)) {
        return null
      }

      return { sessionId: displaySessionId, paneId: process.env.TMUX_PANE, windowTarget: "test-session:0" }
    },
    detectServerPortOwnership: async () => ({ hasOwnPort: true }),
  }
  return {
    canVisualize,
    createTeamLayout: (teamRunId: string, members: Parameters<typeof createTeamLayout>[1], tmuxMgr: Parameters<typeof createTeamLayout>[2]) => {
      return createTeamLayout(teamRunId, members, tmuxMgr, deps)
    },
    removeTeamLayout: (
      teamRunId: string,
      cleanupTarget: TeamLayoutCleanupTarget | undefined,
      tmuxMgr: Parameters<typeof removeTeamLayout>[2],
    ) => removeTeamLayout(teamRunId, cleanupTarget, tmuxMgr, deps),
  }
}

type TmuxMgrLike = { getServerUrl: () => string }

const tmuxMgr: TmuxMgrLike = { getServerUrl: () => "http://127.0.0.1:12345" }

function getCommands(): Array<Array<string>> {
  return Array.from(runTmuxCommandMock.mock.calls, (call) => call[1])
}

describe("team-layout-tmux", () => {
  afterEach(() => {
    mock.restore()
  })

  beforeEach(() => {
    runTmuxCommandMock.mockClear()
    isServerRunningMock.mockClear()
    isServerRunningMock.mockImplementation(async () => true)
    nextWindowNumber = 1
    nextPaneNumber = 1
    displaySessionId = "$7"
    displaySuccess = true
    panesByWindow.clear()
    runTmuxCommandMock.mockImplementation(defaultRunTmuxCommand)
    process.env.TMUX = "/tmp/tmux-1"
    process.env.TMUX_PANE = "%42"
    spyOn(tmuxPathResolverModule, "getTmuxPath").mockResolvedValue("tmux")
    spyOn(sharedModule, "log").mockImplementation(() => undefined)
    spyOn(sharedTmuxModule, "isServerRunning").mockImplementation(isServerRunningMock)
    spyOn(sharedTmuxModule, "runTmuxCommand").mockImplementation(runTmuxCommandMock)
    spyOn(resolveCallerTmuxSessionModule, "resolveCallerTmuxSession").mockImplementation(async () => {
      if (!process.env.TMUX_PANE || !displaySuccess || !/^\$[0-9]+$/.test(displaySessionId)) {
        return null
      }

      return { sessionId: displaySessionId, paneId: process.env.TMUX_PANE, windowTarget: "test-session:0" }
    })
  })

  test("returns null and makes no tmux calls when visualization unavailable", async () => {
    // given
    delete process.env.TMUX
    const { canVisualize, createTeamLayout } = await loadLayoutModule()

    // when
    const result = await createTeamLayout("run-1", [], tmuxMgr as never)

    // then
    expect(canVisualize()).toBe(false)
    expect(result).toBeNull()
    expect(runTmuxCommandMock).toHaveBeenCalledTimes(0)
  })

  test("returns null when server health check fails", async () => {
    // given
    isServerRunningMock.mockImplementation(async () => false)
    const { createTeamLayout } = await loadLayoutModule()

    // when
    const result = await createTeamLayout(
      "run-health",
      [{ name: "lead", sessionId: "s1", worktreePath: "/tmp/lead" }],
      tmuxMgr as never,
    )

    // then
    expect(result).toBeNull()
    expect(runTmuxCommandMock).toHaveBeenCalledTimes(0)
  })

  test("creates teammate panes in the caller window and sends attach via send-keys", async () => {
    // given
    const { createTeamLayout } = await loadLayoutModule()
    const members = [
      { name: "m1", sessionId: "s-m1", worktreePath: "/tmp/m1" },
      { name: "m2", sessionId: "s-m2", worktreePath: "/tmp/m2" },
    ]

    // when
    await createTeamLayout("run-attach", members, tmuxMgr as never)

    // then
    const commands = getCommands()
    expect(commands.filter((args) => args[0] === "new-window")).toHaveLength(1)
    expect(commands.filter((args) => args[0] === "split-window")).toHaveLength(3)

    const sendKeysCalls = commands.filter((args) => args[0] === "send-keys")
    const literals = sendKeysCalls.map((args) => args.join(" "))
    expect(literals.filter((s) => s.includes("opencode attach "))).toHaveLength(2)
    expect(literals.filter((s) => s.includes("python3 -u "))).toHaveLength(2)
    expect(literals.some((s) => s.includes("opencode attach 'http://127.0.0.1:12345' --session 's-m1' --dir '/tmp/m1'"))).toBe(true)
    expect(literals.some((s) => s.includes("opencode attach 'http://127.0.0.1:12345' --session 's-m2' --dir '/tmp/m2'"))).toBe(true)
    expect(literals.some((s) => s.includes("python3 -u ") && s.includes("'s-m1'"))).toBe(true)
    expect(literals.some((s) => s.includes("python3 -u ") && s.includes("'s-m2'"))).toBe(true)
  })

  test("passes --insecure to live-tail only when tmux option is enabled", async () => {
    // given
    const deps: TeamLayoutDeps = {
      runTmuxCommand: runTmuxCommandMock,
      isServerRunning: isServerRunningMock,
      getTmuxPath: async () => "tmux",
      resolveCallerTmuxSession: async () => ({ sessionId: "$7", paneId: process.env.TMUX_PANE ?? "%42", windowTarget: "test-session:0" }),
      detectServerPortOwnership: async () => ({ hasOwnPort: true }),
    }
    const members = [{ name: "m1", sessionId: "s-m1", worktreePath: "/tmp/m1" }]

    // when
    await createTeamLayout("run-strict", members, tmuxMgr as never, deps, { allowInsecureLocalTls: false })
    await createTeamLayout("run-insecure", members, tmuxMgr as never, deps, { allowInsecureLocalTls: true })

    // then
    const sendKeysCalls = getCommands().filter((args) => args[0] === "send-keys")
    const liveTailLiterals = sendKeysCalls.map((args) => args.join(" ")).filter((literal) => literal.includes("python3 -u "))
    const strictLiteral = liveTailLiterals[0] ?? ""
    const insecureLiteral = liveTailLiterals[1] ?? ""
    expect(strictLiteral).not.toContain(" --insecure")
    expect(insecureLiteral).toContain(" --insecure")
  })

  test("uses caller window main-vertical layout with caller pane as primary", async () => {
    // given
    const { createTeamLayout } = await loadLayoutModule()
    const members = [
      { name: "m1", sessionId: "s-m1", worktreePath: "/tmp/m1" },
      { name: "m2", sessionId: "s-m2", worktreePath: "/tmp/m2" },
      { name: "m3", sessionId: "s-m3", worktreePath: "/tmp/m3" },
    ]

    // when
    const result = await createTeamLayout("run-layout", members, tmuxMgr as never)

    // then
    const commands = getCommands()
    const selectLayoutArgs = commands.filter((args) => args[0] === "select-layout").map((args) => args[args.length - 1])
    expect(selectLayoutArgs).toContain("main-vertical")
    expect(selectLayoutArgs).toContain("tiled")
    expect(commands).toContainEqual(["resize-pane", "-t", process.env.TMUX_PANE ?? "", "-x", "30%"])
    expect(result).not.toBeNull()
    expect(Object.keys(result?.focusPanesByMember ?? {}).sort()).toEqual(["m1", "m2", "m3"])
    expect(Object.keys(result?.gridPanesByMember ?? {}).sort()).toEqual(["m1", "m2", "m3"])
    // Without refresh-client, attached tmux clients can leave the freshly-
    // split panes blank-rendered until the user types or focuses a pane —
    // which makes the live-tail look frozen even though it's streaming.
    const refreshIdx = commands.findIndex((args) => args[0] === "refresh-client")
    const lastResizeIdx = commands.map((c) => c[0]).lastIndexOf("resize-pane")
    const mainSelectLayoutIdx = commands.findIndex((args) => args[0] === "select-layout" && args[args.length - 1] === "main-vertical")
    expect(refreshIdx).toBeGreaterThan(mainSelectLayoutIdx)
    expect(refreshIdx).toBeGreaterThan(lastResizeIdx)
  })

  test("#given 4 or more teammates #when createTeamLayout runs #then it keeps every teammate in the caller window", async () => {
    // given
    const { createTeamLayout } = await loadLayoutModule()
    const members = Array.from({ length: 5 }, (_, index) => ({
      name: `m${index + 1}`,
      sessionId: `s-m${index + 1}`,
      worktreePath: `/tmp/m${index + 1}`,
    }))

    // when
    await createTeamLayout("run-tiled", members, tmuxMgr as never)

    // then
    const commands = getCommands()
    expect(commands.filter((args) => args[0] === "new-window")).toHaveLength(1)
    expect(commands.filter((args) => args[0] === "split-window")).toHaveLength(9)
    const selectLayoutArgs = commands.filter((args) => args[0] === "select-layout").map((args) => args[args.length - 1])
    expect(selectLayoutArgs).toContain("main-vertical")
    expect(selectLayoutArgs).toContain("tiled")
  })

  test("#given caller inside tmux #when createTeamLayout runs #then every split-window and the live-tail new-window pass -d so focus never leaves the caller", async () => {
    // given
    const { createTeamLayout } = await loadLayoutModule()
    const members = [
      { name: "m1", sessionId: "s-m1", worktreePath: "/tmp/m1" },
      { name: "m2", sessionId: "s-m2", worktreePath: "/tmp/m2" },
    ]

    // when
    await createTeamLayout("run-no-steal", members, tmuxMgr as never)

    // then
    const commands = getCommands()
    const splitCalls = commands.filter((args) => args[0] === "split-window")
    const newWindowCalls = commands.filter((args) => args[0] === "new-window")
    expect(splitCalls.length).toBeGreaterThan(0)
    expect(newWindowCalls.length).toBeGreaterThan(0)
    for (const args of splitCalls) {
      expect(args).toContain("-d")
    }
    for (const args of newWindowCalls) {
      expect(args).toContain("-d")
    }
  })

  test("#given layout created #when createTeamLayout finishes #then it explicitly restores the caller's window and pane via select-window/select-pane", async () => {
    // given
    const { createTeamLayout } = await loadLayoutModule()
    const members = [
      { name: "m1", sessionId: "s-m1", worktreePath: "/tmp/m1" },
      { name: "m2", sessionId: "s-m2", worktreePath: "/tmp/m2" },
    ]

    // when
    await createTeamLayout("run-restore", members, tmuxMgr as never)

    // then
    const commands = getCommands()
    const selectWindowIdx = commands.findIndex((args) => args[0] === "select-window" && args.includes("test-session:0"))
    const restorePaneIdx = commands.findIndex((args) =>
      args[0] === "select-pane" && args[1] === "-t" && args[2] === (process.env.TMUX_PANE ?? "") && !args.includes("-T"),
    )
    const lastSplitIdx = commands.map((c) => c[0]).lastIndexOf("split-window")
    expect(selectWindowIdx).toBeGreaterThan(lastSplitIdx)
    expect(restorePaneIdx).toBeGreaterThan(lastSplitIdx)
  })

  test("#given ownedSession=false cleanup #when removeTeamLayout finishes #then it select-window's back to the caller's focusWindowId so tmux does not strand the user on a neighbour window", async () => {
    // given
    const { removeTeamLayout } = await loadLayoutModule()

    // when
    await removeTeamLayout("run-cleanup-restore", {
      ownedSession: false,
      targetSessionId: "$caller",
      focusWindowId: "@10",
      gridWindowId: "@11",
    }, tmuxMgr as never)

    // then
    const commands = getCommands()
    expect(commands).toContainEqual(["select-window", "-t", "@10"])
  })

  test("#given caller inside tmux #when createTeamLayout runs #then it never steals focus mid-build (only the trailing restore-pane onto the caller is allowed) or mutates window border options", async () => {
    // given
    const { createTeamLayout } = await loadLayoutModule()
    const members = Array.from({ length: 5 }, (_, index) => ({
      name: `m${index + 1}`,
      sessionId: `s-m${index + 1}`,
      worktreePath: `/tmp/m${index + 1}`,
    }))

    // when
    await createTeamLayout("run-no-focus", members, tmuxMgr as never)

    // then
    const commands = getCommands()
    const callerPaneId = process.env.TMUX_PANE ?? ""
    const focusStealingSelectPanes = commands.filter((args) =>
      args[0] === "select-pane" && !args.includes("-T") && args[2] !== callerPaneId,
    )
    expect(focusStealingSelectPanes).toHaveLength(0)
    expect(commands.some((args) => args[0] === "set-option")).toBe(false)
  })

  test("#given ownedSession=false and paneIds are provided #when removeTeamLayout runs #then tmux kills panes and reaps only the live-tail window", async () => {
    // given
    const { removeTeamLayout } = await loadLayoutModule()

    // when
    await removeTeamLayout("run-cleanup", {
      ownedSession: false,
      targetSessionId: "$caller",
      focusWindowId: "@10",
      gridWindowId: "@11",
      paneIds: ["%1", "%2", "%3"],
    }, tmuxMgr as never)

    // then
    const commands = getCommands()
    expect(commands).toContainEqual(["kill-pane", "-t", "%1"])
    expect(commands).toContainEqual(["kill-pane", "-t", "%2"])
    expect(commands).toContainEqual(["kill-pane", "-t", "%3"])
    expect(commands).toContainEqual(["kill-window", "-t", "@11"])
    expect(commands).not.toContainEqual(["kill-window", "-t", "@10"])
    expect(commands.some((args) => args[0] === "kill-session")).toBe(false)
  })

  test("#given ownedSession=false, no paneIds, focusWindowId=@10, gridWindowId=@11 #when removeTeamLayout runs #then ONLY gridWindowId is killed (focusWindowId is the caller's window) and kill-session is NEVER called", async () => {
    // given
    const { removeTeamLayout } = await loadLayoutModule()

    // when
    await removeTeamLayout("run-cleanup", {
      ownedSession: false,
      targetSessionId: "$caller",
      focusWindowId: "@10",
      gridWindowId: "@11",
    }, tmuxMgr as never)

    // then
    const commands = getCommands()
    // The caller's window (@10) MUST NOT be killed when ownedSession=false —
    // doing so destroys the lead's pane and any sibling user panes.
    expect(commands).not.toContainEqual(["kill-window", "-t", "@10"])
    expect(commands).toContainEqual(["kill-window", "-t", "@11"])
    expect(commands.some((args) => args[0] === "kill-session")).toBe(false)
  })

  test("#given ownedSession=false, no paneIds, only focusWindowId set #when removeTeamLayout runs #then no windows are killed (no-op cleanup is safer than destroying the caller's window)", async () => {
    // given
    const { removeTeamLayout } = await loadLayoutModule()

    // when
    await removeTeamLayout("run-cleanup", {
      ownedSession: false,
      targetSessionId: "$caller",
      focusWindowId: "@10",
    }, tmuxMgr as never)

    // then
    const commands = getCommands()
    expect(commands.some((args) => args[0] === "kill-window")).toBe(false)
    expect(commands.some((args) => args[0] === "kill-session")).toBe(false)
  })

  test("#given ownedSession=true, targetSessionId='omo-team-xyz' #when removeTeamLayout runs #then kill-session is called with -t omo-team-xyz (legacy behavior preserved)", async () => {
    // given
    const { removeTeamLayout } = await loadLayoutModule()

    // when
    await removeTeamLayout("run-cleanup", {
      ownedSession: true,
      targetSessionId: "omo-team-xyz",
      focusWindowId: "@10",
      gridWindowId: "@11",
    }, tmuxMgr as never)

    // then
    const commands = getCommands()
    expect(commands).toContainEqual(["kill-session", "-t", "omo-team-xyz"])
  })

  test("#given ownedSession=false and kill-window on the grid window fails #when removeTeamLayout runs #then the failure is swallowed without ever attempting to kill the caller's focusWindowId", async () => {
    // given
    const { removeTeamLayout } = await loadLayoutModule()
    runTmuxCommandMock.mockImplementation((_tmuxPath: string, args: Array<string>, _options?: unknown) => {
      if (args[0] === "kill-window") {
        return Promise.resolve(createTmuxCommandResult("", false))
      }

      const command = args[0]
      if (command === "display") {
        return Promise.resolve(createTmuxCommandResult(displaySessionId, displaySuccess))
      }
      if (command === "new-session") {
        return Promise.resolve(createTmuxCommandResult(`@${nextWindowNumber++}`))
      }
      if (command === "new-window") {
        return Promise.resolve(createTmuxCommandResult(`@${nextWindowNumber++} %${nextPaneNumber++}`))
      }
      if (command === "split-window") {
        return Promise.resolve(createTmuxCommandResult(`%${nextPaneNumber++}`))
      }

      return Promise.resolve(createTmuxCommandResult(""))
    })

    // when
    await removeTeamLayout("run-cleanup", {
      ownedSession: false,
      targetSessionId: "$caller",
      focusWindowId: "@10",
      gridWindowId: "@11",
    }, tmuxMgr as never)

    // then
    const commands = getCommands().filter((args) => args[0] === "kill-window")
    // Only the grid window (@11) is attempted; the caller's window (@10) is
    // never touched even when the grid kill fails.
    expect(commands).toEqual([["kill-window", "-t", "@11"]])
  })

  test("skips all panes when lead member missing", async () => {
    // given
    const { createTeamLayout } = await loadLayoutModule()
    const members: Array<{ name: string; sessionId: string }> = []

    // when
    const result = await createTeamLayout("run-empty", members, tmuxMgr as never)

    // then
    expect(result).toBeNull()
    const commands = getCommands()
    expect(commands.some((args) => args[0] === "new-window")).toBe(false)
  })

  test("#given detectServerPortOwnership returns hasOwnPort=false #when createTeamLayout runs #then createLiveTailWindow returns null without spawning a new-window", async () => {
    // given
    const deps: TeamLayoutDeps = {
      runTmuxCommand: runTmuxCommandMock,
      isServerRunning: isServerRunningMock,
      getTmuxPath: async () => "tmux",
      resolveCallerTmuxSession: async () => ({ sessionId: "$7", paneId: process.env.TMUX_PANE ?? "%42", windowTarget: "test-session:0" }),
      detectServerPortOwnership: async () => ({ hasOwnPort: false, reason: "test: no LISTEN socket" }),
    }
    const members = [{ name: "m1", sessionId: "s-m1", worktreePath: "/tmp/m1" }]

    // when
    const result = await createTeamLayout("run-no-port", members, tmuxMgr as never, deps)

    // then
    expect(result).toBeNull()
    const commands = getCommands()
    expect(commands.some((args) => args[0] === "new-window")).toBe(false)
  })


  describe("createTeamLayout - focus/grid window topology", () => {
    test("#given caller inside tmux #when createTeamLayout runs #then uses the caller window without a new session", async () => {
      // given
      const { createTeamLayout } = await loadLayoutModule()
      const members = [
        { name: "m1", sessionId: "s-m1", worktreePath: "/tmp/m1" },
        { name: "m2", sessionId: "s-m2", worktreePath: "/tmp/m2" },
      ]

      // when
      await createTeamLayout("run-split", members, tmuxMgr as never)

      // then
      const commands = getCommands()
      expect(commands.some((args) => args[0] === "new-session")).toBe(false)
      expect(commands.filter((args) => args[0] === "new-window").length).toBe(1)
      expect(commands.some((args) => args[0] === "split-window" && args.includes(process.env.TMUX_PANE ?? ""))).toBe(true)
    })

    test("#given caller session resolved #when createTeamLayout runs #then ownedSession is false", async () => {
      // given
      const { createTeamLayout } = await loadLayoutModule()
      const members = [{ name: "m1", sessionId: "s-m1", worktreePath: "/tmp/m1" }]

      // when
      const result = await createTeamLayout("run-owned", members, tmuxMgr as never)

      // then
      expect(result).not.toBeNull()
      expect(result?.ownedSession).toBe(false)
    })

    test("#given first teammate #when layout runs #then it splits the caller pane horizontally for teammate area", async () => {
      // given
      const { createTeamLayout } = await loadLayoutModule()
      const members = [{ name: "m1", sessionId: "s-m1", worktreePath: "/tmp/m1" }]

      // when
      await createTeamLayout("run-first", members, tmuxMgr as never)

      // then
      const commands = getCommands()
      const splitCalls = commands.filter((args) => args[0] === "split-window")
      expect(splitCalls).toEqual([
        ["split-window", "-d", "-t", process.env.TMUX_PANE ?? "", "-h", "-l", "70%", "-P", "-F", "#{pane_id}", "-c", "/tmp/m1"],
      ])
      expect(commands.filter((args) => args[0] === "new-window").length).toBe(1)
    })

    test("#given 3 members #when createTeamLayout runs #then focusPanesByMember contains 3 distinct pane ids", async () => {
      // given
      const { createTeamLayout } = await loadLayoutModule()
      const members = [
        { name: "m1", sessionId: "s-m1", worktreePath: "/tmp/m1" },
        { name: "m2", sessionId: "s-m2", worktreePath: "/tmp/m2" },
        { name: "m3", sessionId: "s-m3", worktreePath: "/tmp/m3" },
      ]

      // when
      const result = await createTeamLayout("run-3-members", members, tmuxMgr as never)

      // then
      expect(result).not.toBeNull()
      expect(Object.keys(result?.focusPanesByMember ?? {}).sort()).toEqual(["m1", "m2", "m3"])
      expect(new Set(Object.values(result?.focusPanesByMember ?? {})).size).toBe(3)
    })

    test("#given layout created #when createTeamLayout runs #then it records focus and live-tail panes", async () => {
      // given
      const { createTeamLayout } = await loadLayoutModule()
      const members = [
        { name: "m1", sessionId: "s-m1", worktreePath: "/tmp/m1" },
        { name: "m2", sessionId: "s-m2", worktreePath: "/tmp/m2" },
      ]

      // when
      const result = await createTeamLayout("run-layout", members, tmuxMgr as never)

      // then
      const commands = getCommands()
      expect(result).not.toBeNull()
      expect(Object.keys(result?.focusPanesByMember ?? {}).sort()).toEqual(["m1", "m2"])
      expect(Object.keys(result?.gridPanesByMember ?? {}).sort()).toEqual(["m1", "m2"])
      expect(result?.focusWindowId).toBe("test-session:0")
      expect(result?.gridWindowId).toBe("@1")
      expect(commands.filter((args) => args[0] === "new-window").length).toBe(1)
      expect(commands.some((args) => args[0] === "send-keys" && args.includes("Enter"))).toBe(true)
    })
  })
})

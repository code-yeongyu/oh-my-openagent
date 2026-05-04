/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

import * as sharedModule from "../../../shared"
import * as sharedTmuxModule from "../../../shared/tmux"
import * as tmuxPathResolverModule from "../../../tools/interactive-bash/tmux-path-resolver"
import * as resolveCallerTmuxSessionModule from "./resolve-caller-tmux-session"
import { canVisualize, createTeamLayout, removeTeamLayout } from "./layout"

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
    panesByWindow.set(windowId, [`%${nextPaneNumber++}`])
    return Promise.resolve(createTmuxCommandResult(windowId))
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
  return { canVisualize, createTeamLayout, removeTeamLayout }
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

      return { sessionId: displaySessionId }
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

  test("creates detached focus and grid windows and sends attach via send-keys", async () => {
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
    const newWindowCalls = commands.filter((args) => args[0] === "new-window")
    expect(newWindowCalls.length).toBe(2)
    expect(newWindowCalls.map((args) => args[args.indexOf("-n") + 1])).toEqual([
      "team-run-attach-focus",
      "team-run-attach-grid",
    ])

    const sendKeysCalls = commands.filter((args) => args[0] === "send-keys")
    const literals = sendKeysCalls.map((args) => args.join(" "))
    expect(literals.some((s) => s.includes("--session 's-m1'"))).toBe(true)
    expect(literals.some((s) => s.includes("--session 's-m2'"))).toBe(true)
  })

  test("uses focus main-vertical and grid tiled windows", async () => {
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
    expect(commands).toContainEqual(["set-window-option", "-t", "@1", "main-pane-width", "60%"])
    expect(result).not.toBeNull()
    expect(Object.keys(result?.focusPanesByMember ?? {}).sort()).toEqual(["m1", "m2", "m3"])
    expect(Object.keys(result?.gridPanesByMember ?? {}).sort()).toEqual(["m1", "m2", "m3"])
  })

  test("#given 4 or more teammates #when createTeamLayout runs #then it still keeps separate focus and grid windows", async () => {
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
    const newWindowNames = commands
      .filter((args) => args[0] === "new-window")
      .map((args) => args[args.indexOf("-n") + 1])
    expect(newWindowNames).toEqual(["team-run-tiled-focus", "team-run-tiled-grid"])
    const selectLayoutArgs = commands.filter((args) => args[0] === "select-layout").map((args) => args[args.length - 1])
    expect(selectLayoutArgs).toContain("main-vertical")
    expect(selectLayoutArgs).toContain("tiled")
  })

  test("#given caller inside tmux #when createTeamLayout runs #then it never steals focus or mutates window border options", async () => {
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
    expect(commands.some((args) => args[0] === "select-pane" && !args.includes("-T"))).toBe(false)
    expect(commands.some((args) => args[0] === "set-option")).toBe(false)
  })

  test("#given ownedSession=false, focusWindowId=@10, gridWindowId=@11 #when removeTeamLayout runs #then tmux kill-window is called twice with -t @10 and -t @11 and kill-session is NEVER called", async () => {
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
    expect(commands).toContainEqual(["kill-window", "-t", "@10"])
    expect(commands).toContainEqual(["kill-window", "-t", "@11"])
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

  test("#given ownedSession=false and the first kill-window fails #when removeTeamLayout runs #then the second kill-window still fires", async () => {
    // given
    const { removeTeamLayout } = await loadLayoutModule()
    let killWindowCallCount = 0
    runTmuxCommandMock.mockImplementation((_tmuxPath: string, args: Array<string>, _options?: unknown) => {
      if (args[0] === "kill-window") {
        killWindowCallCount += 1
        return Promise.resolve(createTmuxCommandResult("", killWindowCallCount > 1))
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
    expect(commands).toEqual([
      ["kill-window", "-t", "@10"],
      ["kill-window", "-t", "@11"],
    ])
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

  describe("createTeamLayout - focus/grid window topology", () => {
    test("#given caller inside tmux #when createTeamLayout runs #then creates focus and grid windows without a new session", async () => {
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
      expect(commands.filter((args) => args[0] === "new-window").length).toBe(2)
      expect(commands.some((args) => args[0] === "split-window" && args.includes(process.env.TMUX_PANE ?? ""))).toBe(false)
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

    test("#given first teammate #when layout runs #then it creates focus and grid windows without splitting the leader pane", async () => {
      // given
      const { createTeamLayout } = await loadLayoutModule()
      const members = [{ name: "m1", sessionId: "s-m1", worktreePath: "/tmp/m1" }]

      // when
      await createTeamLayout("run-first", members, tmuxMgr as never)

      // then
      const commands = getCommands()
      const splitCalls = commands.filter((args) => args[0] === "split-window")
      expect(splitCalls).toEqual([])
      expect(commands.filter((args) => args[0] === "new-window").length).toBe(2)
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

    test("#given layout created #when createTeamLayout runs #then it keeps separate focus and grid pane maps", async () => {
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
      expect(result?.focusWindowId).not.toBe(result?.gridWindowId)
      expect(commands.filter((args) => args[0] === "new-window").length).toBe(2)
      expect(commands.some((args) => args[0] === "send-keys" && args.includes("Enter"))).toBe(true)
    })
  })
})

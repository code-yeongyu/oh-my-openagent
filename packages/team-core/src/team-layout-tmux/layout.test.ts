/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import type { RunTmuxOptions, TmuxServerAccess } from "@oh-my-opencode/tmux-core"

import { canVisualize, createTeamLayout, removeTeamLayout, type TeamLayoutCleanupTarget, type TeamLayoutDeps } from "./layout"

let nextWindowNumber = 1
let nextPaneNumber = 1
let displaySessionId = "$7"
let displaySuccess = true
const panesByWindow = new Map<string, string[]>()
const originalCmuxSocketPath = process.env.CMUX_SOCKET_PATH
const originalOpenCodePassword = process.env.OPENCODE_SERVER_PASSWORD

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
const logMock = mock(() => undefined)

const isServerRunningMock = mock(async (_serverUrl: string) => true)

async function loadLayoutModule(overrides: Partial<TeamLayoutDeps> = {}) {
  const deps: TeamLayoutDeps = {
    runTmuxCommand: runTmuxCommandMock,
    isServerRunning: isServerRunningMock,
    getTmuxPath: async () => "tmux",
    log: logMock,
    resolveCallerTmuxSession: async () => {
      if (!process.env.TMUX_PANE || !displaySuccess || !/^\$[0-9]+$/.test(displaySessionId)) {
        return null
      }

      return { sessionId: displaySessionId, paneId: process.env.TMUX_PANE, windowTarget: "test-session:0" }
    },
    ...overrides,
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

type TmuxMgrLike = {
  getServerUrl: () => string
  getTmuxServerAccess?: () => TmuxServerAccess | undefined
}

const tmuxMgr: TmuxMgrLike = { getServerUrl: () => "http://127.0.0.1:12345" }

function getCommands(): Array<Array<string>> {
  return Array.from(runTmuxCommandMock.mock.calls, (call) => call[1])
}

describe("team-layout-tmux", () => {
  beforeEach(() => {
    runTmuxCommandMock.mockClear()
    logMock.mockClear()
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
    delete process.env.CMUX_SOCKET_PATH
    delete process.env.OPENCODE_SERVER_PASSWORD
  })

  afterEach(() => {
    if (originalCmuxSocketPath === undefined) delete process.env.CMUX_SOCKET_PATH
    else process.env.CMUX_SOCKET_PATH = originalCmuxSocketPath
    if (originalOpenCodePassword === undefined) delete process.env.OPENCODE_SERVER_PASSWORD
    else process.env.OPENCODE_SERVER_PASSWORD = originalOpenCodePassword
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

  test("#given only a cmux socket #when visualization eligibility is checked #then team layout remains available", () => {
    // given
    delete process.env.TMUX
    process.env.CMUX_SOCKET_PATH = "/tmp/cmux-only-visualization-fixture.sock"

    // when / then
    expect(canVisualize()).toBe(true)
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

  test("#given secret-bearing listener URLs #when health fails #then the warning logs only origins", async () => {
    const manager: TmuxMgrLike = {
      getServerUrl: () => { throw new Error("legacy URL must not be read") },
      getCtxServerUrl: () => "https://127.0.0.2:43128/ctx-private?ctx-query=secret#ctx-fragment",
      getTmuxServerAccess: () => ({
        serverUrl: "https://user-fixture:password-fixture@127.0.0.1:43127/private-fixture?query-fixture=secret#fragment-fixture",
        checkServerHealth: async () => false,
        getPaneEnvironment: () => ({}),
      }),
    }
    const { createTeamLayout } = await loadLayoutModule()

    const result = await createTeamLayout(
      "run-log-sanitization",
      [{ name: "lead", sessionId: "s1", worktreePath: "/tmp/lead" }],
      manager as never,
    )

    const serializedLogs = JSON.stringify(logMock.mock.calls)
    expect(result).toBeNull()
    expect(serializedLogs).toContain("https://127.0.0.1:43127")
    expect(serializedLogs).toContain("https://127.0.0.2:43128")
    expect(serializedLogs).toContain("server listener not ready")
    for (const secret of [
      "user-fixture",
      "password-fixture",
      "private-fixture",
      "query-fixture",
      "fragment-fixture",
      "ctx-private",
      "ctx-query",
      "ctx-fragment",
    ]) {
      expect(serializedLogs).not.toContain(secret)
    }
  })

  test("#given tmux path lookup throws a non-Error value #when createTeamLayout runs #then it falls back to null", async () => {
    // given
    const deps: TeamLayoutDeps = {
      runTmuxCommand: runTmuxCommandMock,
      isServerRunning: isServerRunningMock,
      getTmuxPath: async () => Promise.reject("tmux path unavailable"),
      log: logMock,
      resolveCallerTmuxSession: async () => ({ sessionId: "$7", paneId: "%42", windowTarget: "test-session:0" }),
    }
    const members = [{ name: "m1", sessionId: "s-m1", worktreePath: "/tmp/m1" }]

    // when
    const result = await createTeamLayout("run-non-error", members, tmuxMgr as never, deps)

    // then
    expect(result).toBeNull()
    expect(logMock).toHaveBeenCalledWith("tmux visualization unavailable, skipping", { errorType: "string" })
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
    expect(commands.some((args) => args[0] === "new-window")).toBe(false)
    expect(commands.filter((args) => args[0] === "split-window")).toHaveLength(2)

    const sendKeysCalls = commands.filter((args) => args[0] === "send-keys")
    const literals = sendKeysCalls.map((args) => args.join(" "))
    expect(literals.some((s) => s.includes("--session 's-m1'"))).toBe(true)
    expect(literals.some((s) => s.includes("--session 's-m2'"))).toBe(true)
  })

  test("#given a server access capability #when health fails #then it uses the capability health check without consulting the legacy URL", async () => {
    // given
    const checkServerHealth = mock(async () => false)
    const manager: TmuxMgrLike = {
      getServerUrl: () => { throw new Error("legacy URL must not be read") },
      getTmuxServerAccess: () => ({
        serverUrl: "http://127.0.0.1:43127",
        checkServerHealth,
        getPaneEnvironment: () => ({}),
      }),
    }
    const { createTeamLayout } = await loadLayoutModule()

    // when
    const result = await createTeamLayout(
      "run-capability-health",
      [{ name: "m1", sessionId: "s-m1", worktreePath: "/tmp/m1" }],
      manager,
    )

    // then
    expect(result).toBeNull()
    expect(checkServerHealth).toHaveBeenCalledTimes(1)
    expect(isServerRunningMock).toHaveBeenCalledTimes(0)
  })

  test("#given a rotating pane environment #when both split paths create panes #then each pane receives the environment resolved at its own spawn", async () => {
    // given
    let environmentRevision = 0
    const getPaneEnvironment = mock(() => ({
      HARNESS_ENDPOINT: "http://127.0.0.1:43127",
      TEAM_ACCESS_TOKEN: `revision-${++environmentRevision}`,
    }))
    const manager: TmuxMgrLike = {
      getServerUrl: () => { throw new Error("legacy URL must not be read") },
      getTmuxServerAccess: () => ({
        serverUrl: "http://127.0.0.1:43127/capability",
        checkServerHealth: async () => true,
        getPaneEnvironment,
      }),
    }
    const { createTeamLayout } = await loadLayoutModule()
    const members = [
      { name: "m1", sessionId: "s-m1", worktreePath: "/tmp/m1" },
      { name: "m2", sessionId: "s-m2", worktreePath: "/tmp/m2" },
    ]

    // when
    const result = await createTeamLayout("run-rotating-environment", members, manager)

    // then
    expect(result).not.toBeNull()
    const splitCalls = getCommands().filter((args) => args[0] === "split-window")
    expect(splitCalls).toHaveLength(2)
    expect(splitCalls[0]).toContain("HARNESS_ENDPOINT=http://127.0.0.1:43127")
    expect(splitCalls[0]).toContain("TEAM_ACCESS_TOKEN=revision-1")
    expect(splitCalls[0]).not.toContain("TEAM_ACCESS_TOKEN=revision-2")
    expect(splitCalls[1]).toContain("HARNESS_ENDPOINT=http://127.0.0.1:43127")
    expect(splitCalls[1]).toContain("TEAM_ACCESS_TOKEN=revision-2")
    expect(splitCalls[1]).not.toContain("TEAM_ACCESS_TOKEN=revision-1")
    expect(getPaneEnvironment).toHaveBeenCalledTimes(2)

    const attachCommands = getCommands().filter((args) => args[0] === "send-keys")
    expect(attachCommands).toHaveLength(2)
    expect(attachCommands.every((args) => args.join(" ").includes("http://127.0.0.1:43127/capability"))).toBe(true)
  })

  test("#given a legacy manager and ambient credentials #when a native pane is created #then inherited credentials are explicitly cleared", async () => {
    // given
    const ambientVariableName = ["OPEN", "CODE", "_SERVER_", "PASSWORD"].join("")
    const originalValue = process.env[ambientVariableName]
    const ambientValue = "ambient-layout-fixture"
    process.env[ambientVariableName] = ambientValue

    try {
      const { createTeamLayout } = await loadLayoutModule()

      // when
      const result = await createTeamLayout(
        "run-legacy-anonymous",
        [{ name: "m1", sessionId: "s-m1", worktreePath: "/tmp/m1" }],
        tmuxMgr,
      )

      // then
      expect(result).not.toBeNull()
      const split = getCommands().find((args) => args[0] === "split-window")
      expect(split).toBeDefined()
      expect(split).toContain("OPENCODE_SERVER_PASSWORD=")
      expect(split).toContain("OPENCODE_SERVER_USERNAME=")
      expect(split?.some((arg) => arg.includes(ambientValue))).toBe(false)
    } finally {
      if (originalValue === undefined) delete process.env[ambientVariableName]
      else process.env[ambientVariableName] = originalValue
    }
  })

  test("#given the production logical tmux path and anonymous clears #when a cmux team layout is created #then the runner can redirect without environment flags", async () => {
    // given
    const manager: TmuxMgrLike = {
      getServerUrl: () => { throw new Error("legacy URL must not be read") },
      getTmuxServerAccess: () => ({
        serverUrl: "http://127.0.0.1:43127",
        checkServerHealth: async () => true,
        getPaneEnvironment: () => ({
          OPENCODE_SERVER_PASSWORD: "",
          OPENCODE_SERVER_USERNAME: "",
        }),
      }),
    }
    const { createTeamLayout } = await loadLayoutModule({
      isCmuxCompatEnvironment: () => true,
      getTmuxPath: async () => "tmux",
    })

    // when
    const result = await createTeamLayout(
      "run-cmux-anonymous",
      [{ name: "m1", sessionId: "s-m1", worktreePath: "/tmp/m1" }],
      manager,
    )

    // then
    expect(result).not.toBeNull()
    const split = getCommands().find((args) => args[0] === "split-window")
    expect(split).toBeDefined()
    expect(split).not.toContain("-e")
  })

  test("#given a lazy cmux capability #when a team layout is created #then backend resolution precedes the first pane-environment read", async () => {
    // given
    const events: string[] = []
    const manager: TmuxMgrLike = {
      getServerUrl: () => { throw new Error("legacy URL must not be read") },
      getTmuxServerAccess: () => ({
        serverUrl: "http://127.0.0.1:43127",
        checkServerHealth: async () => true,
        getPaneEnvironment: () => {
          events.push("get-environment")
          return {
            OPENCODE_SERVER_PASSWORD: "",
            OPENCODE_SERVER_USERNAME: "",
          }
        },
      }),
    }
    const runTmuxCommand = mock(async (tmuxPath: string, args: Array<string>, options?: RunTmuxOptions) => {
      events.push(`run:${args[0]}`)
      return defaultRunTmuxCommand(tmuxPath, args, options)
    })
    const { createTeamLayout } = await loadLayoutModule({
      isCmuxCompatEnvironment: () => true,
      getTmuxPath: async () => {
        events.push("get-path")
        return "tmux"
      },
      runTmuxCommand,
    })

    // when
    const result = await createTeamLayout(
      "run-cmux-lazy-order",
      [{ name: "m1", sessionId: "s-m1", worktreePath: "/tmp/m1" }],
      manager,
    )

    // then
    expect(result).not.toBeNull()
    expect(events.slice(0, 3)).toEqual(["get-path", "get-environment", "run:list-panes"])
  })

  test("#given an authenticated capability #when a cmux team layout is requested #then it fails before the command runner", async () => {
    // given
    const manager: TmuxMgrLike = {
      getServerUrl: () => { throw new Error("legacy URL must not be read") },
      getTmuxServerAccess: () => ({
        serverUrl: "http://127.0.0.1:43127",
        checkServerHealth: async () => true,
        getPaneEnvironment: () => ({
          OPENCODE_SERVER_PASSWORD: "password-fixture",
          OPENCODE_SERVER_USERNAME: "username-fixture",
        }),
      }),
    }
    const { createTeamLayout } = await loadLayoutModule({
      isCmuxCompatEnvironment: () => true,
    })

    // when
    const result = await createTeamLayout(
      "run-cmux-authenticated",
      [{ name: "m1", sessionId: "s-m1", worktreePath: "/tmp/m1" }],
      manager,
    )

    // then
    expect(result).toBeNull()
    expect(runTmuxCommandMock).not.toHaveBeenCalled()
  })

  test("#given anonymous clears and ambient credentials #when a cmux team layout is requested #then it fails before inheritance", async () => {
    // given
    const ambientName = "OPENCODE_SERVER_PASSWORD"
    const originalValue = process.env[ambientName]
    process.env[ambientName] = "ambient-password-fixture"
    const manager: TmuxMgrLike = {
      getServerUrl: () => { throw new Error("legacy URL must not be read") },
      getTmuxServerAccess: () => ({
        serverUrl: "http://127.0.0.1:43127",
        checkServerHealth: async () => true,
        getPaneEnvironment: () => ({
          OPENCODE_SERVER_PASSWORD: "",
          OPENCODE_SERVER_USERNAME: "",
        }),
      }),
    }

    try {
      const { createTeamLayout } = await loadLayoutModule({
        isCmuxCompatEnvironment: () => true,
      })

      // when
      const result = await createTeamLayout(
        "run-cmux-ambient",
        [{ name: "m1", sessionId: "s-m1", worktreePath: "/tmp/m1" }],
        manager,
      )

      // then
      expect(result).toBeNull()
      expect(runTmuxCommandMock).not.toHaveBeenCalled()
    } finally {
      if (originalValue === undefined) delete process.env[ambientName]
      else process.env[ambientName] = originalValue
    }
  })

  test("#given cmux appears before pane enumeration #when a team layout is requested #then the later observation fails closed", async () => {
    // given
    const detectCmux = mock()
      .mockImplementationOnce(() => false)
      .mockImplementation(() => true)
    const manager: TmuxMgrLike = {
      getServerUrl: () => { throw new Error("legacy URL must not be read") },
      getTmuxServerAccess: () => ({
        serverUrl: "http://127.0.0.1:43127",
        checkServerHealth: async () => true,
        getPaneEnvironment: () => ({ TEAM_ACCESS_TOKEN: "token-fixture" }),
      }),
    }
    const { createTeamLayout } = await loadLayoutModule({
      isCmuxCompatEnvironment: detectCmux,
      getTmuxPath: async () => "cmux",
    })

    // when
    const result = await createTeamLayout(
      "run-cmux-transition",
      [{ name: "m1", sessionId: "s-m1", worktreePath: "/tmp/m1" }],
      manager,
    )

    // then
    expect(result).toBeNull()
    expect(detectCmux).toHaveBeenCalledTimes(2)
    expect(runTmuxCommandMock).not.toHaveBeenCalled()
  })

  test("#given cmux and ambient credentials appear during tmux lookup #when a team layout is requested #then no tmux command inherits them", async () => {
    // given
    delete process.env.CMUX_SOCKET_PATH
    delete process.env.OPENCODE_SERVER_PASSWORD
    const manager: TmuxMgrLike = {
      getServerUrl: () => "http://127.0.0.1:43127",
    }
    const { createTeamLayout } = await loadLayoutModule({
      isCmuxCompatEnvironment: () => process.env.CMUX_SOCKET_PATH !== undefined,
      getTmuxPath: async () => {
        process.env.CMUX_SOCKET_PATH = "/tmp/cmux-late.sock"
        process.env.OPENCODE_SERVER_PASSWORD = "late-ambient-password-fixture"
        return "cmux"
      },
    })

    // when
    const result = await createTeamLayout(
      "run-cmux-late-lookup",
      [{ name: "m1", sessionId: "s-m1", worktreePath: "/tmp/m1" }],
      manager,
    )

    // then
    expect(result).toBeNull()
    expect(runTmuxCommandMock).not.toHaveBeenCalled()
  })

  test("#given authenticated cmux appears after a split #when pane setup continues #then layout aborts and sanitizes pane rollback", async () => {
    // given
    let authenticated = false
    const calls: Array<{ args: Array<string>; options?: RunTmuxOptions }> = []
    const runTmuxCommand = mock(async (tmuxPath: string, args: Array<string>, options?: RunTmuxOptions) => {
      calls.push({ args, options })
      const result = await defaultRunTmuxCommand(tmuxPath, args)
      if (args[0] === "split-window") authenticated = true
      return result
    })
    const manager: TmuxMgrLike = {
      getServerUrl: () => { throw new Error("legacy URL must not be read") },
      getTmuxServerAccess: () => ({
        serverUrl: "http://127.0.0.1:43127",
        checkServerHealth: async () => true,
        getPaneEnvironment: () => authenticated
          ? { OPENCODE_SERVER_PASSWORD: "rotated-password-fixture" }
          : { OPENCODE_SERVER_PASSWORD: "", OPENCODE_SERVER_USERNAME: "" },
      }),
    }
    const { createTeamLayout } = await loadLayoutModule({
      isCmuxCompatEnvironment: () => true,
      getTmuxPath: async () => "cmux",
      runTmuxCommand,
    })

    // when
    const result = await createTeamLayout(
      "run-cmux-post-split-rotation",
      [{ name: "m1", sessionId: "s-m1", worktreePath: "/tmp/m1" }],
      manager,
    )

    // then
    expect(result).toBeNull()
    expect(calls.map(({ args }) => args[0])).toEqual(["list-panes", "split-window", "kill-pane"])
    expect(calls.some(({ args }) => args[0] === "send-keys")).toBe(false)
    const cleanupEnvironment = calls.at(-1)?.options?.environment
    expect(cleanupEnvironment).toBeDefined()
    expect(cleanupEnvironment?.OPENCODE_SERVER_PASSWORD).toBeUndefined()
    expect(cleanupEnvironment?.OPENCODE_SERVER_USERNAME).toBeUndefined()
  })

  test("#given pane setup throws after a split #when the layout transaction aborts #then the created pane is rolled back", async () => {
    // given
    const calls: Array<Array<string>> = []
    const runTmuxCommand = mock(async (tmuxPath: string, args: Array<string>, options?: RunTmuxOptions) => {
      calls.push(args)
      if (args[0] === "select-pane") throw new Error("setup runner fixture failure")
      return defaultRunTmuxCommand(tmuxPath, args, options)
    })
    const { createTeamLayout } = await loadLayoutModule({ runTmuxCommand })

    // when
    const result = await createTeamLayout(
      "run-setup-throw",
      [{ name: "m1", sessionId: "s-m1", worktreePath: "/tmp/m1" }],
      tmuxMgr,
    )

    // then
    expect(result).toBeNull()
    expect(calls.map((args) => args[0])).toEqual([
      "list-panes",
      "split-window",
      "select-pane",
      "kill-pane",
    ])
  })

  test("#given native tmux changes to cmux after a split #when setup aborts #then rollback stays bound to the original native environment", async () => {
    // given
    const originalTmux = process.env.TMUX
    const originalSocket = process.env.CMUX_SOCKET_PATH
    process.env.TMUX = "/tmp/tmux-native-fixture,123,0"
    delete process.env.CMUX_SOCKET_PATH
    const calls: Array<{ args: Array<string>; options?: RunTmuxOptions }> = []
    const runTmuxCommand = mock(async (tmuxPath: string, args: Array<string>, options?: RunTmuxOptions) => {
      calls.push({ args, options })
      const result = await defaultRunTmuxCommand(tmuxPath, args, options)
      if (args[0] === "split-window") {
        process.env.TMUX = "/tmp/cmuxterm-transition-fixture,456,0"
        process.env.CMUX_SOCKET_PATH = "/tmp/cmux-transition-fixture.sock"
      }
      return result
    })
    const { createTeamLayout } = await loadLayoutModule({
      getTmuxPath: async () => "tmux",
      runTmuxCommand,
    })

    try {
      // when
      const result = await createTeamLayout(
        "run-native-to-cmux",
        [{ name: "m1", sessionId: "s-m1", worktreePath: "/tmp/m1" }],
        tmuxMgr,
      )

      // then
      expect(result).toBeNull()
      expect(calls.map(({ args }) => args[0])).toEqual(["list-panes", "split-window", "kill-pane"])
      const cleanupEnvironment = calls.at(-1)?.options?.environment
      expect(cleanupEnvironment?.TMUX).toBe("/tmp/tmux-native-fixture,123,0")
      expect(cleanupEnvironment?.CMUX_SOCKET_PATH).toBeUndefined()
    } finally {
      if (originalTmux === undefined) delete process.env.TMUX
      else process.env.TMUX = originalTmux
      if (originalSocket === undefined) delete process.env.CMUX_SOCKET_PATH
      else process.env.CMUX_SOCKET_PATH = originalSocket
    }
  })

  test("#given cmux changes to native tmux after a split #when setup aborts #then rollback keeps the original cmux socket", async () => {
    // given
    const originalTmux = process.env.TMUX
    const originalSocket = process.env.CMUX_SOCKET_PATH
    process.env.TMUX = "/tmp/cmuxterm-original-fixture,123,0"
    process.env.CMUX_SOCKET_PATH = "/tmp/cmux-original-fixture.sock"
    const calls: Array<{ args: Array<string>; options?: RunTmuxOptions }> = []
    const runTmuxCommand = mock(async (tmuxPath: string, args: Array<string>, options?: RunTmuxOptions) => {
      calls.push({ args, options })
      const result = await defaultRunTmuxCommand(tmuxPath, args, options)
      if (args[0] === "split-window") {
        process.env.TMUX = "/tmp/tmux-native-transition-fixture,456,0"
        delete process.env.CMUX_SOCKET_PATH
      }
      return result
    })
    const { createTeamLayout } = await loadLayoutModule({
      getTmuxPath: async () => "tmux",
      runTmuxCommand,
    })

    try {
      // when
      const result = await createTeamLayout(
        "run-cmux-to-native",
        [{ name: "m1", sessionId: "s-m1", worktreePath: "/tmp/m1" }],
        tmuxMgr,
      )

      // then
      expect(result).toBeNull()
      expect(calls.map(({ args }) => args[0])).toEqual(["list-panes", "split-window", "kill-pane"])
      const cleanupEnvironment = calls.at(-1)?.options?.environment
      expect(cleanupEnvironment?.TMUX).toBe("/tmp/cmuxterm-original-fixture,123,0")
      expect(cleanupEnvironment?.CMUX_SOCKET_PATH).toBe("/tmp/cmux-original-fixture.sock")
    } finally {
      if (originalTmux === undefined) delete process.env.TMUX
      else process.env.TMUX = originalTmux
      if (originalSocket === undefined) delete process.env.CMUX_SOCKET_PATH
      else process.env.CMUX_SOCKET_PATH = originalSocket
    }
  })

  test("#given a later member split fails #when earlier panes were created #then every created pane is rolled back", async () => {
    // given
    let splitCount = 0
    const calls: Array<Array<string>> = []
    const runTmuxCommand = mock(async (tmuxPath: string, args: Array<string>) => {
      calls.push(args)
      if (args[0] === "split-window" && ++splitCount === 2) {
        return createTmuxCommandResult("", false)
      }
      return defaultRunTmuxCommand(tmuxPath, args)
    })
    const { createTeamLayout } = await loadLayoutModule({ runTmuxCommand })

    // when
    const result = await createTeamLayout(
      "run-second-split-failure",
      [
        { name: "m1", sessionId: "s-m1", worktreePath: "/tmp/m1" },
        { name: "m2", sessionId: "s-m2", worktreePath: "/tmp/m2" },
      ],
      tmuxMgr,
    )

    // then
    expect(result).toBeNull()
    expect(calls.filter((args) => args[0] === "kill-pane")).toEqual([
      ["kill-pane", "-t", "%1"],
    ])
  })

  for (const failingCommand of ["select-layout", "resize-pane"]) {
    test(`#given ${failingCommand} fails #when teammate panes were created #then all panes are rolled back`, async () => {
      // given
      const calls: Array<Array<string>> = []
      const runTmuxCommand = mock(async (tmuxPath: string, args: Array<string>) => {
        calls.push(args)
        if (args[0] === failingCommand) return createTmuxCommandResult("", false)
        return defaultRunTmuxCommand(tmuxPath, args)
      })
      const { createTeamLayout } = await loadLayoutModule({ runTmuxCommand })

      // when
      const result = await createTeamLayout(
        `run-${failingCommand}-failure`,
        [
          { name: "m1", sessionId: "s-m1", worktreePath: "/tmp/m1" },
          { name: "m2", sessionId: "s-m2", worktreePath: "/tmp/m2" },
        ],
        tmuxMgr,
      )

      // then
      expect(result).toBeNull()
      expect(calls.filter((args) => args[0] === "kill-pane")).toEqual([
        ["kill-pane", "-t", "%2"],
        ["kill-pane", "-t", "%1"],
      ])
    })
  }

  test("#given the cmux detector throws #when a team layout is requested #then dependency failure remains isolated", async () => {
    // given
    const { createTeamLayout } = await loadLayoutModule({
      isCmuxCompatEnvironment: () => { throw new Error("detector fixture failure") },
    })

    // when
    const result = await createTeamLayout(
      "run-cmux-detector-error",
      [{ name: "m1", sessionId: "s-m1", worktreePath: "/tmp/m1" }],
      tmuxMgr,
    )

    // then
    expect(result).toBeNull()
    expect(runTmuxCommandMock).not.toHaveBeenCalled()
    expect(logMock).toHaveBeenCalled()
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
    expect(selectLayoutArgs).not.toContain("tiled")
    expect(commands).toContainEqual(["resize-pane", "-t", process.env.TMUX_PANE ?? "", "-x", "30%"])
    expect(result).not.toBeNull()
    expect(Object.keys(result?.focusPanesByMember ?? {}).sort()).toEqual(["m1", "m2", "m3"])
    expect(Object.keys(result?.gridPanesByMember ?? {})).toEqual([])
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
    expect(commands.some((args) => args[0] === "new-window")).toBe(false)
    expect(commands.filter((args) => args[0] === "split-window")).toHaveLength(5)
    const selectLayoutArgs = commands.filter((args) => args[0] === "select-layout").map((args) => args[args.length - 1])
    expect(selectLayoutArgs).toContain("main-vertical")
    expect(selectLayoutArgs).not.toContain("tiled")
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
    expect(commands.some((args) => args[0] === "set-option" && args[1] !== "-p")).toBe(false)
  })

  test("#given delegated pane startup #when split-window is called #then -d flag is always present to prevent terminal probe replies leaking into caller pane (fix #2887)", async () => {
    // given
    const { createTeamLayout } = await loadLayoutModule()
    const members = [
      { name: "m1", sessionId: "s-m1", worktreePath: "/tmp/m1" },
      { name: "m2", sessionId: "s-m2", worktreePath: "/tmp/m2" },
      { name: "m3", sessionId: "s-m3", worktreePath: "/tmp/m3" },
    ]

    // when
    await createTeamLayout("run-probe-drain", members, tmuxMgr as never)

    // then: every split-window call must carry -d so focus never bounces to the
    // new pane; without -d, terminal capability probe replies (DA1/DA2, OSC color)
    // emitted during pane startup are misrouted to the caller pane's stdin and
    // appear as literal garbage text in the main OpenCode chat input.
    const commands = getCommands()
    const splitWindowCalls = commands.filter((args) => args[0] === "split-window")
    expect(splitWindowCalls.length).toBeGreaterThan(0)
    for (const splitArgs of splitWindowCalls) {
      expect(splitArgs).toContain("-d")
    }
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

  test("#given ownedSession=false and paneIds #when removeTeamLayout runs #then it kills panes instead of the caller window", async () => {
    // given
    process.env.OPENCODE_SERVER_PASSWORD = "ambient-cleanup-password-fixture"
    const { removeTeamLayout } = await loadLayoutModule()

    // when
    await removeTeamLayout("run-cleanup", {
      ownedSession: false,
      targetSessionId: "$caller",
      focusWindowId: "test-session:0",
      paneIds: ["%10", "%11"],
    }, tmuxMgr as never)

    // then
    const commands = getCommands()
    expect(commands).toContainEqual(["kill-pane", "-t", "%10"])
    expect(commands).toContainEqual(["kill-pane", "-t", "%11"])
    expect(commands.some((args) => args[0] === "kill-window")).toBe(false)
    expect(commands.some((args) => args[0] === "kill-session")).toBe(false)
    const cleanupCalls = runTmuxCommandMock.mock.calls.filter((call) => call[1][0] === "kill-pane")
    expect(cleanupCalls.every((call) =>
      (call[2] as RunTmuxOptions | undefined)?.environment?.OPENCODE_SERVER_PASSWORD === undefined
    )).toBe(true)
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

  test("#given window cleanup throws secret-bearing text #when removeTeamLayout runs #then logs retain only the error type", async () => {
    // given
    const { removeTeamLayout } = await loadLayoutModule()
    runTmuxCommandMock.mockImplementation((_tmuxPath: string, args: Array<string>, options?: unknown) => {
      if (args[0] === "kill-window") {
        const error = new Error("secret-window-cleanup-message-fixture")
        error.name = "secret-window-cleanup-name-fixture"
        return Promise.reject(error)
      }
      return defaultRunTmuxCommand(_tmuxPath, args, options)
    })

    // when
    await removeTeamLayout("run-window-error-redaction", {
      ownedSession: false,
      targetSessionId: "$caller",
      focusWindowId: "@10",
    }, tmuxMgr as never)

    // then
    expect(logMock).toHaveBeenCalledWith("tmux team layout window cleanup failed", {
      teamRunId: "run-window-error-redaction",
      windowId: "@10",
      errorType: "Error",
    })
    expect(JSON.stringify(logMock.mock.calls)).not.toContain("secret-window-cleanup-message-fixture")
    expect(JSON.stringify(logMock.mock.calls)).not.toContain("secret-window-cleanup-name-fixture")
  })

  test("#given cleanup capability resolution throws secret-bearing text #when removeTeamLayout runs #then the outer log retains only the error type", async () => {
    // given
    const manager: TmuxMgrLike = {
      getServerUrl: () => {
        const error = new Error("secret-capability-resolution-message-fixture")
        error.name = "secret-capability-resolution-name-fixture"
        throw error
      },
    }
    const { removeTeamLayout } = await loadLayoutModule()

    // when
    await removeTeamLayout("run-capability-error-redaction", {
      ownedSession: false,
      targetSessionId: "$caller",
      paneIds: ["%11"],
    }, manager as never)

    // then
    expect(logMock).toHaveBeenCalledWith("tmux team layout cleanup failed", {
      teamRunId: "run-capability-error-redaction",
      errorType: "Error",
    })
    expect(JSON.stringify(logMock.mock.calls)).not.toContain("secret-capability-resolution-message-fixture")
    expect(JSON.stringify(logMock.mock.calls)).not.toContain("secret-capability-resolution-name-fixture")
  })

  test("#given pane cleanup throws a non-Error value #when removeTeamLayout runs #then cleanup continues", async () => {
    // given
    const { removeTeamLayout } = await loadLayoutModule()
    runTmuxCommandMock.mockImplementation((_tmuxPath: string, args: Array<string>, _options?: unknown) => {
      if (args[0] === "kill-pane") {
        return Promise.reject("pane already gone")
      }

      return Promise.resolve(createTmuxCommandResult(""))
    })

    // when
    await removeTeamLayout("run-pane-cleanup", {
      ownedSession: false,
      targetSessionId: "$caller",
      paneIds: ["%11", "%12"],
    }, tmuxMgr as never)

    // then
    expect(getCommands().filter((args) => args[0] === "kill-pane")).toEqual([
      ["kill-pane", "-t", "%11"],
      ["kill-pane", "-t", "%12"],
    ])
    expect(logMock).toHaveBeenCalledWith("tmux team pane cleanup failed", { teamRunId: "run-pane-cleanup", paneId: "%11" })
    expect(logMock).toHaveBeenCalledWith("tmux team pane cleanup failed", { teamRunId: "run-pane-cleanup", paneId: "%12" })
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
      expect(commands.filter((args) => args[0] === "new-window").length).toBe(0)
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
        [
          "split-window",
          "-e", "OPENCODE_SERVER_PASSWORD=",
          "-e", "OPENCODE_SERVER_USERNAME=",
          "-t", process.env.TMUX_PANE ?? "",
          "-h",
          "-d",
          "-l", "70%",
          "-P",
          "-F", "#{pane_id}",
          "-c", "/tmp/m1",
        ],
      ])
      expect(commands.filter((args) => args[0] === "new-window").length).toBe(0)
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

    test("#given layout created #when createTeamLayout runs #then it records focus panes only", async () => {
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
      expect(Object.keys(result?.gridPanesByMember ?? {})).toEqual([])
      expect(result?.focusWindowId).toBe("test-session:0")
      expect(result?.gridWindowId).toBeUndefined()
      expect(commands.filter((args) => args[0] === "new-window").length).toBe(0)
      expect(commands.some((args) => args[0] === "send-keys" && args.includes("Enter"))).toBe(true)
    })
  })
})

/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test"

import { canVisualizeHerdr, createHerdrTeamLayout, removeHerdrTeamLayout, type TeamLayoutCleanupTarget, type TeamLayoutHerdrDeps } from "./layout"

let nextPaneNumber = 1
const panesByWorkspace = new Map<string, string[]>()
let callerPaneId = "w1:p1"

function createHerdrCommandResult(output: string, success = true) {
  return {
    success,
    output,
    stdout: output,
    stderr: success ? "" : "error",
    exitCode: success ? 0 : 1,
  }
}

function defaultRunHerdrCommand(_herdrPath: string, args: Array<string>, _options?: unknown) {
  const command = args[1]

  if (command === "split") {
    const paneId = `w1:p${nextPaneNumber++}`
    const workspaceId = getWorkspaceId(args)
    panesByWorkspace.set(workspaceId, [...(panesByWorkspace.get(workspaceId) ?? []), paneId])
    return Promise.resolve(createHerdrCommandResult(paneId))
  }

  if (command === "list") {
    const workspaceId = getWorkspaceId(args)
    return Promise.resolve(createHerdrCommandResult((panesByWorkspace.get(workspaceId) ?? []).join("\n")))
  }

  return Promise.resolve(createHerdrCommandResult(""))
}

function getWorkspaceId(args: Array<string>): string {
  const index = args.indexOf("--workspace")
  return index >= 0 ? args[index + 1] ?? "" : ""
}

const runHerdrCommandMock = mock(defaultRunHerdrCommand)
const logMock = mock(() => undefined)

const isServerRunningMock = mock(async (_serverUrl: string) => true)

async function loadLayoutModule() {
  const deps: TeamLayoutHerdrDeps = {
    runHerdrCommand: runHerdrCommandMock,
    isServerRunning: isServerRunningMock,
    getHerdrPath: async () => "herdr",
    log: logMock,
    resolveCallerHerdrPane: async () => (callerPaneId ? { workspaceId: callerPaneId.split(":")[0], paneId: callerPaneId } : null),
  }
  return {
    canVisualizeHerdr,
    createHerdrTeamLayout: (teamRunId: string, members: Parameters<typeof createHerdrTeamLayout>[1], herdrMgr: Parameters<typeof createHerdrTeamLayout>[2]) => {
      return createHerdrTeamLayout(teamRunId, members, herdrMgr, deps)
    },
    removeHerdrTeamLayout: (
      teamRunId: string,
      cleanupTarget: TeamLayoutCleanupTarget | undefined,
      herdrMgr: Parameters<typeof removeHerdrTeamLayout>[2],
    ) => removeHerdrTeamLayout(teamRunId, cleanupTarget, herdrMgr, deps),
  }
}

type HerdrMgrLike = { getServerUrl: () => string }

const herdrMgr: HerdrMgrLike = { getServerUrl: () => "http://127.0.0.1:12345" }

function getCommands(): Array<Array<string>> {
  return Array.from(runHerdrCommandMock.mock.calls, (call) => call[1])
}

describe("team-layout-herdr", () => {
  beforeEach(() => {
    runHerdrCommandMock.mockClear()
    logMock.mockClear()
    isServerRunningMock.mockClear()
    isServerRunningMock.mockImplementation(async () => true)
    nextPaneNumber = 2 // w1:p1 is the caller
    panesByWorkspace.clear()
    panesByWorkspace.set("w1", ["w1:p1"])
    callerPaneId = "w1:p1"
  })

  test("canVisualizeHerdr reflects the herdr environment", () => {
    const savedEnv = process.env.HERDR_ENV
    try {
      delete process.env.HERDR_ENV
      delete process.env.HERDR_SOCKET_PATH
      expect(canVisualizeHerdr()).toBe(false)

      process.env.HERDR_ENV = "1"
      expect(canVisualizeHerdr()).toBe(true)
    } finally {
      if (savedEnv === undefined) {
        delete process.env.HERDR_ENV
      } else {
        process.env.HERDR_ENV = savedEnv
      }
    }
  })

  test("skips when herdr visualization is unavailable", async () => {
    const { createHerdrTeamLayout } = await loadLayoutModule()
    const savedEnv = process.env.HERDR_ENV
    try {
      delete process.env.HERDR_ENV
      delete process.env.HERDR_SOCKET_PATH
      const layout = await createHerdrTeamLayout("run-1", [{ name: "a", sessionId: "s1" }], herdrMgr)
      expect(layout).toBeNull()
      expect(getCommands()).toEqual([])
    } finally {
      if (savedEnv === undefined) {
        delete process.env.HERDR_ENV
      } else {
        process.env.HERDR_ENV = savedEnv
      }
    }
  })

  test("skips when no members are given", async () => {
    const { createHerdrTeamLayout } = await loadLayoutModule()
    const savedEnv = process.env.HERDR_ENV
    try {
      process.env.HERDR_ENV = "1"
      const layout = await createHerdrTeamLayout("run-1", [], herdrMgr)
      expect(layout).toBeNull()
    } finally {
      if (savedEnv === undefined) {
        delete process.env.HERDR_ENV
      } else {
        process.env.HERDR_ENV = savedEnv
      }
    }
  })

  test("skips when the caller pane is unresolvable", async () => {
    const { createHerdrTeamLayout } = await loadLayoutModule()
    const savedEnv = process.env.HERDR_ENV
    const savedCaller = callerPaneId
    try {
      process.env.HERDR_ENV = "1"
      callerPaneId = ""
      const layout = await createHerdrTeamLayout("run-1", [{ name: "a", sessionId: "s1" }], herdrMgr)
      expect(layout).toBeNull()
    } finally {
      callerPaneId = savedCaller
      if (savedEnv === undefined) {
        delete process.env.HERDR_ENV
      } else {
        process.env.HERDR_ENV = savedEnv
      }
    }
  })

  test("creates a split pane per member with attach commands", async () => {
    const { createHerdrTeamLayout } = await loadLayoutModule()
    const savedEnv = process.env.HERDR_ENV
    try {
      process.env.HERDR_ENV = "1"
      const layout = await createHerdrTeamLayout("run-1", [
        { name: "a", sessionId: "s1" },
        { name: "b", sessionId: "s2" },
      ], herdrMgr)

      expect(layout).not.toBeNull()
      expect(layout!.ownedSession).toBe(false)
      expect(layout!.targetSessionId).toBe("w1")
      expect(Object.keys(layout!.focusPanesByMember)).toEqual(["a", "b"])

      const commands = getCommands()
      expect(commands.some((cmd) => cmd[0] === "pane" && cmd[1] === "split")).toBe(true)
      expect(commands.some((cmd) => cmd[0] === "pane" && cmd[1] === "rename")).toBe(true)
      expect(commands.some((cmd) => cmd[0] === "pane" && cmd[1] === "run")).toBe(true)

      const renameCommands = commands.filter((cmd) => cmd[1] === "rename")
      expect(renameCommands.some((cmd) => cmd[3].startsWith("omo-team-run-1-"))).toBe(true)

      const runCommands = commands.filter((cmd) => cmd[1] === "run")
      expect(runCommands.some((cmd) => cmd[3].includes("opencode attach"))).toBe(true)
      expect(runCommands.some((cmd) => cmd[3].includes("--session 's1'"))).toBe(true)
      expect(runCommands.some((cmd) => cmd[3].includes("--session 's2'"))).toBe(true)
    } finally {
      if (savedEnv === undefined) {
        delete process.env.HERDR_ENV
      } else {
        process.env.HERDR_ENV = savedEnv
      }
    }
  })

  test("removes panes on cleanup", async () => {
    const { createHerdrTeamLayout, removeHerdrTeamLayout } = await loadLayoutModule()
    const savedEnv = process.env.HERDR_ENV
    try {
      process.env.HERDR_ENV = "1"
      const layout = await createHerdrTeamLayout("run-1", [{ name: "a", sessionId: "s1" }], herdrMgr)
      expect(layout).not.toBeNull()
      const paneId = Object.values(layout!.focusPanesByMember)[0]

      runHerdrCommandMock.mockClear()
      const cleanupTarget: TeamLayoutCleanupTarget = {
        ownedSession: false,
        targetSessionId: "w1",
        focusWindowId: "w1",
        paneIds: [paneId],
      }
      await removeHerdrTeamLayout("run-1", cleanupTarget, herdrMgr)

      const commands = getCommands()
      expect(commands.some((cmd) => cmd[1] === "close" && cmd[2] === paneId)).toBe(true)
    } finally {
      if (savedEnv === undefined) {
        delete process.env.HERDR_ENV
      } else {
        process.env.HERDR_ENV = savedEnv
      }
    }
  })

  test("cleanup no-ops without a herdr environment", async () => {
    const { removeHerdrTeamLayout } = await loadLayoutModule()
    const savedEnv = process.env.HERDR_ENV
    try {
      delete process.env.HERDR_ENV
      delete process.env.HERDR_SOCKET_PATH
      await removeHerdrTeamLayout("run-1", { ownedSession: false, targetSessionId: "w1", paneIds: ["w1:p2"] }, herdrMgr)
      expect(getCommands()).toEqual([])
    } finally {
      if (savedEnv === undefined) {
        delete process.env.HERDR_ENV
      } else {
        process.env.HERDR_ENV = savedEnv
      }
    }
  })
})

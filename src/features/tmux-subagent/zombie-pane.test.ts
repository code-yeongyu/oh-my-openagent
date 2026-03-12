import { beforeEach, describe, expect, mock, test } from "bun:test"
import type { TmuxConfig } from "../../config/schema"
import type { ActionResult, ExecuteContext, ExecuteActionsResult } from "./action-executor"
import type { TmuxUtilDeps } from "./manager"
import type { TrackedSession, WindowState } from "./types"

const mockQueryWindowState = mock<(paneId: string) => Promise<WindowState | null>>(async () => ({
  windowWidth: 220,
  windowHeight: 44,
  mainPane: { paneId: "%0", width: 110, height: 44, left: 0, top: 0, title: "main", isActive: true },
  agentPanes: [],
}))

const mockExecuteAction = mock<(
  action: { type: string },
  ctx: ExecuteContext,
) => Promise<ActionResult>>(async () => ({ success: true }))

const mockExecuteActions = mock<(
  actions: unknown[],
  ctx: ExecuteContext,
) => Promise<ExecuteActionsResult>>(async () => ({
  success: true,
  spawnedPaneId: "%1",
  results: [],
}))

const mockIsInsideTmux = mock<() => boolean>(() => true)
const mockGetCurrentPaneId = mock<() => string | undefined>(() => "%0")

mock.module("./pane-state-querier", () => ({
  queryWindowState: mockQueryWindowState,
}))

mock.module("./action-executor", () => ({
  executeAction: mockExecuteAction,
  executeActions: mockExecuteActions,
}))

mock.module("../../shared/tmux", () => ({
  isInsideTmux: mockIsInsideTmux,
  getCurrentPaneId: mockGetCurrentPaneId,
  POLL_INTERVAL_BACKGROUND_MS: 10,
  SESSION_READY_POLL_INTERVAL_MS: 10,
  SESSION_READY_TIMEOUT_MS: 50,
  SESSION_MISSING_GRACE_MS: 1_000,
}))

const mockTmuxDeps: TmuxUtilDeps = {
  isInsideTmux: mockIsInsideTmux,
  getCurrentPaneId: mockGetCurrentPaneId,
}

function createConfig(): TmuxConfig {
  return {
    enabled: true,
    layout: "main-vertical",
    main_pane_size: 60,
    main_pane_min_width: 80,
    agent_pane_min_width: 40,
  }
}

function createContext() {
  const shell = Object.assign(
    () => {
      throw new Error("shell should not be called in this test")
    },
    {
      braces: () => [],
      escape: (input: string) => input,
      env() {
        return shell
      },
      cwd() {
        return shell
      },
      nothrow() {
        return shell
      },
      throws() {
        return shell
      },
    },
  )

  return {
    project: {
      id: "project-id",
      worktree: "/tmp/omo-fix-memory-leaks",
      time: { created: Date.now() },
    },
    directory: "/tmp/omo-fix-memory-leaks",
    worktree: "/tmp/omo-fix-memory-leaks",
    serverUrl: new URL("http://localhost:4096"),
    $: shell,
    client: {
      session: {
        status: mock(async () => ({ data: {} })),
        messages: mock(async () => ({ data: [] })),
      },
    },
  }
}

function createTrackedSession(overrides?: Partial<TrackedSession>): TrackedSession {
  return {
    sessionId: "ses_pending",
    paneId: "%1",
    description: "Pending pane",
    createdAt: new Date(),
    lastSeenAt: new Date(),
    closePending: false,
    closeRetryCount: 0,
    ...overrides,
  }
}

function getTrackedSessions(target: object): Map<string, TrackedSession> {
  const sessions = Reflect.get(target, "sessions")
  if (!(sessions instanceof Map)) {
    throw new Error("Expected sessions map")
  }

  return sessions
}

function getRetryPendingCloses(target: object): () => Promise<void> {
  const retryPendingCloses = Reflect.get(target, "retryPendingCloses")
  if (typeof retryPendingCloses !== "function") {
    throw new Error("Expected retryPendingCloses method")
  }

  return retryPendingCloses.bind(target)
}

function getCloseSessionById(target: object): (sessionId: string) => Promise<void> {
  const closeSessionById = Reflect.get(target, "closeSessionById")
  if (typeof closeSessionById !== "function") {
    throw new Error("Expected closeSessionById method")
  }

  return closeSessionById.bind(target)
}

function createManager(
  TmuxSessionManager: typeof import("./manager").TmuxSessionManager,
): import("./manager").TmuxSessionManager {
  return Reflect.construct(TmuxSessionManager, [createContext(), createConfig(), mockTmuxDeps])
}

describe("TmuxSessionManager zombie pane handling", () => {
  beforeEach(() => {
    mockQueryWindowState.mockClear()
    mockExecuteAction.mockClear()
    mockExecuteActions.mockClear()
    mockIsInsideTmux.mockClear()
    mockGetCurrentPaneId.mockClear()

    mockQueryWindowState.mockImplementation(async () => ({
      windowWidth: 220,
      windowHeight: 44,
      mainPane: { paneId: "%0", width: 110, height: 44, left: 0, top: 0, title: "main", isActive: true },
      agentPanes: [],
    }))
    mockExecuteAction.mockImplementation(async () => ({ success: true }))
    mockExecuteActions.mockImplementation(async () => ({
      success: true,
      spawnedPaneId: "%1",
      results: [],
    }))
    mockIsInsideTmux.mockReturnValue(true)
    mockGetCurrentPaneId.mockReturnValue("%0")
  })

  test("#given session in sessions Map #when onSessionDeleted called with null window state #then session stays in Map with closePending true", async () => {
    // given
    mockQueryWindowState.mockImplementation(async () => null)
    const { TmuxSessionManager } = await import("./manager")
    const manager = createManager(TmuxSessionManager)
    const sessions = getTrackedSessions(manager)
    sessions.set("ses_pending", createTrackedSession())

    // when
    await manager.onSessionDeleted({ sessionID: "ses_pending" })

    // then
    const tracked = sessions.get("ses_pending")
    expect(tracked).toBeDefined()
    expect(tracked?.closePending).toBe(true)
    expect(tracked?.closeRetryCount).toBe(0)
    expect(mockExecuteAction).not.toHaveBeenCalled()
  })

  test("#given session with closePending true #when retryPendingCloses succeeds #then session is removed from Map", async () => {
    // given
    const { TmuxSessionManager } = await import("./manager")
    const manager = createManager(TmuxSessionManager)
    const sessions = getTrackedSessions(manager)
    sessions.set(
      "ses_pending",
      createTrackedSession({ closePending: true, closeRetryCount: 0 }),
    )

    // when
    await getRetryPendingCloses(manager)()

    // then
    expect(sessions.has("ses_pending")).toBe(false)
    expect(mockExecuteAction).toHaveBeenCalledTimes(1)
  })

  test("#given session with closePending true and closeRetryCount >= 3 #when retryPendingCloses called #then session is force-removed from Map", async () => {
    // given
    const { TmuxSessionManager } = await import("./manager")
    const manager = createManager(TmuxSessionManager)
    const sessions = getTrackedSessions(manager)
    sessions.set(
      "ses_pending",
      createTrackedSession({ closePending: true, closeRetryCount: 3 }),
    )

    // when
    await getRetryPendingCloses(manager)()

    // then
    expect(sessions.has("ses_pending")).toBe(false)
    expect(mockQueryWindowState).not.toHaveBeenCalled()
    expect(mockExecuteAction).not.toHaveBeenCalled()
  })

  test("#given session with closePending true and closeRetryCount >= 3 #when closeSessionById called #then session is force-removed without retrying close", async () => {
    // given
    const { TmuxSessionManager } = await import("./manager")
    const manager = createManager(TmuxSessionManager)
    const sessions = getTrackedSessions(manager)
    sessions.set(
      "ses_pending",
      createTrackedSession({ closePending: true, closeRetryCount: 3 }),
    )

    // when
    await getCloseSessionById(manager)("ses_pending")

    // then
    expect(sessions.has("ses_pending")).toBe(false)
    expect(mockQueryWindowState).not.toHaveBeenCalled()
    expect(mockExecuteAction).not.toHaveBeenCalled()
  })

  test("#given close-pending session removed during async close #when retryPendingCloses fails #then it does not resurrect stale session state", async () => {
    // given
    const { TmuxSessionManager } = await import("./manager")
    const manager = createManager(TmuxSessionManager)
    const sessions = getTrackedSessions(manager)
    sessions.set(
      "ses_pending",
      createTrackedSession({ closePending: true, closeRetryCount: 0 }),
    )
    mockExecuteAction.mockImplementationOnce(async () => {
      sessions.delete("ses_pending")
      return { success: false }
    })

    // when
    await getRetryPendingCloses(manager)()

    // then
    expect(sessions.has("ses_pending")).toBe(false)
  })
})

import { describe, test, expect, mock, afterEach } from "bun:test"

// ---------------------------------------------------------------------------
// Module-level mocks — must be registered BEFORE importing the handler so the
// handler picks up the mocked exports instead of the real implementations.
// queryWindowState and executeActions hit real tmux/spawn subprocesses; we
// replace them with spies so the spawn path can actually be exercised in tests.
// ---------------------------------------------------------------------------

const mockQueryWindowState = mock(async (_paneId: string) => ({
  windowWidth: 244,
  windowHeight: 44,
  mainPane: { paneId: "%0", width: 130, height: 44, left: 0, top: 0, title: "main", isActive: true },
  agentPanes: [],
}))

const mockExecuteActions = mock(async (_actions: unknown[], _ctx: unknown) => ({
  success: true,
  spawnedPaneId: "%99",
  results: [],
}))

mock.module("./pane-state-querier", () => ({ queryWindowState: mockQueryWindowState }))
mock.module("./action-executor", () => ({ executeActions: mockExecuteActions }))

import type { SessionCreatedHandlerDeps } from "./session-created-handler"
import { handleSessionCreated } from "./session-created-handler"
import type { SessionCreatedEvent } from "./session-created-event"

afterEach(() => {
  mockQueryWindowState.mockClear()
  mockExecuteActions.mockClear()
})

function makeEvent(sessionId: string, parentID = "parent-session"): SessionCreatedEvent {
  return {
    type: "session.created",
    properties: {
      info: { id: sessionId, parentID, title: "TestAgent" },
    },
  }
}

// ---------------------------------------------------------------------------
// Factory – returns fresh mocks + deps for each test
// ---------------------------------------------------------------------------

function makeDeps(overrides: Partial<SessionCreatedHandlerDeps> = {}): {
  deps: SessionCreatedHandlerDeps
} {
  const deps: SessionCreatedHandlerDeps = {
    client: {} as never,
    tmuxConfig: { enabled: true } as never,
    directory: "/tmp/test",
    serverUrl: "http://127.0.0.1:42000",
    sourcePaneId: "%0",
    sessions: new Map(),
    pendingSessions: new Set(),
    isInsideTmux: () => true,
    isEnabled: () => true,
    getCapacityConfig: () => ({ mainPaneMinWidth: 130, agentPaneWidth: 52 }),
    getSessionMappings: () => [],
    startPolling: mock(() => {}),
    ...overrides,
  }

  return { deps }
}

// ---------------------------------------------------------------------------
// Inject executeActions via module mock
// ---------------------------------------------------------------------------

// We test ordering by observing call order via a shared call-log array.

describe("handleSessionCreated – #3505 session attach race", () => {
  test("#given no source pane #when session.created fires #then pane is NOT spawned", async () => {
    const callLog: string[] = []
    const { deps } = makeDeps()

    // Patch executeActions on the module after import — use the real module path
    // but intercept via deps indirection through action-executor by spying on
    // startPolling (it must NOT be called if spawn is skipped).
    const startPolling = mock(() => { callLog.push("startPolling") })
    deps.startPolling = startPolling

    const event = makeEvent("ses_notready")
    // queryWindowState will return null if no real tmux — skip through by
    // providing sourcePaneId=undefined so the handler returns early after readiness.
    // Instead, test the readiness gate directly by bypassing window-state with
    // a paneId that queryWindowState can handle gracefully.
    // Since queryWindowState hits real tmux, we override sourcePaneId-less path:
    deps.sourcePaneId = undefined

    await handleSessionCreated(deps, event)

    // No pane spawned, no polling started
    expect(startPolling).not.toHaveBeenCalled()
    expect(mockExecuteActions).not.toHaveBeenCalled()
  })

  test("#given spawn path reached #when session status is not ready #then placeholder spawn does not wait", async () => {
    const callLog: string[] = []

    mockExecuteActions.mockImplementation(async (_actions, _ctx) => {
      callLog.push("executeActions")
      return { success: true, spawnedPaneId: "%99", results: [] }
    })

    const { deps } = makeDeps()
    const handlerPromise = handleSessionCreated(deps, makeEvent("ses_race"))

    await Promise.resolve()
    await Promise.resolve()
    await handlerPromise

    expect(mockExecuteActions).toHaveBeenCalledTimes(1)
    expect(callLog).toEqual(["executeActions"])
  })

  test("#given spawn path reached #when readiness is unknown #then placeholder still spawns", async () => {
    const { deps } = makeDeps()

    await handleSessionCreated(deps, makeEvent("ses_notready_spawn"))

    expect(mockExecuteActions).toHaveBeenCalledTimes(1)
  })

  test("#given duplicate session.created events #when first is pending #then second is deduplicated", async () => {
    const { deps } = makeDeps()
    deps.pendingSessions.add("ses_dup")

    const event = makeEvent("ses_dup")
    await handleSessionCreated(deps, event)

    expect(mockExecuteActions).not.toHaveBeenCalled()
  })

  test("#given non session.created event #when handler called #then no action taken", async () => {
    const { deps } = makeDeps()

    const event: SessionCreatedEvent = {
      type: "session.idle",
      properties: { info: { id: "ses_idle", parentID: "parent" } },
    }

    await handleSessionCreated(deps, event as never)
    expect(mockExecuteActions).not.toHaveBeenCalled()
  })

  test("#given session already tracked #when session.created fires again #then idempotent", async () => {
    const { deps } = makeDeps()
    // Pre-populate sessions map as if pane was already spawned
    deps.sessions.set("ses_existing", {
      sessionId: "ses_existing",
      paneId: "%5",
      description: "TestAgent",
      createdAt: new Date(),
      lastSeenAt: new Date(),
      closePending: false,
      closeRetryCount: 0,
    })

    const event = makeEvent("ses_existing")
    await handleSessionCreated(deps, event)

    expect(mockExecuteActions).not.toHaveBeenCalled()
  })
})

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
  mockExecuteActions: ReturnType<typeof mock>
  mockWaitForSessionReady: ReturnType<typeof mock>
} {
  const mockExecuteActions = mock(async () => ({
    success: true,
    spawnedPaneId: "%99",
    results: [],
  }))

  const mockWaitForSessionReady = mock(async (_sessionId: string) => true)

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
    waitForSessionReady: mockWaitForSessionReady,
    startPolling: mock(() => {}),
    ...overrides,
  }

  return { deps, mockExecuteActions, mockWaitForSessionReady }
}

// ---------------------------------------------------------------------------
// Inject executeActions via module mock
// ---------------------------------------------------------------------------

// We test ordering by observing call order via a shared call-log array.

describe("handleSessionCreated – #3505 session readiness race", () => {
  test("#given session not yet ready #when session.created fires #then pane is NOT spawned", async () => {
    const callLog: string[] = []

    const waitForSessionReady = mock(async (_id: string) => {
      callLog.push("waitForSessionReady")
      return false // session never becomes ready
    })

    const { deps } = makeDeps({ waitForSessionReady })

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
    expect(waitForSessionReady).not.toHaveBeenCalled() // short-circuits at sourcePaneId check
  })

  test("#given spawn path reached #when waitForSessionReady is pending #then executeActions is deferred until readiness resolves", async () => {
    // Regression test for #3505: the handler must `await waitForSessionReady`
    // BEFORE calling executeActions. This test actually exercises the spawn
    // path (mocked queryWindowState returns a valid window state, mocked
    // executeActions is a spy) so the readiness-then-spawn ordering is
    // observable and asserted, not assumed.
    const callLog: string[] = []
    let resolveReadiness: ((ready: boolean) => void) | undefined
    const readinessGate = new Promise<boolean>((resolve) => { resolveReadiness = resolve })

    const waitForSessionReady = mock(async (_id: string): Promise<boolean> => {
      callLog.push("waitForSessionReady:start")
      const ready = await readinessGate
      callLog.push("waitForSessionReady:end")
      return ready
    })
    mockExecuteActions.mockImplementation(async (_actions, _ctx) => {
      callLog.push("executeActions")
      return { success: true, spawnedPaneId: "%99", results: [] }
    })

    const { deps } = makeDeps({ waitForSessionReady })
    const handlerPromise = handleSessionCreated(deps, makeEvent("ses_race"))

    // Yield so the handler reaches the readiness gate; executeActions must NOT
    // have been invoked yet because waitForSessionReady has not resolved.
    await Promise.resolve()
    await Promise.resolve()
    expect(waitForSessionReady).toHaveBeenCalledTimes(1)
    expect(mockExecuteActions).not.toHaveBeenCalled()

    resolveReadiness!(true)
    await handlerPromise

    // Now executeActions must have fired exactly once, AFTER waitForSessionReady.
    expect(mockExecuteActions).toHaveBeenCalledTimes(1)
    expect(callLog).toEqual(["waitForSessionReady:start", "waitForSessionReady:end", "executeActions"])
  })

  test("#given spawn path reached #when waitForSessionReady resolves false #then executeActions is never called", async () => {
    const waitForSessionReady = mock(async (_id: string) => false)
    const { deps } = makeDeps({ waitForSessionReady })

    await handleSessionCreated(deps, makeEvent("ses_notready_spawn"))

    expect(waitForSessionReady).toHaveBeenCalledTimes(1)
    expect(mockExecuteActions).not.toHaveBeenCalled()
  })

  test("#given duplicate session.created events #when first is pending #then second is deduplicated", async () => {
    const { deps, mockWaitForSessionReady } = makeDeps()
    deps.pendingSessions.add("ses_dup")

    const event = makeEvent("ses_dup")
    await handleSessionCreated(deps, event)

    // Should bail out at the duplicate guard, never reaching readiness check
    expect(mockWaitForSessionReady).not.toHaveBeenCalled()
  })

  test("#given non session.created event #when handler called #then no action taken", async () => {
    const { deps, mockWaitForSessionReady } = makeDeps()

    const event: SessionCreatedEvent = {
      type: "session.idle",
      properties: { info: { id: "ses_idle", parentID: "parent" } },
    }

    await handleSessionCreated(deps, event as never)
    expect(mockWaitForSessionReady).not.toHaveBeenCalled()
  })

  test("#given session already tracked #when session.created fires again #then idempotent", async () => {
    const { deps, mockWaitForSessionReady } = makeDeps()
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

    expect(mockWaitForSessionReady).not.toHaveBeenCalled()
  })
})

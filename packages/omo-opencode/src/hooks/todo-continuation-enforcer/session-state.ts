import type { SessionState, Todo } from "./types"

type TimerHandle = number | { unref?: () => void }

declare function setInterval(callback: () => void, delay?: number): TimerHandle
declare function clearInterval(timeout: TimerHandle): void
declare function clearTimeout(timeout: TimerHandle): void

// TTL for idle session state entries (10 minutes)
const SESSION_STATE_TTL_MS = 10 * 60 * 1000
// Prune interval (every 2 minutes)
const SESSION_STATE_PRUNE_INTERVAL_MS = 2 * 60 * 1000

interface TrackedSessionState {
  state: SessionState
  lastAccessedAt: number
  lastCompletedCount?: number
  lastTodoSnapshot?: string
}

export interface ContinuationProgressUpdate {
  previousIncompleteCount?: number
  previousStagnationCount: number
  stagnationCount: number
  hasProgressed: boolean
  progressSource: "none" | "todo"
}

export interface SessionStateStore {
  getState: (sessionID: string) => SessionState
  getExistingState: (sessionID: string) => SessionState | undefined
  startPruneInterval: () => void
  trackContinuationProgress: (
    sessionID: string,
    incompleteCount: number,
    todos?: Todo[],
  ) => ContinuationProgressUpdate
  resetContinuationProgress: (sessionID: string) => void
  cancelCountdown: (sessionID: string) => void
  cleanup: (sessionID: string) => void
  cancelAllCountdowns: () => void
  shutdown: () => void
}

function getTodoSnapshot(todos: Todo[]): string {
  // Only compare {id → status} mappings. Content/priority changes do not represent
  // meaningful progress and must not reset the stagnation counter (issue #4013 P0.2).
  const entries = todos
    .map((todo) => ({
      key: todo.id ?? `${todo.content}:${todo.priority}`,
      status: todo.status,
    }))
    .sort((left, right) => left.key.localeCompare(right.key))
    .map(({ key, status }) => `${key}=${status}`)

  return entries.join("|")
}

export function createSessionStateStore(): SessionStateStore {
  const sessions = new Map<string, TrackedSessionState>()

  // Periodic pruning of stale session states to prevent unbounded Map growth
  let pruneInterval: TimerHandle | undefined
  let pruneIntervalStarted = false

  function startPruneInterval(): void {
    if (pruneIntervalStarted) {
      return
    }

    pruneIntervalStarted = true
    pruneInterval = setInterval(() => {
      const now = Date.now()
      for (const [sessionID, tracked] of sessions.entries()) {
        if (now - tracked.lastAccessedAt > SESSION_STATE_TTL_MS) {
          cancelCountdown(sessionID)
          sessions.delete(sessionID)
        }
      }
    }, SESSION_STATE_PRUNE_INTERVAL_MS)
    if (typeof pruneInterval === "object" && typeof pruneInterval.unref === "function") {
      pruneInterval.unref()
    }
  }

  function getTrackedSession(sessionID: string): TrackedSessionState {
    const existing = sessions.get(sessionID)
    if (existing) {
      existing.lastAccessedAt = Date.now()
      return existing
    }

    const rawState: SessionState = {
      stagnationCount: 0,
      consecutiveFailures: 0,
    }
    const trackedSession: TrackedSessionState = {
      state: rawState,
      lastAccessedAt: Date.now(),
    }
    sessions.set(sessionID, trackedSession)
    return trackedSession
  }

  function getState(sessionID: string): SessionState {
    return getTrackedSession(sessionID).state
  }

  function getExistingState(sessionID: string): SessionState | undefined {
    const existing = sessions.get(sessionID)
    if (existing) {
      existing.lastAccessedAt = Date.now()
      return existing.state
    }
    return undefined
  }

  function trackContinuationProgress(
    sessionID: string,
    incompleteCount: number,
    todos?: Todo[],
  ): ContinuationProgressUpdate {
    const trackedSession = getTrackedSession(sessionID)
    const state = trackedSession.state
    const previousIncompleteCount = state.lastIncompleteCount
    const previousStagnationCount = state.stagnationCount
    const currentCompletedCount = todos?.filter((todo) => todo.status === "completed").length
    const currentTodoSnapshot = todos ? getTodoSnapshot(todos) : undefined
    const hasCompletedMoreTodos =
      currentCompletedCount !== undefined
      && trackedSession.lastCompletedCount !== undefined
      && currentCompletedCount > trackedSession.lastCompletedCount
    const hasTodoSnapshotChanged =
      currentTodoSnapshot !== undefined
      && trackedSession.lastTodoSnapshot !== undefined
      && currentTodoSnapshot !== trackedSession.lastTodoSnapshot
    const hadSuccessfulInjectionAwaitingProgressCheck = state.awaitingPostInjectionProgressCheck === true

    state.lastIncompleteCount = incompleteCount
    if (currentCompletedCount !== undefined) {
      trackedSession.lastCompletedCount = currentCompletedCount
    }
    if (currentTodoSnapshot !== undefined) {
      trackedSession.lastTodoSnapshot = currentTodoSnapshot
    }

    if (previousIncompleteCount === undefined) {
      state.stagnationCount = 0
      return {
        previousIncompleteCount,
        previousStagnationCount,
        stagnationCount: state.stagnationCount,
        hasProgressed: false,
        progressSource: "none",
      }
    }

    const hasProgressed = incompleteCount < previousIncompleteCount || hasCompletedMoreTodos || hasTodoSnapshotChanged

    if (hasProgressed) {
      state.stagnationCount = 0
      state.awaitingPostInjectionProgressCheck = false
      state.continuationResponseObserved = false
      state.continuationBlockReason = undefined
      state.pendingUserMessageID = undefined
      return {
        previousIncompleteCount,
        previousStagnationCount,
        stagnationCount: state.stagnationCount,
        hasProgressed: true,
        progressSource: "todo",
      }
    }

    if (!hadSuccessfulInjectionAwaitingProgressCheck) {
      return {
        previousIncompleteCount,
        previousStagnationCount,
        stagnationCount: state.stagnationCount,
        hasProgressed: false,
        progressSource: "none",
      }
    }

    state.awaitingPostInjectionProgressCheck = false
    if (
      state.continuationResponseObserved === true
      && state.continuationBlockReason !== "user-interruption"
    ) {
      state.continuationBlockReason = "directive-response"
    }
    state.continuationResponseObserved = false
    state.pendingUserMessageID = undefined
    state.stagnationCount += 1
    return {
      previousIncompleteCount,
      previousStagnationCount,
      stagnationCount: state.stagnationCount,
      hasProgressed: false,
      progressSource: "none",
    }
  }

  function resetContinuationProgress(sessionID: string): void {
    const trackedSession = sessions.get(sessionID)
    if (!trackedSession) return

    trackedSession.lastAccessedAt = Date.now()

    const { state } = trackedSession

    state.lastIncompleteCount = undefined
    state.stagnationCount = 0
    state.awaitingPostInjectionProgressCheck = false
    state.continuationResponseObserved = false
    state.continuationBlockReason = undefined
    state.pendingUserMessageID = undefined
    state.allTodosCompletedAt = undefined
    trackedSession.lastCompletedCount = undefined
    trackedSession.lastTodoSnapshot = undefined
  }

  function cancelCountdown(sessionID: string): void {
    const tracked = sessions.get(sessionID)
    if (!tracked) return

    const state = tracked.state
    if (state.countdownTimer) {
      clearTimeout(state.countdownTimer)
      state.countdownTimer = undefined
    }

    if (state.countdownInterval) {
      clearInterval(state.countdownInterval)
      state.countdownInterval = undefined
    }

    state.inFlight = false
    state.countdownStartedAt = undefined
  }

  function cleanup(sessionID: string): void {
    cancelCountdown(sessionID)
    sessions.delete(sessionID)
  }

  function cancelAllCountdowns(): void {
    for (const sessionID of sessions.keys()) {
      cancelCountdown(sessionID)
    }
  }

  function shutdown(): void {
    if (pruneInterval !== undefined) {
      clearInterval(pruneInterval)
    }
    cancelAllCountdowns()
    sessions.clear()
  }

  return {
    getState,
    getExistingState,
    startPruneInterval,
    trackContinuationProgress,
    resetContinuationProgress,
    cancelCountdown,
    cleanup,
    cancelAllCountdowns,
    shutdown,
  }
}

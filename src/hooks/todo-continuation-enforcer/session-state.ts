import type { SessionState, Todo } from "./types"

// TTL for idle session state entries (10 minutes)
const SESSION_STATE_TTL_MS = 10 * 60 * 1000
// Prune interval (every 2 minutes)
const SESSION_STATE_PRUNE_INTERVAL_MS = 2 * 60 * 1000

interface TrackedSessionState {
  state: SessionState
  lastAccessedAt: number
  lastCompletedCount?: number
  lastTodoStatusSignature?: string
}

export interface ContinuationProgressUpdate {
  previousIncompleteCount?: number
  stagnationCount: number
  hasProgressed: boolean
}

export interface SessionStateStore {
  getState: (sessionID: string) => SessionState
  getExistingState: (sessionID: string) => SessionState | undefined
  trackContinuationProgress: (sessionID: string, incompleteCount: number, todos?: Todo[]) => ContinuationProgressUpdate
  resetContinuationProgress: (sessionID: string) => void
  cancelCountdown: (sessionID: string) => void
  cleanup: (sessionID: string) => void
  cancelAllCountdowns: () => void
  shutdown: () => void
}

function getTodoStatusSignature(todos: Todo[]): string {
  return todos
    .map((todo) => `${todo.id ?? `${todo.content}:${todo.priority}`}:${todo.status}`)
    .sort()
    .join("|")
}

export function createSessionStateStore(): SessionStateStore {
  const sessions = new Map<string, TrackedSessionState>()

  // Periodic pruning of stale session states to prevent unbounded Map growth
  let pruneInterval: ReturnType<typeof setInterval> | undefined
  pruneInterval = setInterval(() => {
    const now = Date.now()
    for (const [sessionID, tracked] of sessions.entries()) {
      if (now - tracked.lastAccessedAt > SESSION_STATE_TTL_MS) {
        cancelCountdown(sessionID)
        sessions.delete(sessionID)
      }
    }
  }, SESSION_STATE_PRUNE_INTERVAL_MS)
  // Allow process to exit naturally even if interval is running
  if (typeof pruneInterval === "object" && "unref" in pruneInterval) {
    pruneInterval.unref()
  }

  function getTrackedSession(sessionID: string): TrackedSessionState {
    const existing = sessions.get(sessionID)
    if (existing) {
      existing.lastAccessedAt = Date.now()
      return existing
    }

    const state: SessionState = {
      stagnationCount: 0,
      consecutiveFailures: 0,
    }
    const trackedSession: TrackedSessionState = {
      state,
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
    todos?: Todo[]
  ): ContinuationProgressUpdate {
    const trackedSession = getTrackedSession(sessionID)
    const state = trackedSession.state
    const previousIncompleteCount = state.lastIncompleteCount
    const currentCompletedCount = todos?.filter((todo) => todo.status === "completed").length
    const currentTodoStatusSignature = todos ? getTodoStatusSignature(todos) : undefined
    const hasCompletedMoreTodos =
      currentCompletedCount !== undefined
      && trackedSession.lastCompletedCount !== undefined
      && currentCompletedCount > trackedSession.lastCompletedCount
    const hasTodoStatusChanged =
      currentTodoStatusSignature !== undefined
      && trackedSession.lastTodoStatusSignature !== undefined
      && currentTodoStatusSignature !== trackedSession.lastTodoStatusSignature
    const hadSuccessfulInjectionAwaitingProgressCheck = state.awaitingPostInjectionProgressCheck === true

    state.lastIncompleteCount = incompleteCount
    if (currentCompletedCount !== undefined) {
      trackedSession.lastCompletedCount = currentCompletedCount
    }
    if (currentTodoStatusSignature !== undefined) {
      trackedSession.lastTodoStatusSignature = currentTodoStatusSignature
    }

    if (previousIncompleteCount === undefined) {
      state.stagnationCount = 0
      return {
        previousIncompleteCount,
        stagnationCount: state.stagnationCount,
        hasProgressed: false,
      }
    }

    if (incompleteCount < previousIncompleteCount || hasCompletedMoreTodos || hasTodoStatusChanged) {
      state.stagnationCount = 0
      state.awaitingPostInjectionProgressCheck = false
      return {
        previousIncompleteCount,
        stagnationCount: state.stagnationCount,
        hasProgressed: true,
      }
    }

    if (!hadSuccessfulInjectionAwaitingProgressCheck) {
      return {
        previousIncompleteCount,
        stagnationCount: state.stagnationCount,
        hasProgressed: false,
      }
    }

    state.awaitingPostInjectionProgressCheck = false
    state.stagnationCount += 1
    return {
      previousIncompleteCount,
      stagnationCount: state.stagnationCount,
      hasProgressed: false,
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
    trackedSession.lastCompletedCount = undefined
    trackedSession.lastTodoStatusSignature = undefined
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
    clearInterval(pruneInterval)
    cancelAllCountdowns()
    sessions.clear()
  }

  return {
    getState,
    getExistingState,
    trackContinuationProgress,
    resetContinuationProgress,
    cancelCountdown,
    cleanup,
    cancelAllCountdowns,
    shutdown,
  }
}

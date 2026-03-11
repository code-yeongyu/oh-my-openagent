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
  activitySignalCount: number
  lastObservedActivitySignalCount?: number
}

export interface ContinuationProgressUpdate {
  previousIncompleteCount?: number
  previousStagnationCount: number
  stagnationCount: number
  hasProgressed: boolean
  progressSource: "none" | "todo" | "activity"
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

function getTodoSnapshot(todos: Todo[]): string {
  const normalizedTodos = todos
    .map((todo) => ({
      id: todo.id ?? null,
      content: todo.content,
      priority: todo.priority,
      status: todo.status,
    }))
    .sort((left, right) => {
      const leftKey = left.id ?? `${left.content}:${left.priority}:${left.status}`
      const rightKey = right.id ?? `${right.content}:${right.priority}:${right.status}`
      if (leftKey !== rightKey) {
        return leftKey.localeCompare(rightKey)
      }
      if (left.content !== right.content) {
        return left.content.localeCompare(right.content)
      }
      if (left.priority !== right.priority) {
        return left.priority.localeCompare(right.priority)
      }
      return left.status.localeCompare(right.status)
    })

  return JSON.stringify(normalizedTodos)
}

export function createSessionStateStore(): SessionStateStore {
  const sessions = new Map<string, TrackedSessionState>()

  // Periodic pruning of stale session states to prevent unbounded Map growth
  let pruneInterval: TimerHandle | undefined
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
  if (typeof pruneInterval === "object" && typeof pruneInterval.unref === "function") {
    pruneInterval.unref()
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
      activitySignalCount: 0,
    }
    trackedSession.state = new Proxy(rawState, {
      set(target, property, value, receiver) {
        if (property === "abortDetectedAt" && value === undefined) {
          trackedSession.activitySignalCount += 1
        }

        return Reflect.set(target, property, value, receiver)
      },
    })
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
    const previousStagnationCount = state.stagnationCount
    const currentCompletedCount = todos?.filter((todo) => todo.status === "completed").length
    const currentTodoSnapshot = todos ? getTodoSnapshot(todos) : undefined
    const currentActivitySignalCount = trackedSession.activitySignalCount
    const hasCompletedMoreTodos =
      currentCompletedCount !== undefined
      && trackedSession.lastCompletedCount !== undefined
      && currentCompletedCount > trackedSession.lastCompletedCount
    const hasTodoSnapshotChanged =
      currentTodoSnapshot !== undefined
      && trackedSession.lastTodoSnapshot !== undefined
      && currentTodoSnapshot !== trackedSession.lastTodoSnapshot
    const hasObservedExternalActivity =
      trackedSession.lastObservedActivitySignalCount !== undefined
      && currentActivitySignalCount > trackedSession.lastObservedActivitySignalCount
    const hadSuccessfulInjectionAwaitingProgressCheck = state.awaitingPostInjectionProgressCheck === true

    state.lastIncompleteCount = incompleteCount
    if (currentCompletedCount !== undefined) {
      trackedSession.lastCompletedCount = currentCompletedCount
    }
    if (currentTodoSnapshot !== undefined) {
      trackedSession.lastTodoSnapshot = currentTodoSnapshot
    }
    trackedSession.lastObservedActivitySignalCount = currentActivitySignalCount

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

    const progressSource = incompleteCount < previousIncompleteCount || hasCompletedMoreTodos || hasTodoSnapshotChanged
      ? "todo"
      : hasObservedExternalActivity
        ? "activity"
        : "none"

    if (progressSource !== "none") {
      state.stagnationCount = 0
      state.awaitingPostInjectionProgressCheck = false
      return {
        previousIncompleteCount,
        previousStagnationCount,
        stagnationCount: state.stagnationCount,
        hasProgressed: true,
        progressSource,
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
    trackedSession.lastCompletedCount = undefined
    trackedSession.lastTodoSnapshot = undefined
    trackedSession.activitySignalCount = 0
    trackedSession.lastObservedActivitySignalCount = undefined
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
    trackContinuationProgress,
    resetContinuationProgress,
    cancelCountdown,
    cleanup,
    cancelAllCountdowns,
    shutdown,
  }
}

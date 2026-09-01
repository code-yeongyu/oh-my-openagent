import type { FlushInput, FlushResult } from "@oh-my-opencode/senpi-task"

import type { ParentTransition } from "./runtime-context"

// The completion-notifier seam the bridge drives: flushing a session's buffered completions. During a
// parent transition (compacting / switching / shutdown) the completion push BUFFERS terminals instead
// of injecting into a mid-transition session; the bridge is the ONLY caller that releases that buffer.
export interface FlushingNotifier {
  flushBuffered(input: FlushInput): FlushResult
}

// The runtime seam: marking the live parent transition so routeCompletion sends terminals to the buffer.
export interface TransitionRuntime {
  setTransition(transition: ParentTransition): void
}

export interface SessionTransitionBridgeDeps {
  readonly runtime: TransitionRuntime
  readonly notifier: FlushingNotifier
}

export interface SessionTransitionBridge {
  onBeforeSwitch(sessionId: string | undefined): void
  onBeforeCompact(sessionId: string | undefined): void
  onCompact(sessionId: string | undefined): void
  onShutdown(sessionId: string | undefined): void
  onSessionStart(sessionId: string | undefined): void
}

/**
 * Wire the buffered-completion round trip (todo 18 inherited obligation). Without this, notifier
 * .flushBuffered has no caller and TaskRuntimeContext.setTransition is never invoked, so completions
 * that arrive while the parent is compacting/switching/shutting down would buffer forever and leak.
 *
 * Contract: a transition edge marks the runtime (so the completion push buffers) and remembers the
 * transitioning session id; the next resume edge of the SAME session flushes-and-delivers, while a
 * DIFFERENT session taking over flushes-as-dropped (the notification_dropped path).
 */
export function createSessionTransitionBridge(deps: SessionTransitionBridgeDeps): SessionTransitionBridge {
  let transitioningSessionId: string | undefined

  function mark(transition: Exclude<ParentTransition, undefined>, sessionId: string | undefined): void {
    deps.runtime.setTransition(transition)
    transitioningSessionId = sessionId
  }

  // Resolve a resume edge: deliver the buffer when the same session returns, drop it when replaced.
  function resolve(currentSessionId: string | undefined): void {
    const buffered = transitioningSessionId
    deps.runtime.setTransition(undefined)
    transitioningSessionId = undefined
    if (buffered === undefined) return
    const replaced = currentSessionId === undefined || currentSessionId !== buffered
    deps.notifier.flushBuffered({ sessionId: buffered, replaced })
  }

  return {
    onBeforeSwitch: (sessionId) => mark("session_switching", sessionId),
    onBeforeCompact: (sessionId) => mark("compacting", sessionId),
    onShutdown: (sessionId) => mark("session_shutdown", sessionId),
    // Compaction resumes the SAME session, so its completion buffer is delivered, never dropped.
    onCompact: (sessionId) => resolve(sessionId),
    onSessionStart: (sessionId) => resolve(sessionId),
  }
}

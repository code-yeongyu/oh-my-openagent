import { DETACHED_CELL_WAITS, PROGRESS_NOTE, lifecycleSnapshot } from "../../async-work.test-support"
import type { ChildSession, ChildSessionEvent, ChildSessionListener } from "../child-handle"

export function assistantEnd(text: string): ChildSessionEvent & { readonly text: string } {
  return {
    type: "message_end",
    text,
    message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" },
  }
}

/**
 * A session that behaves like senpi's AgentSession for omo#10487: `prompt()` resolves when the turn
 * ends, `lifecycle` reports the work the session still owns, and that work's completion starts a new
 * engine turn on its own. Like the engine's `dispose()` (agent aborted, listeners dropped), a disposed
 * session starts no turn when its work finishes. Like the engine's `abort()`, an abort ends the turn that
 * is running: `prompt()` resolves, and a turn the engine started itself emits its `agent_end`.
 */
export function heldWorkSession(sessionId = "child-10487") {
  const listeners = new Set<ChildSessionListener>()
  let waits: unknown = DETACHED_CELL_WAITS
  let lastText: string | undefined
  let endPrompt: (() => void) | undefined
  let disposed = false
  let agentStarts = 0
  let engineTurnOpen = false
  let disposedSignal: () => void = () => undefined
  const whenDisposed = new Promise<void>((resolve) => {
    disposedSignal = resolve
  })
  const emit = (event: ChildSessionEvent & { readonly text?: string }): void => {
    if (event.type === "agent_start") agentStarts += 1
    if (event.text !== undefined) lastText = event.text
    for (const listener of [...listeners]) listener(event)
  }
  const session: ChildSession = {
    sessionId,
    get lifecycle() {
      return lifecycleSnapshot(waits)
    },
    get isSessionBusy() {
      return waits !== undefined
    },
    prompt: () =>
      new Promise<void>((resolve) => {
        endPrompt = resolve
      }),
    steer: async () => "handled",
    followUp: async () => "handled",
    abort: async () => {
      endPrompt?.()
      if (!engineTurnOpen) return
      engineTurnOpen = false
      emit({ type: "agent_end" })
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getLastAssistantText: () => lastText,
    dispose: () => {
      disposed = true
      listeners.clear()
      disposedSignal()
    },
  }
  return {
    session,
    emit,
    setWaits: (next: unknown) => {
      waits = next
    },
    disposed: () => disposed,
    whenDisposed,
    agentStarts: () => agentStarts,
    endTurnWithDetachedCell: () => {
      emit(assistantEnd(PROGRESS_NOTE))
      endPrompt?.()
    },
    finishWork: () => {
      waits = undefined
      if (disposed) return
      engineTurnOpen = true
      emit({ type: "agent_start" })
    },
    answer: (text: string, pendingAfter?: unknown) => {
      waits = pendingAfter
      emit(assistantEnd(text))
      engineTurnOpen = false
      emit({ type: "agent_end" })
    },
  }
}

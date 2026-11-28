import type { AtomicHookDispatch } from "./client-agent"
import type { AtomicHookAgent } from "./contracts"

export type AtomicRecordingOwner = "omo" | "external" | "unavailable" | "conflict"
export type AtomicRecorderInventory = "none" | "one" | "ambiguous"

export function resolveAtomicRecordingOwner(
  preference: "auto" | "omo" | "external",
  active: AtomicRecorderInventory,
): AtomicRecordingOwner {
  if (preference === "omo") return active === "none" ? "omo" : "conflict"
  if (active === "one") return "external"
  if (preference === "auto" && active === "none") return "omo"
  return "unavailable"
}

export type AtomicRecordingEvent = {
  [Agent in AtomicHookAgent]: Pick<AtomicHookDispatch<Agent>, "agent" | "verb" | "payload">
}[AtomicHookAgent] & {
  /** Durable harness IDs supplied alongside the unchanged native hook payload. */
  readonly turnId?: string
  readonly toolCallId?: string
  readonly synthetic?: boolean
  readonly internal?: boolean
}

export type AtomicRecordingSession = {
  readonly sessionId: string
  readonly generation: number
  readonly agent: AtomicHookAgent
  readonly cwd: string
  /** Canonical working copy, not an unverified session cwd or a view name. */
  readonly checkout: string
  readonly repository: string
  readonly owner: AtomicRecordingOwner
  readonly timeoutMs: number
}

export type AtomicRecordingAdmission = "queued" | "incomplete" | "degraded" | "ignored"
export type AtomicRecordingCorrelation = "complete" | "incomplete" | "degraded"

export type RecordingSessionState = {
  readonly session: AtomicRecordingSession
  readonly seen: Set<string>
  started: boolean
  retired: boolean
  correlation: AtomicRecordingCorrelation
  turnId?: string
}

export function admitRecordingEvent(state: RecordingSessionState, event: AtomicRecordingEvent): AtomicRecordingAdmission {
  if (state.retired || state.session.owner !== "omo" || state.session.agent !== event.agent || event.synthetic || event.internal) {
    return "ignored"
  }
  const { verb } = event
  switch (verb) {
    case "session-start":
      if (state.started) return "ignored"
      state.started = true
      return "queued"
    case "session-end":
      state.retired = true
      return state.started ? "queued" : "ignored"
    case "user-prompt":
    case "user-prompt-submit": {
      if (!state.started || !event.turnId) return "ignored"
      const key = JSON.stringify([event.verb, event.turnId])
      if (state.seen.has(key)) return "ignored"
      state.seen.add(key)
      state.turnId = event.turnId
      return "queued"
    }
    case "stop":
      if (!event.turnId || event.turnId !== state.turnId) return "ignored"
      state.turnId = undefined
      return "queued"
    case "before-tool":
    case "pre-tool":
    case "after-tool":
    case "post-tool": {
      if (!event.turnId || event.turnId !== state.turnId) return "ignored"
      if (!event.toolCallId) return "degraded"
      const result = event.verb === "after-tool" || event.verb === "post-tool"
      const startKey = JSON.stringify(["start", event.turnId, event.toolCallId])
      const resultKey = JSON.stringify(["result", event.turnId, event.toolCallId])
      if (state.seen.has(resultKey) || (!result && state.seen.has(startKey))) return "ignored"
      state.seen.add(result ? resultKey : startKey)
      return result && !state.seen.has(startKey) ? "incomplete" : "queued"
    }
    default: {
      const unreachable: never = verb
      return unreachable
    }
  }
}

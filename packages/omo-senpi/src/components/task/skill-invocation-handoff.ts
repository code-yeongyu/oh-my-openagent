// Session-keyed plan-gate evidence handed from a retiring extension generation to its replacement.
// "reload" rebuilds the runner for the same session; new/resume/fork set the session aside under the
// same id. "quit" or a missing reason retires it. senpi keeps the extension module across a reload
// (no clearExtensionCache() once a loader has loaded, since v2026.10.11), so this module-level store
// is shared by both generations; proven on a real senpi RPC host (reload between two plan-reviewer
// spawns). Only real input events write a channel, so a carried record cannot launder provenance.

export type PlanTouch = { count: number; lastTouchedAt: number }

export type SessionHandoff = {
  readonly invoked: readonly string[]
  readonly requested: readonly string[]
  readonly planTouches: readonly (readonly [string, PlanTouch])[]
  readonly planTouchSequence: number
}

const SESSION_SURVIVING_SHUTDOWN_REASONS: ReadonlySet<string> = new Set(["reload", "new", "resume", "fork"])

// Oldest-first eviction bound. A record is a handful of skill names and plan paths; 256 covers far
// more sessions than one process switches between while keeping the worst case small.
export const SESSION_HANDOFF_CAPACITY = 256

const sessionHandoffs = new Map<string, SessionHandoff>()

export function shutdownKeepsSession(payload: unknown): boolean {
  if (typeof payload !== "object" || payload === null) return false
  const reason: unknown = Reflect.get(payload, "reason")
  return typeof reason === "string" && SESSION_SURVIVING_SHUTDOWN_REASONS.has(reason)
}

export function depositSessionHandoff(sessionId: string, handoff: SessionHandoff): void {
  sessionHandoffs.delete(sessionId)
  if (handoff.invoked.length === 0 && handoff.requested.length === 0 && handoff.planTouches.length === 0) return
  sessionHandoffs.set(sessionId, handoff)
  while (sessionHandoffs.size > SESSION_HANDOFF_CAPACITY) {
    const oldest = sessionHandoffs.keys().next()
    if (oldest.done === true) return
    sessionHandoffs.delete(oldest.value)
  }
}

export function takeSessionHandoff(sessionId: string): SessionHandoff | undefined {
  const handoff = sessionHandoffs.get(sessionId)
  sessionHandoffs.delete(sessionId)
  return handoff
}

export function discardSessionHandoff(sessionId: string): void {
  sessionHandoffs.delete(sessionId)
}

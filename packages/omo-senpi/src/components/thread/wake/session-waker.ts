import type { GatewayStore } from "../gateway/store"
import type { WokenSessionFence } from "../gateway/woken-types"
import type { WakeOpen, WakeOpenReply } from "./legacy-open"
import { resolveWakeTarget, type WakeSessionKind } from "./session-target"

export type WakeOutcome =
  /** The session is open (or the open attached to it); the row stays `opening` for the carrier's next step. */
  | { readonly kind: "live"; readonly session_id: string; readonly state: unknown; readonly generation: number }
  | { readonly kind: "gone" }
  | { readonly kind: "ambiguous"; readonly session_paths: readonly string[] }
  | { readonly kind: "not_wakeable"; readonly session_kind: Exclude<WakeSessionKind, "interactive"> }
  | { readonly kind: "overloaded" }
  | { readonly kind: "not_yet"; readonly next_attempt_at: number }
  | { readonly kind: "busy"; readonly code: string; readonly retry_after_ms?: number }
  | { readonly kind: "deferred"; readonly attempts: number; readonly next_attempt_at: number }
  | { readonly kind: "failed"; readonly attempts: number; readonly error: string }

export type SessionWakerOptions = {
  readonly store: GatewayStore
  /** `<agentDir>/sessions`: the only place a durable id is resolved; a caller never names a path. */
  readonly sessionsDirectory: string
  readonly ensureHost: () => Promise<void>
  readonly open: WakeOpen
}

export type SessionWaker = { readonly ensureSessionRunning: (durableId: string) => Promise<WakeOutcome> }

/** A holder outside the wake's host owns the file; its own drain admits, so the wake steps aside (A3.1.5). */
const HELD_ELSEWHERE: ReadonlySet<string> = new Set(["session_held", "session_path_in_use"])
const DEFINITIVE: ReadonlySet<string> = new Set(["invalid_path", "unknown_session"])

const IN_FLIGHT_KEY = Symbol.for("omo.thread.wake.in-flight")

/** Single flight per durable id in this process, shared by every copy of this module (the bundle and a sidecar). */
function inFlight(): Map<string, Promise<WakeOutcome>> {
  const holder = globalThis as { [IN_FLIGHT_KEY]?: Map<string, Promise<WakeOutcome>> }
  holder[IN_FLIGHT_KEY] ??= new Map()
  return holder[IN_FLIGHT_KEY]
}

async function settleOpen(store: GatewayStore, fence: WokenSessionFence, reply: WakeOpenReply): Promise<WakeOutcome> {
  if (reply.kind === "opened")
    return { kind: "live", session_id: reply.session_id, state: reply.state, generation: fence.generation }
  if (reply.kind === "refused" && (HELD_ELSEWHERE.has(reply.code) || DEFINITIVE.has(reply.code))) {
    await store.woken.end(fence)
    if (DEFINITIVE.has(reply.code)) return { kind: "gone" }
    return {
      kind: "busy",
      code: reply.code,
      ...(reply.retry_after_ms === undefined ? {} : { retry_after_ms: reply.retry_after_ms }),
    }
  }
  const retry = await store.woken.retryLater(fence)
  if (retry.kind === "lost_lease") return { kind: "busy", code: "wake_in_progress" }
  if (retry.kind === "failed")
    return { kind: "failed", attempts: retry.attempts, error: reply.kind === "refused" ? reply.code : reply.message }
  return { kind: "deferred", attempts: retry.row.attempts, next_attempt_at: retry.row.next_attempt_at ?? 0 }
}

async function wake(options: SessionWakerOptions, durableId: string): Promise<WakeOutcome> {
  const target = resolveWakeTarget(options.sessionsDirectory, durableId)
  if (target.kind === "gone") return target
  if (target.kind === "ambiguous") return target
  if (target.session_kind !== "interactive") return { kind: "not_wakeable", session_kind: target.session_kind }

  await options.store.woken.request({ durable_id: durableId, session_file: target.session_path })
  const started = await options.store.woken.start({ durable_id: durableId })
  if (started.kind === "overloaded") return { kind: "overloaded" }
  if (started.kind === "not_yet") return started
  if (started.kind !== "started") return { kind: "busy", code: "wake_in_progress" }

  const fence = { durable_id: durableId, generation: started.row.generation }
  let reply: WakeOpenReply
  try {
    await options.ensureHost()
    reply = await options.open({ sessionPath: target.session_path, cwd: target.cwd })
  } catch (error) {
    reply = { kind: "unreachable", message: error instanceof Error ? error.message : String(error) }
  }
  return await settleOpen(options.store, fence, reply)
}

/**
 * The wake primitive, steps 1 to 5 (#13037 design 5.2, amendment A3.1.5): it carries no message and nothing after the open.
 * Every outcome of the open other than success takes the row out of `opening` in one compare-and-set.
 */
export function createSessionWaker(options: SessionWakerOptions): SessionWaker {
  return {
    ensureSessionRunning: (durableId) => {
      const key = `${options.sessionsDirectory}\u0000${durableId}`
      const running = inFlight().get(key)
      if (running !== undefined) return running
      const started = wake(options, durableId).finally(() => inFlight().delete(key))
      inFlight().set(key, started)
      return started
    },
  }
}

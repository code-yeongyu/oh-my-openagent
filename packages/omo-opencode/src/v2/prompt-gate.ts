import type { Plugin } from "@opencode/plugin"

export type V2PromptDelivery = "steer" | "queue"

export type V2PromptDispatchResult =
  | { status: "dispatched" }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: unknown }

export interface V2PromptGate {
  dispatch(input: {
    sessionID: string
    text: string
    delivery?: V2PromptDelivery
    signal?: AbortSignal
  }): Promise<V2PromptDispatchResult>
}

const DEFAULT_HOLD_MS = 2_000

export function createV2PromptGate(
  session: Plugin.Context["session"],
  options: { holdMs?: number; now?: () => number } = {},
): V2PromptGate {
  const holdMs = options.holdMs ?? DEFAULT_HOLD_MS
  const now = options.now ?? Date.now
  const holds = new Map<string, number>()
  return {
    async dispatch(input): Promise<V2PromptDispatchResult> {
      const heldUntil = holds.get(input.sessionID) ?? 0
      if (now() < heldUntil) return { status: "skipped", reason: "duplicate dispatch inside post-dispatch hold" }
      holds.set(input.sessionID, now() + holdMs)
      try {
        try {
          const info = await session.get({ sessionID: input.sessionID })
          if (info.outcome) {
            holds.delete(input.sessionID)
            return { status: "skipped", reason: `session already ${info.outcome}` }
          }
        } catch {
          // Best effort: a missing session read must not block the dispatch.
        }
        await session.prompt({
          sessionID: input.sessionID,
          text: input.text,
          delivery: input.delivery ?? "queue",
        })
        holds.set(input.sessionID, now() + holdMs)
        return { status: "dispatched" }
      } catch (error) {
        holds.delete(input.sessionID)
        return { status: "failed", error }
      }
    },
  }
}

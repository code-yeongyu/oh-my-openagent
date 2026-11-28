import type { LocatedControl } from "../control/locate"
import type { ThreadToolResult } from "../contracts"
import { listingProof } from "../remote/listing-liveness"
import { addressBook, degradedSummary, summary, targetSession } from "./internals"
import type { ThreadHostView, ThreadToolSurfaceOptions } from "./ports"

export function readProof(
  options: ThreadToolSurfaceOptions,
  current: ThreadHostView,
  located: Exclude<LocatedControl, { kind: "error" }>,
) {
  if (located.row) return listingProof(located.row)
  const id = located.kind === "control" ? located.control.thread_id : located.thread_id
  const session = targetSession(current, id)
  const entry = addressBook(options, current).find((e) => e.thread_id === id)
  const facts = session ? summary(session, entry) : entry && degradedSummary(entry)
  if (!facts) return {}
  const { state, liveness, verification } = facts
  return {
    state,
    ...(liveness && { liveness }),
    ...(verification && { verification }),
    ...(liveness?.kind === "held" && { hold: liveness.hold }),
  }
}

export async function withReadProof(
  answer: Promise<ThreadToolResult> | ThreadToolResult,
  proof: ReturnType<typeof readProof>,
): Promise<ThreadToolResult> {
  const result = await answer
  return result.kind === "ok" ? { ...result, ...proof } : result
}

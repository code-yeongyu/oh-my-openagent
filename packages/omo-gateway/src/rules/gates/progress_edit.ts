import { OK, type GateOp, type OutboundGate } from "./types"

// Progress lives in one message edited in place: once a progress message exists, a new progress
// post becomes an edit of it (same text); a second progress message is never started.
export const gate: OutboundGate = {
  id: "progress_edit",
  phase: "outbound",
  run(intent, _params, ctx) {
    if (intent.kind !== "progress") return OK
    const posts = intent.ops.filter((op) => op.op === "post")
    const existing = ctx.progress_message_id ?? null
    if (existing === null) {
      return posts.length <= 1 ? OK : { refuse: "progress goes in one message; this update posts several" }
    }
    if (intent.ops.some((op) => op.op === "edit" && op.message_id !== existing)) {
      return { refuse: "a progress update may only edit the chat thread's progress message" }
    }
    if (posts.length === 0) return OK
    if (posts.length > 1) return { refuse: "progress goes in one message; this update posts several" }
    const ops = intent.ops.map((op): GateOp => (op.op === "post" ? { op: "edit", key: op.key, message_id: existing, text: op.text } : op))
    return { repair: { ...intent, ops }, note: "turned the progress post into an edit of the existing progress message" }
  },
}

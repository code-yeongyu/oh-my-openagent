import { OK, sameKey, type GateOp, type OutboundGate } from "./types"

function writes(op: GateOp | undefined, typing: GateOp): boolean {
  if (op === undefined || typing.op !== "typing") return false
  if (op.op !== "post" && op.op !== "edit" && op.op !== "open_thread") return false
  return sameKey(op.key, typing.key)
}

// The typing indicator shows only while a message is being written: a typing op must come right
// before a post/edit in the same chat thread. Stray typing ops are removed (they carry no text).
export const gate: OutboundGate = {
  id: "typing_while_writing",
  phase: "outbound",
  run(intent) {
    const kept = intent.ops.filter((op, index) => op.op !== "typing" || writes(intent.ops[index + 1], op))
    const removed = intent.ops.length - kept.length
    if (removed === 0) return OK
    return { repair: { ...intent, ops: kept }, note: `removed ${removed} typing indicator(s) not followed by a message` }
  },
}

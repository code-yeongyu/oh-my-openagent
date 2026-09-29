import type { GateParams } from "../gates"
import { leadTextOp, mentions, prefixLeadText } from "./mention"
import { isStatusReactionOp, statusReactionOps } from "./status_sync"
import { opText } from "./text"
import { durationParam, OK, type OutboundGate } from "./types"

/** Wait before re-ping number `pingsSent + 1`: `params.every` (default 30m) doubling up to `params.max` (default 4h). */
export function nagIntervalMs(params: GateParams, pingsSent: number): number {
  const every = durationParam(params, "every", "30m")
  const max = durationParam(params, "max", "4h")
  return Math.min(every * 2 ** Math.max(0, pingsSent), Math.max(every, max))
}

export function nextNagAt(params: GateParams, lastPingAt: number, pingsSent: number): number {
  return lastPingAt + nagIntervalMs(params, pingsSent)
}

// A decision question (and every re-ping) mentions the person asked and sets the header's status
// reaction to waiting; the re-ping schedule itself is nagIntervalMs, run by the decisions loop.
export const gate: OutboundGate = {
  id: "decision_nag",
  phase: "outbound",
  run(intent, params, ctx) {
    const ask = ctx.decision?.ask ?? null
    if (intent.kind !== "question" || ask === null) return OK
    nagIntervalMs(params, 0)
    let next = intent
    const notes: string[] = []
    const index = leadTextOp(next)
    const op = next.ops[index]
    if (op !== undefined && !mentions(opText(op) ?? "", ask)) {
      next = prefixLeadText(next, index, `<@${ask}> `)
      notes.push("mentioned the person the decision is asked of")
    }
    const headerId = ctx.work_item?.header_message_id ?? null
    if (headerId !== null) {
      const wanted = statusReactionOps(next, headerId, "waiting", params)
      const present = next.ops.filter((entry) => isStatusReactionOp(entry, headerId, params))
      if (JSON.stringify(present) !== JSON.stringify(wanted)) {
        next = { ...next, ops: [...next.ops.filter((entry) => !isStatusReactionOp(entry, headerId, params)), ...wanted] }
        notes.push("set the header's status reaction to waiting")
      }
    }
    return notes.length === 0 ? OK : { repair: next, note: notes.join("; ") }
  },
}

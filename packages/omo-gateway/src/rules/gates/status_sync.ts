import type { GateParams } from "../gates"
import { GateParamsError, OK, type GateOp, type OutboundGate, type OutboundIntent, type WorkStatus } from "./types"

const DEFAULT_STATUS_REACTIONS: Readonly<Record<WorkStatus, string>> = {
  working: "working",
  waiting: "waiting",
  done: "done",
  failed: "failed",
}

const WORK_STATUSES: readonly WorkStatus[] = ["working", "waiting", "done", "failed"]

/** The status -> reaction name map: gateway reaction names by default, overridable in `params.reactions`. */
export function statusReactions(params: GateParams): Readonly<Record<WorkStatus, string>> {
  const raw = params.reactions
  if (raw === undefined || raw === null) return DEFAULT_STATUS_REACTIONS
  if (typeof raw !== "object" || Array.isArray(raw)) throw new GateParamsError("params.reactions must map statuses to reaction names")
  const merged: Record<WorkStatus, string> = { ...DEFAULT_STATUS_REACTIONS }
  for (const [status, name] of Object.entries(raw)) {
    const known = WORK_STATUSES.find((entry) => entry === status)
    if (known === undefined || typeof name !== "string" || name.length === 0) {
      throw new GateParamsError(`params.reactions.${status} is not a status with a reaction name`)
    }
    merged[known] = name
  }
  return merged
}

/** Reaction ops that leave exactly one status reaction (`status`) on the header. */
export function statusReactionOps(intent: OutboundIntent, headerId: string, status: WorkStatus, params: GateParams): GateOp[] {
  const names = statusReactions(params)
  const key = intent.key
  return [
    ...WORK_STATUSES.filter((entry) => entry !== status).map((entry): GateOp => ({ op: "unreact", key, message_id: headerId, name: names[entry] })),
    { op: "react", key, message_id: headerId, name: names[status] },
  ]
}

export function isStatusReactionOp(op: GateOp, headerId: string, params: GateParams): boolean {
  const names = new Set(Object.values(statusReactions(params)))
  return (op.op === "react" || op.op === "unreact") && op.message_id === headerId && names.has(op.name)
}

function sameOps(left: readonly GateOp[], right: readonly GateOp[]): boolean {
  return left.length === right.length && left.every((op, index) => JSON.stringify(op) === JSON.stringify(right[index]))
}

// A status change is three things at once: a status reply appended in the thread (history), the
// header's status line edited (current state) and exactly one status reaction on the header.
export const gate: OutboundGate = {
  id: "status_sync",
  phase: "outbound",
  run(intent, params, ctx) {
    if (intent.kind !== "status") return OK
    const headerId = ctx.work_item?.header_message_id ?? null
    if (headerId === null) return { refuse: "a status change needs the work item header it updates" }
    if (intent.status === undefined) return { refuse: "a status change must say which status it sets" }
    if (!intent.ops.some((op) => op.op === "post" && op.text.trim() !== "")) {
      return { refuse: "a status change must append a status reply in the thread (never edit-only)" }
    }
    if (!intent.ops.some((op) => op.op === "edit" && op.message_id === headerId)) {
      return { refuse: "a status change must also edit the status line of the work item header" }
    }
    const reactions = intent.ops.filter((op) => isStatusReactionOp(op, headerId, params))
    const wanted = statusReactionOps(intent, headerId, intent.status, params)
    if (sameOps(reactions, wanted)) return OK
    const rest = intent.ops.filter((op) => !isStatusReactionOp(op, headerId, params))
    return { repair: { ...intent, ops: [...rest, ...wanted] }, note: `set exactly one status reaction (${intent.status}) on the header` }
  },
}

import { leadTextOp, mentions, prefixLeadText } from "./mention"
import { opText } from "./text"
import { OK, type OutboundGate } from "./types"

// Work-item headers and decision questions name the requester with a real mention (a bold name
// does not notify anyone). Missing mention + known requester -> prefixed; unknown requester -> refused.
export const gate: OutboundGate = {
  id: "mention_requester",
  phase: "outbound",
  run(intent, _params, ctx) {
    if (intent.kind !== "header" && intent.kind !== "question") return OK
    const index = leadTextOp(intent)
    const op = intent.ops[index]
    if (op === undefined) return OK
    const text = opText(op) ?? ""
    const requester = ctx.requester ?? null
    if (requester === null) {
      return { refuse: `a ${intent.kind === "header" ? "work item header" : "decision question"} must mention its requester, and no requester is known` }
    }
    const firstLine = intent.kind === "header" ? (text.split("\n")[0] ?? "") : text
    if (mentions(firstLine, requester)) return OK
    const prefix = intent.kind === "header" ? `<@${requester}>: ` : `<@${requester}> `
    return { repair: prefixLeadText(intent, index, prefix), note: "added a real mention of the requester" }
  },
}

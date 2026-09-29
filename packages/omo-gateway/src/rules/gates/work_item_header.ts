import { opText, withOpText } from "./text"
import { OK, type GateOp, type OutboundGate, type OutboundGateContext, type OutboundIntent, type WorkItemContext } from "./types"

// Header shape: `<@requester>: <one line>` / `<source|from #chat>` / blank / status line, then
// optional extra lines. Repairs only fill in missing parts from the work item; never removes text.
const SUMMARY_RE = /^<@[^\s|<>]+(?:\|[^<>]*)?>: \S/
const SOURCE_RE = /^<https?:\/\/[^\s|<>]+\|from [^<>]+>$/

class HeaderRefusal extends Error {}

function fixHeader(text: string, ctx: OutboundGateContext, item: WorkItemContext | null): string {
  const lines = text.split("\n")
  const summary = lines[0]?.trim() ?? ""
  if (summary === "") throw new HeaderRefusal("the header's first line must be `<@requester>: <one line>`")
  if (!SUMMARY_RE.test(summary)) {
    if (ctx.requester === undefined || ctx.requester === null) throw new HeaderRefusal("the header's first line must start with `<@requester>: `")
    lines[0] = `<@${ctx.requester}>: ${summary}`
  }
  if (!SOURCE_RE.test(lines[1]?.trim() ?? "")) {
    const source = item?.source ?? null
    if (source === null) throw new HeaderRefusal("the header's second line must be the source link `<url|from #chat>`")
    lines.splice(1, 0, `<${source.url}|from #${source.chat.replace(/^#/, "")}>`)
  }
  if (lines.length < 3) lines.push("")
  else if ((lines[2] ?? "").trim() !== "") lines.splice(2, 0, "")
  if ((lines[3] ?? "").trim() === "") {
    const status = item?.status_line ?? null
    if (status === null || status.trim() === "") throw new HeaderRefusal("the header must end with a status line after a blank line")
    lines.splice(3, lines[3] === undefined ? 0 : 1, status.trim())
  }
  return lines.join("\n")
}

function isHeaderOp(op: GateOp, intent: OutboundIntent, item: WorkItemContext | null): boolean {
  if (opText(op) === null || op.op === "upload" || op.op === "create_chat") return false
  if (op.op === "edit" && item !== null && op.message_id === item.header_message_id) return true
  return intent.kind === "header"
}

export const gate: OutboundGate = {
  id: "work_item_header",
  phase: "outbound",
  run(intent, _params, ctx) {
    const item = ctx.work_item ?? null
    let changed = false
    const ops: GateOp[] = []
    try {
      for (const op of intent.ops) {
        const text = opText(op)
        if (text === null || !isHeaderOp(op, intent, item)) {
          ops.push(op)
          continue
        }
        const fixed = fixHeader(text, ctx, item)
        if (fixed !== text) changed = true
        ops.push(withOpText(op, fixed))
      }
    } catch (error) {
      if (error instanceof HeaderRefusal) return { refuse: error.message }
      throw error
    }
    return changed ? { repair: { ...intent, ops }, note: "completed the work item header layout" } : OK
  },
}

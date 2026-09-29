import { parseRich } from "../../adapter/rich"
import { opText, withOpText } from "./text"
import type { OutboundIntent } from "./types"

export function mentions(markup: string, userId: string): boolean {
  return parseRich(markup).some((node) => node.t === "mention" && node.platform_user_id === userId)
}

/** Index of the op that carries a question's or header's text: the first text-carrying op. */
export function leadTextOp(intent: OutboundIntent): number {
  return intent.ops.findIndex((op) => opText(op) !== null)
}

export function prefixLeadText(intent: OutboundIntent, index: number, prefix: string): OutboundIntent {
  const ops = intent.ops.map((op, at) => (at === index ? withOpText(op, prefix + (opText(op) ?? "")) : op))
  return { ...intent, ops }
}

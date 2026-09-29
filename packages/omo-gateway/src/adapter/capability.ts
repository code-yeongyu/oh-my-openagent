import { AdapterRefusal, type Capabilities, type Platform, type RenderedOp, type RichBody } from "./contract"
import { plainText } from "./rich"

type BooleanCapability = Exclude<keyof Capabilities, "max_text">

function bodiesOf(op: RenderedOp): readonly RichBody[] {
  switch (op.op) {
    case "post":
    case "edit":
      return [op.body]
    case "open_thread":
      return [op.root]
    case "upload":
      return op.comment ? [op.comment] : []
    case "stream_draft":
      return [[{ t: "text", text: op.text }]]
    default:
      return []
  }
}

/** The capabilities `op` needs, in the order core checks them. */
export function requiredCapabilities(op: RenderedOp): readonly BooleanCapability[] {
  const needs: BooleanCapability[] = []
  if ("key" in op && "thread_id" in op.key && op.key.thread_id !== null) needs.push("threads")
  switch (op.op) {
    case "edit":
      needs.push("edit")
      break
    case "react":
    case "unreact":
      needs.push("reactions")
      break
    case "typing":
      needs.push("typing")
      break
    case "upload":
      needs.push("uploads")
      break
    case "open_thread":
      needs.push("threads")
      break
    case "archive_thread":
    case "reopen_thread":
      needs.push("thread_archive")
      break
    case "create_chat":
      needs.push("chat_create")
      break
    case "stream_draft":
      needs.push("draft_stream")
      break
    case "post":
      break
  }
  return needs
}

/** The refusal `op` earns under `caps`, or null when the adapter can carry it. */
export function checkCapability(platform: Platform, caps: Capabilities, op: RenderedOp): AdapterRefusal | null {
  for (const capability of requiredCapabilities(op)) {
    if (!caps[capability]) {
      return new AdapterRefusal(op.op, capability, `${op.op} needs capability ${capability}, which is false on ${platform}`)
    }
  }
  for (const body of bodiesOf(op)) {
    const length = plainText(body).length
    if (length > caps.max_text) {
      return new AdapterRefusal(op.op, "max_text", `${op.op} body is ${length} characters; ${platform} carries at most ${caps.max_text}`)
    }
  }
  return null
}

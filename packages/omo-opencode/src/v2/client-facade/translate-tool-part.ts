import type { V2AssistantContent, V2ToolContentItem } from "../context-types"
import { toV1ToolName } from "../tool-names"
import type { V1Part } from "./v1-message-types"

type ToolContent = Extract<V2AssistantContent, { type: "tool" }>

function joinText(content: ReadonlyArray<V2ToolContentItem> | undefined): string {
  return (content ?? []).flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n")
}

function toAttachments(content: ReadonlyArray<V2ToolContentItem> | undefined, base: { id: string; sessionID: string; messageID: string }) {
  const files = (content ?? []).flatMap((item) => (item.type === "file" ? [item] : []))
  return files.map((file, index) => ({
    id: `${base.id}:file:${index}`,
    sessionID: base.sessionID,
    messageID: base.messageID,
    type: "file",
    mime: file.mime,
    url: file.uri,
    ...(file.name === undefined ? {} : { filename: file.name }),
  }))
}

/** A 2.x tool call as the 1.x `tool` part state machine: pending, running, completed, error. */
function toToolState(call: ToolContent, base: { id: string; sessionID: string; messageID: string }): Record<string, unknown> {
  const start = call.time.ran ?? call.time.created
  const { state } = call
  if (state.status === "streaming") return { status: "pending", input: {}, raw: state.input }
  if (state.status === "running") return { status: "running", input: state.input, metadata: state.metadata, time: { start } }
  const end = call.time.completed ?? start
  if (state.status === "error") {
    return { status: "error", input: state.input, error: state.error.message, metadata: state.metadata ?? {}, time: { start, end } }
  }
  const attachments = toAttachments(state.content, base)
  return {
    status: "completed",
    input: state.input,
    output: joinText(state.content),
    title: "",
    metadata: state.metadata ?? {},
    time: { start, end },
    ...(attachments.length === 0 ? {} : { attachments }),
  }
}

export function translateToolPart(call: ToolContent, base: { id: string; sessionID: string; messageID: string }): V1Part {
  return { ...base, type: "tool", callID: call.id, tool: toV1ToolName(call.name), state: toToolState(call, base) }
}

import { requiredCapabilities } from "../capability"
import type { Capabilities, RenderedOp, SurfaceAdapter, SurfaceKey } from "../contract"
import type { Check } from "./types"
import { expectRefusal } from "./wait"

type Probe = { what: string; op: (message_id: string) => RenderedOp }

function probes(chat: SurfaceKey): readonly Probe[] {
  const thread: SurfaceKey = { ...chat, thread_id: "conformance-thread" }
  const { platform, account_id } = chat
  return [
    { what: "edit", op: (message_id) => ({ op: "edit", key: chat, message_id, body: [{ t: "text", text: "edited" }] }) },
    { what: "react", op: (message_id) => ({ op: "react", key: chat, message_id, name: "done" }) },
    { what: "unreact", op: (message_id) => ({ op: "unreact", key: chat, message_id, name: "done" }) },
    { what: "typing", op: () => ({ op: "typing", key: chat }) },
    { what: "upload", op: () => ({ op: "upload", key: chat, files: [{ path: "/nonexistent/conformance.txt", title: "conformance.txt" }], comment: null }) },
    { what: "open_thread", op: () => ({ op: "open_thread", key: chat, root: [{ t: "text", text: "root" }] }) },
    { what: "post into a thread", op: () => ({ op: "post", key: thread, body: [{ t: "text", text: "reply" }] }) },
    { what: "archive_thread", op: () => ({ op: "archive_thread", key: thread }) },
    { what: "reopen_thread", op: () => ({ op: "reopen_thread", key: thread }) },
    { what: "create_chat", op: () => ({ op: "create_chat", key: { platform, account_id }, name: "conformance", kind: "channel" }) },
    { what: "stream_draft", op: () => ({ op: "stream_draft", key: chat, draft_id: "1", text: "draft", final: false }) },
  ]
}

function missing(caps: Capabilities, op: RenderedOp) {
  return requiredCapabilities(op).filter((capability) => !caps[capability])
}

async function ownMessage(adapter: SurfaceAdapter, chat: SurfaceKey): Promise<string> {
  return (await adapter.send({ op: "post", key: chat, body: [{ t: "text", text: "refusal probe" }] })).message_id
}

export const capabilityRefusals: Check = async ({ makeAdapter, fixtures }) => {
  const adapter = await makeAdapter()
  const caps = adapter.capabilities()
  const refused: string[] = []
  let message_id: string | null = null
  for (const probe of probes(fixtures.chat)) {
    const needs = missing(caps, probe.op(""))
    if (needs.length === 0) continue
    message_id ??= await ownMessage(adapter, fixtures.chat)
    const op = probe.op(message_id)
    await expectRefusal(() => adapter.send(op), needs, probe.what)
    refused.push(`${probe.what} (${needs.join("+")})`)
  }
  if (caps.max_text <= 100_000) {
    const long: RenderedOp = { op: "post", key: fixtures.chat, body: [{ t: "text", text: "x".repeat(caps.max_text + 1) }] }
    await expectRefusal(() => adapter.send(long), ["max_text"], `a post of max_text + 1 (${caps.max_text + 1}) characters`)
    refused.push("post over max_text")
  }
  return refused.length === 0 ? "every op is claimed; nothing to refuse" : `refused honestly: ${refused.join(", ")}`
}

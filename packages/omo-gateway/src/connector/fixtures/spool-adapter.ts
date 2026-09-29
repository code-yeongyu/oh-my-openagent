// A cross-process fake surface for connector tests and QA, loaded with
// `--adapter-module <this file>`. Its human side is a JSON-lines spool file (path in
// OMO_GATEWAY_QA_SPOOL) that a test or a shell appends to while the connector runs, stops or
// restarts: `listen` streams lines appended after it connected, `catchUp` replays every line newer
// than `since`, and both yield the same event ids, so the connector's dedupe is what keeps each
// message to one sink line. Outbound ops succeed without touching anything.

import { readFile } from "@oh-my-opencode/memory-core/fs"
import type { InboundEvent, SurfaceAdapter } from "../../adapter/contract"
import { FAKE_DEFAULT_CAPABILITIES } from "../../adapters/fake/adapter"
import type { AdapterFactoryInput } from "../cli"

export type SpoolLine = { event_id: string; chat_id: string; thread_id: string | null; text: string; at: string }

export function spoolLine(line: SpoolLine): string {
  return `${JSON.stringify(line)}\n`
}

function toEvent(input: AdapterFactoryInput, line: SpoolLine): InboundEvent {
  return {
    event_id: line.event_id,
    key: { platform: input.surface.platform, account_id: input.surface.account_id ?? "", chat_id: line.chat_id, thread_id: line.thread_id },
    author: { platform_user_id: "U000ALICE", display: "Alice", is_bot: false },
    kind: line.thread_id === null ? "channel" : "thread_reply",
    reaction: null,
    edited: null,
    gateway_marker: false,
    text: line.text,
    transcript: null,
    attachments: [],
    reply_to: null,
    at: line.at,
    permalink: `https://fake.invalid/${line.chat_id}/${line.event_id}`,
  }
}

async function readSpool(path: string): Promise<Buffer> {
  try {
    return await readFile(path)
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return Buffer.alloc(0)
    throw error
  }
}

function parseLines(bytes: Buffer): SpoolLine[] {
  return bytes
    .toString("utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line): SpoolLine => JSON.parse(line))
}

export function createAdapter(input: AdapterFactoryInput): SurfaceAdapter {
  const spool = process.env["OMO_GATEWAY_QA_SPOOL"]
  if (spool === undefined || spool === "") throw new Error("OMO_GATEWAY_QA_SPOOL is not set")
  return {
    platform: input.surface.platform,
    capabilities: () => ({ ...FAKE_DEFAULT_CAPABILITIES }),
    async listen(onEvent, signal, ready) {
      if (signal.aborted) return
      const offset = (await readSpool(spool)).length
      // tail streams appends from the exact byte offset; the sh wrapper kills it when its stdin closes,
      // which happens on abort and also when this process dies (kill -9), so no tail outlives it.
      const tail = Bun.spawn(["sh", "-c", 'tail -c "+$1" -F "$2" & pid=$!; cat >/dev/null; kill "$pid"', "sh", String(offset + 1), spool], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "ignore",
      })
      const stop = () => {
        tail.stdin.end()
      }
      signal.addEventListener("abort", stop, { once: true })
      ready()
      const decoder = new TextDecoder()
      let pending = ""
      for await (const chunk of tail.stdout) {
        pending += decoder.decode(chunk, { stream: true })
        const parts = pending.split("\n")
        pending = parts.pop() ?? ""
        for (const line of parseLines(Buffer.from(parts.join("\n")))) onEvent(toEvent(input, line))
      }
      signal.removeEventListener("abort", stop)
      await tail.exited
    },
    async *catchUp(since) {
      for (const line of parseLines(await readSpool(spool))) if (line.at > since) yield toEvent(input, line)
    },
    async send() {
      return { message_id: "", permalink: "", created: null }
    },
  }
}

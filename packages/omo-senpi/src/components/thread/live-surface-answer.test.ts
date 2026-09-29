import { afterEach, describe, expect, test } from "bun:test"
import { once } from "node:events"
import { mkdtempSync, rmSync } from "node:fs"
import { createServer, type Socket } from "node:net"
import { join } from "node:path"

import type { GatewayEndpointKind, GatewayEndpointRef } from "./gateway/adapter"
import { createGatewayRelay } from "./gateway/relay"
import { createGatewayHarness, type GatewayHarness } from "./gateway/testing/harness"
import { createLiveThreadSurface } from "./live-surface"

type Frame = Record<string, unknown>

const SECRET = Buffer.alloc(32, 9)
const cleanups: Array<() => Promise<void>> = []
let harness: GatewayHarness | undefined

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  await harness?.dispose()
  harness = undefined
})

/**
 * An endpoint answering `extension_ui_response` as senpi does since senpi#2372, on both kinds: the
 * question is named by `uiRequestId` (short form: `id`), the reply carries the FRAME's `id`. A
 * terminal takes only question answers (`answers` object), a host also a dialog `value`; the
 * refusal codes are each kind's own.
 */
async function answeringEndpoint(socketPath: string, kind: GatewayEndpointKind, pending: Set<string>) {
  const frames: Frame[] = []
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.once("close", () => sockets.delete(socket))
    let authenticated = kind === "rpc_host"
    let buffer = Buffer.alloc(0)
    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      if (!authenticated) {
        if (buffer.length < SECRET.length) return
        if (!buffer.subarray(0, SECRET.length).equals(SECRET)) { socket.destroy(); return }
        authenticated = true
        buffer = buffer.subarray(SECRET.length)
      }
      const newline = buffer.indexOf(10)
      if (newline < 0) return
      const frame = JSON.parse(buffer.subarray(0, newline).toString("utf8")) as Frame
      buffer = buffer.subarray(newline + 1)
      frames.push(frame)
      const reply = (body: Frame) => socket.end(`${JSON.stringify({ id: frame.id, type: "response", command: frame.type, ...body })}\n`)
      if (frame.type !== "extension_ui_response") return reply({ success: true, data: {} })
      const request = typeof frame.uiRequestId === "string" ? frame.uiRequestId : frame.id
      const shaped = typeof frame.answers === "object" && frame.answers !== null && !Array.isArray(frame.answers)
      if (typeof request !== "string" || !pending.has(request)) return reply({ success: false, error: kind === "tui" ? "unknown_request" : "question_already_resolved" })
      if (kind === "tui" && !shaped) return reply({ success: false, error: "invalid_response" })
      pending.delete(request)
      return reply({ success: true })
    })
  })
  const listening = once(server, "listening")
  server.listen(socketPath)
  await listening
  cleanups.push(async () => {
    for (const socket of sockets) socket.destroy()
    const closed = once(server, "close")
    server.close()
    await closed
  })
  return { answers: () => frames.filter((frame) => frame.type === "extension_ui_response") }
}

async function questionRelayedFrom(kind: GatewayEndpointKind, pending: readonly string[]) {
  const h = (harness = createGatewayHarness())
  h.session("B")
  const dir = mkdtempSync(join("/tmp", "thr-answer-"))
  cleanups.push(async () => rmSync(dir, { recursive: true, force: true }))
  const socket = join(dir, kind === "tui" ? "t-0123456789abcdef.sock" : "i-host.sock")
  const endpoint = await answeringEndpoint(socket, kind, new Set(pending))
  const surface = createLiveThreadSurface({} as never, {
    env: { SENPI_RPC_SOCKET: join(dir, "legacy.sock") },
    statusAll: async () => [],
    registry: async () => [],
    readSecret: () => SECRET,
  })
  const ref: GatewayEndpointRef = { kind, socket, routing_id: kind === "rpc_host" ? "rpc-1" : null }
  const store = h.store()
  const relay = createGatewayRelay({ store, engine: h.engineFor(store), endpoints: surface.gateway, locate: async () => ref, now: () => h.clock.now })
  const bound = await relay.bind({ principal: "session:A", binding: { platform: "custom", account_id: "qa", chat_id: "c1", thread_id: "t1", session_durable_id: "B" } })
  if (bound.kind !== "ok") throw new Error(`bind failed: ${JSON.stringify(bound)}`)
  const bindingId = bound.binding.binding_id
  const asked = await relay.report({ principal: "session:B", session_durable_id: "B", binding_id: bindingId, event: "question", text: "ship it?", request_id: "ui-7" })
  if (asked.kind !== "ok" || typeof asked.reply_token !== "string") throw new Error(`report failed: ${JSON.stringify(asked)}`)
  const questionState = async () => {
    const outbox = await relay.outbox({ binding_id: bindingId })
    if (outbox.kind !== "ok") throw new Error(`outbox failed: ${JSON.stringify(outbox)}`)
    return outbox.rows.map((row) => row.question_state)
  }
  return { relay, bindingId, token: asked.reply_token, endpoint, questionState }
}

describe.each(["rpc_host", "tui"] as const)("thread_answer against a %s endpoint", (kind) => {
  test("#given a relayed question the session still waits on #when thread_answer answers it #then one extension_ui_response names the question in uiRequestId under its own frame id, the answer is ok, the claim stays, and a replay is already_answered", async () => {
    // given
    const { relay, bindingId, token, endpoint, questionState } = await questionRelayedFrom(kind, ["ui-7"])

    // when
    const first = await relay.answer({ binding_id: bindingId, reply_token: token, answer: "yes" })
    const replay = await relay.answer({ binding_id: bindingId, reply_token: token, answer: "yes" })

    // then
    expect(first).toMatchObject({ kind: "ok", binding_id: bindingId, session_durable_id: "B" })
    const [frame, ...more] = endpoint.answers()
    expect(more).toEqual([])
    expect(frame).toMatchObject({ type: "extension_ui_response", uiRequestId: "ui-7", value: "yes", answers: {}, comment: "yes" })
    expect(typeof frame?.id === "string" && frame.id !== "ui-7").toBe(true)
    expect(frame?.sessionId).toBe(kind === "rpc_host" ? "rpc-1" : undefined)
    expect(await questionState()).toEqual(["answered"])
    expect(replay).toMatchObject({ kind: "error", error: { code: "already_answered" } })
  })

  test("#given a relayed question the session no longer waits on #when thread_answer answers it #then the refusal is stale_token, not host_unavailable, and the question goes back to pending", async () => {
    // given
    const { relay, bindingId, token, endpoint, questionState } = await questionRelayedFrom(kind, [])

    // when
    const answered = await relay.answer({ binding_id: bindingId, reply_token: token, answer: "yes" })

    // then
    expect(answered).toMatchObject({ kind: "error", error: { code: "stale_token", details: { session: "B", reason: kind === "tui" ? "unknown_request" : "question_already_resolved" } } })
    expect(endpoint.answers()).toHaveLength(1)
    expect(await questionState()).toEqual(["pending"])
  })
})

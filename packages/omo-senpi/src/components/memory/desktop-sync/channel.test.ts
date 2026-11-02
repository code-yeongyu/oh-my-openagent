import { expect, jest, test } from "bun:test"
import { createServer, connect, Socket } from "node:net"
import { once } from "node:events"
import { attachDesktopSyncChannel } from "./channel"

async function pair() {
  const server = createServer()
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("missing test endpoint")
  const accepted = once(server, "connection")
  const engine = connect(address.port, "127.0.0.1")
  const [peer] = await accepted
  server.close()
  if (!(peer instanceof Socket)) throw new Error("missing peer")
  return { engine, peer }
}

test("missing private descriptor is unavailable", async () => {
  expect(await attachDesktopSyncChannel(undefined)).toEqual({
    kind: "unavailable",
    reason: process.platform === "win32" ? "platform_not_supported" : "private_channel_unavailable",
  })
})

test.skipIf(process.platform === "win32")("bootstraps once and sends requests synchronously on the private duplex", async () => {
  // given the real private wire protocol, not an HTTP or CLI account source
  const { engine, peer } = await pair()
  let pending = ""
  const packets: unknown[] = []
  peer.setEncoding("utf8")
  peer.on("data", (chunk) => {
    pending += chunk
    for (let end = pending.indexOf("\n"); end >= 0; end = pending.indexOf("\n")) {
      const packet = JSON.parse(pending.slice(0, end))
      pending = pending.slice(end + 1)
      packets.push(packet)
      peer.write(`${JSON.stringify({ id: packet.id, ok: true, value: packet.op === "bootstrap" ? { child: "test-child" } : { accepted: true } })}\n`)
    }
  })
  try {
    // when memory registration attaches and issues a typed operation
    const result = await attachDesktopSyncChannel(engine)
    if (result.kind !== "connected") throw new Error("channel unavailable")
    const response = await result.channel.request({ op: "operationBegin" })
    // then it uses its own bootstrap capability and no endpoint/token fallback
    expect(response).toEqual({ accepted: true })
    expect(packets).toEqual([
      { id: 1, op: "bootstrap" },
      { id: 2, op: "request", capability: "test-child", request: { op: "operationBegin" } },
    ])
    result.channel.close()
    expect(result.channel.signal.aborted).toBe(true)
  } finally {
    engine.destroy()
    peer.destroy()
  }
})

test.skipIf(process.platform === "win32")("rejects a malformed bootstrap without exposing its body", async () => {
  const { engine, peer } = await pair()
  peer.once("data", () => peer.write('{"id":1,"ok":true,"value":{"child":"test","secret":"canary"}}\n'))
  try {
    expect(await attachDesktopSyncChannel(engine)).toEqual({ kind: "unavailable", reason: "private_channel_unavailable" })
    expect(engine.destroyed).toBe(true)
  } finally { engine.destroy(); peer.destroy() }
})

test.skipIf(process.platform === "win32")("a bootstrap main never answers is unavailable at the 10 s bound, and a late reply is discarded", async () => {
  const { engine, peer } = await pair()
  // given: main reads the bootstrap frame and never answers it
  const bootstrapped = new Promise((resolve) => peer.once("data", resolve))
  jest.useFakeTimers()
  try {
    const attaching = attachDesktopSyncChannel(engine)
    await bootstrapped
    // when: the contract bound passes (one millisecond short of it changes nothing)
    jest.advanceTimersByTime(9_999)
    expect(engine.destroyed).toBe(false)
    jest.advanceTimersByTime(1)
    // then: unavailable, the stream is disposed, and a late reply reaches nothing
    expect(await attaching).toEqual({ kind: "unavailable", reason: "private_channel_unavailable" })
    expect(engine.destroyed).toBe(true)
    peer.write(`${JSON.stringify({ id: 1, ok: true, value: { child: "late-child" } })}\n`)
  } finally {
    jest.useRealTimers()
    engine.destroy()
    peer.destroy()
  }
})

async function connected(answer: (packet: { id: number; op: string }, peer: Socket) => void) {
  const { engine, peer } = await pair()
  let pending = ""
  peer.setEncoding("utf8")
  peer.on("data", (chunk) => {
    pending += chunk
    for (let end = pending.indexOf("\n"); end >= 0; end = pending.indexOf("\n")) {
      const packet = JSON.parse(pending.slice(0, end))
      pending = pending.slice(end + 1)
      if (packet.op === "bootstrap") peer.write(`${JSON.stringify({ id: packet.id, ok: true, value: { child: "test-child" } })}\n`)
      else answer(packet, peer)
    }
  })
  const result = await attachDesktopSyncChannel(engine)
  if (result.kind !== "connected") throw new Error("channel unavailable")
  return { channel: result.channel, engine, peer }
}

test.skipIf(process.platform === "win32")("round-trips binary values through the canonical byte tag", async () => {
  const bytes = new Uint8Array([0, 1, 254, 255])
  let seen: unknown
  const { channel, engine, peer } = await connected((packet, socket) => {
    seen = packet
    socket.write(`${JSON.stringify({ id: packet.id, ok: true, value: { echo: { $omoSyncBytes: "AAH-_w" } } })}\n`)
  })
  try {
    const value = await channel.request({ op: "service", handle: "h", data: { payload: bytes } })
    expect(seen).toMatchObject({ request: { data: { payload: { $omoSyncBytes: "AAH-_w" } } } })
    expect(value).toEqual({ echo: bytes })
  } finally { channel.close(); engine.destroy(); peer.destroy() }
})

test.skipIf(process.platform === "win32")("a peer disconnect aborts the lifetime and rejects every waiter with the fixed error", async () => {
  const { channel, engine, peer } = await connected(() => {})
  try {
    const first = channel.request({ op: "descriptor" })
    const second = channel.request({ op: "capability" })
    const aborted = new Promise((resolve) => channel.signal.addEventListener("abort", resolve, { once: true }))
    peer.destroy()
    await aborted
    for (const outcome of await Promise.allSettled([first, second])) {
      expect(outcome).toMatchObject({ status: "rejected", reason: { name: "DesktopSyncUnavailable" } })
    }
    await expect(channel.request({ op: "descriptor" })).rejects.toMatchObject({ name: "DesktopSyncUnavailable" })
  } finally { engine.destroy() }
})

test.skipIf(process.platform === "win32")("a non-canonical byte encoding closes the channel without echoing it", async () => {
  const { channel, engine, peer } = await connected((packet, socket) => {
    socket.write(`${JSON.stringify({ id: packet.id, ok: true, value: { $omoSyncBytes: "AAH-_w==" } })}\n`)
  })
  try {
    const outcome = await channel.request({ op: "descriptor" }).then(() => "resolved", (error: Error) => error.message)
    expect(outcome).not.toContain("AAH")
    expect(channel.signal.aborted).toBe(true)
  } finally { engine.destroy(); peer.destroy() }
})

test.skipIf(process.platform === "win32")("an event for another child or an unknown reply id retires the channel", async () => {
  for (const frame of [
    { event: "advanced", child: "other-child", handle: "h", head: 1 },
    { id: 999, ok: true, value: null },
  ]) {
    const { channel, engine, peer } = await connected(() => {})
    try {
      const waiter = channel.request({ op: "descriptor" })
      const aborted = new Promise((resolve) => channel.signal.addEventListener("abort", resolve, { once: true }))
      peer.write(`${JSON.stringify(frame)}\n`)
      await aborted
      await expect(waiter).rejects.toMatchObject({ name: "DesktopSyncUnavailable" })
    } finally { engine.destroy(); peer.destroy() }
  }
})

test.skipIf(process.platform === "win32")("delivers its own child's events and stops at 64 requests in flight", async () => {
  const { channel, engine, peer } = await connected(() => {})
  try {
    const events: unknown[] = []
    const delivered = new Promise((resolve) => channel.onEvent((event) => { events.push(event); resolve(undefined) }))
    peer.write(`${JSON.stringify({ event: "connected", child: "test-child", handle: "h", connected: true })}\n`)
    await delivered
    expect(events).toEqual([{ event: "connected", child: "test-child", handle: "h", connected: true }])
    const inFlight = Array.from({ length: 64 }, () => channel.request({ op: "descriptor" }).catch(() => undefined))
    await expect(channel.request({ op: "descriptor" })).rejects.toMatchObject({ name: "DesktopSyncUnavailable" })
    expect(channel.signal.aborted).toBe(false)
    channel.close()
    await Promise.all(inFlight)
  } finally { engine.destroy(); peer.destroy() }
})

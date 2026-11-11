import { describe, expect, test } from "bun:test"
import type { DeviceService, RemoteAttach } from "@oh-my-opencode/device-service-core"
import { createDeviceServiceSessions } from "./device-service"
import type { JsonObject } from "./ports"

type AttachEvent = Parameters<Parameters<RemoteAttach["onEvent"]>[0]>[0]
type AttachRecord = Extract<AttachEvent, { readonly kind: "records" }>["records"][number]

// An attach that already holds records: like remote-attach.ts, it replays them to each new listener before adding it.
function attachWithHistory(history: readonly AttachRecord[]) {
  const listeners = new Set<(event: AttachEvent) => void>()
  let end: (reason: string) => void = () => {}
  const detached = new Promise<string>((resolve) => { end = resolve })
  const attach = {
    onEvent: (listener: (event: AttachEvent) => void) => {
      listener({ kind: "records", attach_id: 1, records: [...history] })
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    detached,
  } as unknown as RemoteAttach
  const service = { attach: async () => attach, closed: new Promise(() => {}) } as unknown as DeviceService
  const write = (records: readonly AttachRecord[]) => { for (const listener of [...listeners]) listener({ kind: "records", attach_id: 1, records: [...records] }) }
  return { service, write, end }
}

describe("device-service adapter: following a session's records", () => {
  test("#given an attach with history #when b's session is watched #then only records written after go to the listener, none after stop, and ended settles with the attach's end", async () => {
    const remote = attachWithHistory([{ type: "old" }])
    const port = createDeviceServiceSessions({ version: "0.0.0-test", connect: async () => ({ conn: remote.service, owned: true }) })
    const seen: JsonObject[] = []
    const watched = await port.watch("b", "s1", (record) => seen.push(record))
    if (watched.kind !== "ok") throw new Error(`watch refused: ${watched.reason}`)
    remote.write([{ type: "new" }])
    watched.watch.stop()
    remote.write([{ type: "after-stop" }])
    remote.end("session_closed")
    expect([seen, await watched.watch.ended]).toEqual([[{ type: "new" }], "session_closed"])
  })
})

// A fake host for the #12777 duplicate: the engine writes each streamed delta to the attach stream, and, while the
// delegated engine connection is attached to a live connection, once more to that connection.
function delegatedHost() {
  // The connection the host's delegated engine connection is attached to; null once that connection closes.
  let delegatedOn: object | null = null
  const listeners = new Set<(event: AttachEvent) => void>()
  let end: (reason: string) => void = () => {}
  const detached = new Promise<string>((resolve) => { end = resolve })
  const attach = {
    onEvent: (listener: (event: AttachEvent) => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    detached,
  } as unknown as RemoteAttach
  const service = () => {
    const entry = { closed: false }
    const svc = {
      attach: async () => attach,
      endpointCommand: async (_device: string, rpc: unknown) => {
        // open_session attaches the host's delegated engine connection to the connection it rode on.
        if ((rpc as { readonly type?: unknown }).type === "open_session") delegatedOn = entry
        return {
          outcome: { type: "event", kind: "session.command_state", command_id: "c", state: "engine_applied" },
          response: { type: "response", command: "open_session", success: true, data: { sessionId: "s-new" } },
        }
      },
      close: () => { entry.closed = true; if (delegatedOn === entry) delegatedOn = null },
      closed: new Promise(() => {}),
    } as unknown as DeviceService
    return { service: svc, entry }
  }
  // The engine writes one delta: one copy reaches the attach stream, and a second reaches it through the delegated
  // channel when that channel is attached to the live connection the attach rides.
  const writeDelta = (record: AttachRecord, live: { closed: boolean }) => {
    const copies = delegatedOn === live && !live.closed ? 2 : 1
    for (let i = 0; i < copies; i++) for (const listener of [...listeners]) listener({ kind: "records", attach_id: 1, records: [record] })
  }
  return { service, writeDelta, end }
}

describe("device-service adapter: the #12777 duplicate rides the connection open_session used", () => {
  const opened = { kind: "ok", response: { type: "response", command: "open_session", success: true, data: { sessionId: "s-new" } } } as const

  test("#given open_session rides a per-call dialer #when the engine writes one delta #then the watch sees one copy", async () => {
    const host = delegatedHost()
    const live = host.service()
    const port = createDeviceServiceSessions({
      version: "0.0.0-test",
      connect: async () => ({ conn: live.service, owned: false }),
      dialEndpoint: async () => ({ conn: host.service().service, owned: true }),
    })
    expect(await port.endpointCommand("b", { type: "open_session" })).toEqual(opened)
    const seen: JsonObject[] = []
    const watched = await port.watch("b", "s1", (record) => seen.push(record))
    if (watched.kind !== "ok") throw new Error(`watch refused: ${watched.reason}`)
    host.writeDelta({ type: "delta" }, live.entry)
    expect(seen).toEqual([{ type: "delta" }])
  })

  test("#given open_session rides the shared connection with no per-call dialer #when the engine writes one delta #then the watch sees it twice, pinning that the CLI must use a per-call dialer", async () => {
    const host = delegatedHost()
    const live = host.service()
    const port = createDeviceServiceSessions({ version: "0.0.0-test", connect: async () => ({ conn: live.service, owned: false }) })
    expect(await port.endpointCommand("b", { type: "open_session" })).toEqual(opened)
    const seen: JsonObject[] = []
    const watched = await port.watch("b", "s1", (record) => seen.push(record))
    if (watched.kind !== "ok") throw new Error(`watch refused: ${watched.reason}`)
    host.writeDelta({ type: "delta" }, live.entry)
    expect(seen).toEqual([{ type: "delta" }, { type: "delta" }])
  })
})

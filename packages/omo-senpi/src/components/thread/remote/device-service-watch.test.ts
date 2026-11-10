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
    const port = createDeviceServiceSessions({ version: "0.0.0-test", connect: async () => remote.service })
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

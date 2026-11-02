import { describe, expect, test } from "bun:test"

import { connectDeviceService } from "../src/index.ts"
import type { LocalApiClient } from "../src/local-api/client.ts"
import type { LocalEvent } from "../src/local-api/protocol.ts"
import { defaultWorld } from "./local-api/conformance/world.ts"

// A local API connection whose attach events the test emits itself, through the SDK's connect seam.
function scriptedClient() {
  const listeners = new Set<(event: LocalEvent) => void>()
  let close!: () => void
  const closed = new Promise<void>(resolve => {
    close = resolve
  })
  const world = defaultWorld()
  const client: LocalApiClient = {
    welcome: { type: "welcome", v: 1, service_version: "1.4.0", owner: "service", server_proof: "p", server_nonce: "n", capabilities: [], state: world.status },
    request: (async (type: string) => {
      if (type === "session.attach") return { attach: "a1" }
      if (type === "session.detach") return {}
      throw new Error(`unexpected request ${type}`)
    }) as LocalApiClient["request"],
    onEvent: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    command: async () => "c",
    list: async () => ({ query_id: "q", revision: 0, rows: [], incomplete: [], devices: {} }),
    read: async () => ({ entries: [], next_before: null }),
    oversizedLines: () => 0,
    close,
    closed,
  }
  const emit = (event: LocalEvent) => {
    for (const listener of [...listeners]) listener(event)
  }
  const session = world.sessions[0]
  if (session === undefined) throw new Error("the default world has no session")
  const snapshotEvent = (attach_id: number): LocalEvent => ({ type: "event", kind: "session.snapshot", attach: "a1", ...session.snapshot, attach_id })
  const records = (attach_id: number, text: string): LocalEvent => ({ type: "event", kind: "session.records", attach: "a1", attach_id, records: [{ type: "message_update", text }] })
  return { client, emit, snapshotEvent, records }
}

async function attachOver(script: ReturnType<typeof scriptedClient>) {
  const service = await connectDeviceService({ version: "5.1.52", stateDir: "/unused", connect: async () => script.client })
  return service.attach("dev-peer-1", "s1")
}

describe("attach events", () => {
  test("a listener added later replays from the latest snapshot, not the whole attach", async () => {
    const script = scriptedClient()
    const attach = await attachOver(script)
    script.emit(script.snapshotEvent(1))
    script.emit(script.records(1, "old"))
    script.emit(script.snapshotEvent(2))
    script.emit(script.records(2, "new"))
    const seen: string[] = []
    attach.onEvent(event => seen.push(event.kind === "snapshot" ? `snapshot ${event.snapshot.attach_id}` : event.kind === "records" ? `records ${event.attach_id}` : event.kind))
    expect(seen).toEqual(["snapshot 2", "records 2"])
  })

  test("a listener that throws ends the attach with listener_failed and never reaches the connection", async () => {
    const script = scriptedClient()
    const attach = await attachOver(script)
    script.emit(script.snapshotEvent(1))
    const boom = new Error("renderer failed")
    attach.onEvent(event => {
      if (event.kind === "records") throw boom
    })
    expect(() => script.emit(script.records(1, "x"))).not.toThrow()
    expect(await attach.detached).toBe("listener_failed")
    expect(attach.failure()).toBe(boom)
  })
})

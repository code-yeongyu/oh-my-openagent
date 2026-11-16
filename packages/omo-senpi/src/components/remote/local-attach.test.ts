import { afterEach, describe, expect, test } from "bun:test"
import { withContractHost } from "../../../../senpi-task/src/runners/rpc-host/testing/contract-host"
import { defaultWorld, type World } from "../../../../device-service-core/test/local-api/conformance/world.ts"
import { reader } from "./attach.test-support"
import { createLocalAttach } from "./local-attach"
import { handleOf } from "./seams"
import { clientOn, closeClients, fakeClock, startOwner } from "./testing/fake-service"
import type { DeviceRow, FollowEvent, JsonObject, SendReceipt } from "./types"

// Rows of a session on THIS device (#13414 local watch): the device service cannot attach the caller to itself
// (peer_not_found), so follow, wait and attach reach its own sessions through the engine's operator endpoint, served
// here by senpi-task's contract host, with the same records and clientMessageId stamps.

afterEach(closeClients)

const SELF = "dev-self"
const KEY = "c2VsZi1zZXNzaW9uLWtleQ"
const THREAD = handleOf(SELF, KEY)

/** The default world with one session on this device, listed under its durable id (the contract host's session). */
const selfWorld = (): World => {
  const world = defaultWorld()
  const [revision] = world.listing.revisions.slice(-1)
  if (revision === undefined) throw new Error("the default world has a listing")
  const row = {
    device: SELF,
    session_id: KEY,
    durable_id: "dur-selected",
    title: "Self session",
    project: "omo",
    path: "/home/user/omo",
    state: "running" as const,
    updated_ms: 1_790_000_000_000,
    source: "live" as const,
    as_of: 1_790_000_100_000,
  }
  return {
    ...world,
    listing: {
      ...world.listing,
      revisions: [...world.listing.revisions.slice(0, -1), { ...revision, rows: [...revision.rows, row] }],
    },
  }
}

const DEVICE: DeviceRow = {
  id: SELF,
  name: "This Mac",
  kind: "cli",
  platform: "darwin",
  online: true,
  last_seen_ms: null,
  caps: { attach: true, machine: false, control: true },
}
const receipt = (id: string): SendReceipt => ({
  thread: THREAD,
  device: DEVICE,
  delivery_id: id,
  lane: "started",
  turn_id: "4",
})

const textDelta = (delta: string, id: string): JsonObject => ({
  type: "message_update",
  clientMessageId: id,
  message: {},
  assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta, partial: {} },
})

const drain = async (events: { readonly next: (what: string) => Promise<FollowEvent | "done"> }) => {
  const seen: FollowEvent[] = []
  for (let event = await events.next("an event"); event !== "done"; event = await events.next("an event"))
    seen.push(event)
  return seen
}

describe("a session on this device (local watch)", () => {
  test("#given a self session #when a waited follow runs from a send #then it streams through the operator endpoint and ends on its own turn", async () => {
    const owner = await startOwner(selfWorld())
    await withContractHost({}, async (host) => {
      const client = clientOn(owner.stateDir, fakeClock(), undefined, {
        localAttach: createLocalAttach({ socket: host.socket, keyRoot: host.root }),
      })
      const events = reader(client.sessions.follow(THREAD, { from: receipt("cm-9") }))
      await host.attached()
      host.push([
        { type: "agent_start", runId: "run-9" },
        { type: "turn_start", clientMessageId: "cm-9" },
        textDelta("local", "cm-9"),
        { type: "turn_end", clientMessageId: "cm-9" },
        { type: "agent_end", messages: [], willRetry: false, clientMessageId: "cm-9" },
        { type: "agent_settled" },
      ])
      expect(await drain(events)).toEqual([
        { kind: "waiting", state: "turn_running" },
        { kind: "text", delta: "local" },
        { kind: "end", outcome: { reason: "settled", text: "local", turn_id: "4" } },
      ])
    })
  })

  test("#given a self session #when attach opens it #then the snapshot comes from the operator endpoint and records stream", async () => {
    const owner = await startOwner(selfWorld())
    await withContractHost({}, async (host) => {
      const client = clientOn(owner.stateDir, fakeClock(), undefined, {
        localAttach: createLocalAttach({ socket: host.socket, keyRoot: host.root }),
      })
      const opened = await client.attach(THREAD)
      if (opened.kind !== "ok") throw new Error(`expected an attach, got ${JSON.stringify(opened)}`)
      expect(opened.value.snapshot.state).toMatchObject({ sessionId: "rpc-1", isStreaming: false })
      const events = reader(opened.value.events)
      host.push([{ type: "agent_start", runId: "run-9" }])
      expect(await events.next("the record")).toEqual({
        kind: "record",
        record: { type: "agent_start", runId: "run-9", sessionId: "rpc-1" },
      })
      await opened.value.detach()
      expect(host.frames.map(({ frame }) => frame["type"])).toContain("release_attachment")
    })
  })

  test("#given a client built without a local attach #when it follows a self session #then unsupported{local_attach}, not the relay's peer_not_found", async () => {
    const owner = await startOwner(selfWorld())
    const client = clientOn(owner.stateDir, fakeClock())
    const events = reader(client.sessions.follow(THREAD, { from: receipt("cm-9") }))
    expect(await drain(events)).toEqual([
      {
        kind: "failed",
        failure: expect.objectContaining({ code: "unsupported", details: { feature: "local_attach" } }),
      },
    ])
  })
})

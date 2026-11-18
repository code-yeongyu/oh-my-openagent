import { afterEach, describe, expect, test } from "bun:test"
import { withContractHost } from "../../../../senpi-task/src/runners/rpc-host/testing/contract-host"
import { defaultWorld, type World } from "../../../../device-service-core/test/local-api/conformance/world.ts"
import { reader } from "./attach.test-support"
import { nextActionFor } from "./codes"
import { createLocalAttach } from "./local-attach"
import { handleOf } from "./seams"
import { clientOn, closeClients, failureOf, fakeClock, startOwner } from "./testing/fake-service"
import type { AttachEvent, DeviceRow, JsonObject, SendReceipt } from "./types"

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

const drain = async <E>(events: { readonly next: (what: string) => Promise<E | "done"> }) => {
  const seen: E[] = []
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
      await host.snapshotted()
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

  test("#given a history larger than one unpaged answer #when attach reads it a page at a time #then each page comes from the engine's own paging and an unknown before is refused", async () => {
    const owner = await startOwner(selfWorld())
    const history = Array.from({ length: 6 }, (_, index) => ({ type: "message", id: `e${index + 1}` }))
    await withContractHost({ history, unpagedCap: 3 }, async (host) => {
      const client = clientOn(owner.stateDir, fakeClock(), undefined, {
        localAttach: createLocalAttach({ socket: host.socket, keyRoot: host.root }),
      })
      const opened = await client.attach(THREAD)
      if (opened.kind !== "ok") throw new Error(`expected an attach, got ${JSON.stringify(opened)}`)
      const page = async (request: { readonly before?: string; readonly tail: number }) => {
        const read = await opened.value.read(request)
        if (read.kind !== "ok") throw new Error(`expected a page, got ${JSON.stringify(read)}`)
        return { ids: read.value.entries.map((entry) => entry.entry_id), next_before: read.value.next_before }
      }
      expect(await page({ tail: 2 })).toEqual({ ids: ["e5", "e6"], next_before: "e5" })
      expect(await page({ before: "e5", tail: 2 })).toEqual({ ids: ["e3", "e4"], next_before: "e3" })
      expect(await page({ before: "e2", tail: 2 })).toEqual({ ids: ["e1"], next_before: null })
      // The caller's own page, refused by the engine (an unknown before: not_found; a page size below one:
      // invalid_argument), answers invalid_arguments, as the device service's refusal of a read's page does.
      for (const request of [{ before: "no-such-entry", tail: 2 }, { tail: 0 }])
        expect(failureOf(await opened.value.read(request))).toMatchObject({
          code: "invalid_arguments",
          next_action: nextActionFor("invalid_arguments"),
        })
      await opened.value.detach()
    })
  })

  // Ended by this side (detach), or by the endpoint closing first (the connection lost before release answered).
  test.each([
    ["detached", {}],
    ["closed by the endpoint", { afterMutation: "connection_lost" as const }],
  ])(
    "#given an attach %s #when read and command run #then both fail at once with the same failure, never waiting on the ended socket",
    async (_how, ended) => {
      const owner = await startOwner(selfWorld())
      await withContractHost({ history: [{ type: "message", id: "e1" }], ...ended }, async (host) => {
        const client = clientOn(owner.stateDir, fakeClock(), undefined, {
          localAttach: createLocalAttach({ socket: host.socket, keyRoot: host.root }),
        })
        const opened = await client.attach(THREAD)
        if (opened.kind !== "ok") throw new Error(`expected an attach, got ${JSON.stringify(opened)}`)
        await opened.value.detach()
        // Bounded by this test's own timeout: a read written to the ended socket would wait out the 30 s request timeout.
        const read = failureOf(await opened.value.read({ tail: 1 }))
        const command = failureOf(await opened.value.command({ type: "get_state" }))
        expect(read).toEqual(command)
        expect(read).toMatchObject({ code: "host_unavailable", details: { local_api_code: "closed" } })
      })
    },
  )

  // Ended by the engine: the session closed, or it left this engine (session_released). The session is gone, not the
  // host, so both answer as the engine would for a session it no longer has (unknown_session), still without waiting.
  test.each<[string, AttachEvent]>([
    ["session_closed", { kind: "session_closed" }],
    ["session_released", { kind: "channel_lost", reason: "peer_detached" }],
  ])(
    "#given an attach whose session the engine ended (%s) #when read and command run #then both fail at once with not_found{session}, not host_unavailable",
    async (type, end) => {
      const owner = await startOwner(selfWorld())
      await withContractHost({ history: [{ type: "message", id: "e1" }] }, async (host) => {
        const client = clientOn(owner.stateDir, fakeClock(), undefined, {
          localAttach: createLocalAttach({ socket: host.socket, keyRoot: host.root }),
        })
        const opened = await client.attach(THREAD)
        if (opened.kind !== "ok") throw new Error(`expected an attach, got ${JSON.stringify(opened)}`)
        const events = reader(opened.value.events)
        host.push([{ type }])
        expect(await drain(events)).toEqual([end])
        const read = failureOf(await opened.value.read({ tail: 1 }))
        const command = failureOf(await opened.value.command({ type: "get_state" }))
        expect(read).toEqual(command)
        expect(read).toMatchObject({
          code: "not_found",
          next_action: nextActionFor("not_found"),
          details: { kind: "session", local_api_code: "session_not_found" },
        })
      })
    },
  )

  test("#given a record the engine wrote before its snapshot answer #when attach opens #then the snapshot holds it and only records after the snapshot stream as new", async () => {
    const owner = await startOwner(selfWorld())
    await withContractHost({ beforeSnapshot: [{ type: "agent_start", runId: "covered" }] }, async (host) => {
      const client = clientOn(owner.stateDir, fakeClock(), undefined, {
        localAttach: createLocalAttach({ socket: host.socket, keyRoot: host.root }),
      })
      const opened = await client.attach(THREAD)
      if (opened.kind !== "ok") throw new Error(`expected an attach, got ${JSON.stringify(opened)}`)
      const events = reader(opened.value.events)
      host.push([{ type: "agent_start", runId: "after" }])
      expect(await events.next("the first record after the snapshot")).toEqual({
        kind: "record",
        record: { type: "agent_start", runId: "after", sessionId: "rpc-1" },
      })
      await opened.value.detach()
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

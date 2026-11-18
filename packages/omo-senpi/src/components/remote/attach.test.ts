import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { createConnection } from "node:net"
import { dirname } from "node:path"
import { PEER, SESSION_ID } from "../../../../device-service-core/test/local-api/conformance/world.ts"
import { pushDetached, pushFrame, pushRecords, pushSnapshot, reader, THREAD, worldWith } from "./attach.test-support"
import { pipeAddress, serveRemoteAttach } from "../../../../omo-native/remote-attach"
import type { RemoteClientDeps } from "./client"
import { nextActionFor } from "./codes"
import { DEADLINES } from "./deadlines"
import { canonicalizeThreadHandle, handleOf } from "./seams"
import { clientOn, closeClients, failureOf, fakeClock, startModeOwner, startOwner } from "./testing/fake-service"
import type { AttachHandle, JsonObject } from "./types"

// Rows of `attach` (#13414 U2): the live attach's snapshot, events, pending UI requests (#12750) and answers, over the
// device service's conformance owner and a fake clock.

afterEach(closeClients)

const SELECT = {
  type: "extension_ui_request",
  id: "ui-1",
  method: "select",
  title: "Allow bash?",
  options: ["Yes", "No"],
}
const SECRET = { type: "extension_ui_request", id: "ui-2", method: "input", title: "API key", secret: true }
const QUESTION = {
  type: "extension_ui_request",
  id: "q-1",
  method: "question",
  requestId: "q-1",
  toolCallId: "call-9",
  waitForAnswer: true,
  questions: [{ id: "a", header: "Pick", question: "Which branch?", options: [{ label: "main" }], multiSelect: false }],
  timeout: 60_000,
  askedAtMs: 1,
  deadlineAtMs: 60_001,
  remainingMs: 60_000,
}
const STATE: JsonObject = {
  sessionId: "engine-1",
  isStreaming: true,
  pendingDialogs: [SELECT, SECRET],
  pendingQuestions: [QUESTION],
}

const attached = async (
  state: JsonObject = STATE,
  records: readonly JsonObject[] = [],
  deps: Partial<RemoteClientDeps> = {},
) => {
  const owner = await startOwner(worldWith(state, records))
  const outcome = await clientOn(owner.stateDir, fakeClock(), undefined, deps).attach(THREAD)
  if (outcome.kind !== "ok") throw new Error(`expected an attach, got ${JSON.stringify(outcome)}`)
  return { owner, handle: outcome.value }
}

// The endpoint server a caller outside `omo remote`'s local-only graph injects (#13440): omo-native's own.
const SERVING: Partial<RemoteClientDeps> = { serveAttach: (attach, label) => serveRemoteAttach(attach, { label }) }

// Windows serves the endpoint on a named pipe derived from the path and secret. The `.sock` path is not a file.
const pipeIsOpen = (socketPath: string): Promise<boolean> => {
  const address = pipeAddress(socketPath, readFileSync(`${socketPath}.secret`))
  return new Promise((resolve) => {
    const socket = createConnection(address)
    socket.once("connect", () => {
      socket.destroy()
      resolve(true)
    })
    socket.once("error", () => resolve(false))
  })
}

const ids = (handle: AttachHandle): string[] => handle.pending().map((request) => request.request_id)

describe("attach rows: open", () => {
  test("#given a live session with dialogs #when attach opens #then it answers the snapshot, the answerable pending requests and the records from then on", async () => {
    const { handle } = await attached(STATE, [{ type: "message_update", text: "hi" }])
    expect(handle.snapshot.state).toMatchObject({ sessionId: "engine-1" })
    expect(handle.pending()).toEqual([
      { request_id: "ui-1", kind: "select", title: "Allow bash?", options: ["Yes", "No"] },
      {
        request_id: "q-1",
        kind: "question",
        title: "Pick",
        message: "Which branch?",
        options: ["main"],
        tool_call_id: "call-9",
        deadline_at_ms: 60_001,
      },
    ])
    expect(await reader(handle.events).next("the first record")).toEqual({
      kind: "record",
      record: { type: "message_update", text: "hi" },
    })
    await handle.detach()
  })

  test("#given addresses that name no session #when attach opens #then a name is invalid_arguments and an unknown session not_found", async () => {
    const owner = await startOwner(worldWith(STATE))
    const client = clientOn(owner.stateDir, fakeClock())
    const name = canonicalizeThreadHandle("my-thread", {})
    if (name.kind !== "ok") throw new Error("a name parses")
    expect(failureOf(await client.attach(name.value.handle)).code).toBe("invalid_arguments")
    // A well-formed listing key the device does not hold: a service with #1350 refuses an id that is no key at all as
    // invalid_request before any lookup.
    expect(failureOf(await client.attach(handleOf(PEER, "bm90LWhlbGQta2V5LTAwMQ")))).toMatchObject({
      code: "not_found",
      details: { kind: "session" },
    })
  })

  test("#given a mistyped session id and an unknown durable id #when attach opens #then each is not_found, never unsupported", async () => {
    // The device answers session.locate and holds no session by either id.
    const owner = await startOwner({ ...worldWith(STATE), located: { [PEER]: {} } })
    const client = clientOn(owner.stateDir, fakeClock())
    // The service refuses an id that is no listing key as invalid_request (#1350); the attach locates it once instead.
    for (const session of ["no such session", "0195f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f"])
      expect(failureOf(await client.attach(handleOf(PEER, session)))).toMatchObject({
        code: "not_found",
        details: { kind: "session" },
      })
  })

  test("#given a host that never sends the snapshot #when attach waits #then it answers timeout at attachOpen", async () => {
    const clock = fakeClock()
    const { owner, withheld } = await startModeOwner("attach-stall", worldWith(STATE))
    const opening = clientOn(owner.stateDir, clock).attach(THREAD)
    await withheld("snapshot")
    clock.advance(DEADLINES.attachOpen)
    expect(failureOf(await opening)).toMatchObject({ code: "timeout", details: { deadline_ms: DEADLINES.attachOpen } })
  })

  test("#given an engine whose snapshot carries no pendingDialogs #when attach opens #then approvals_unobservable names the device", async () => {
    const { handle } = await attached({ sessionId: "engine-1", isStreaming: false })
    expect(await reader(handle.events).next("approvals_unobservable")).toEqual({
      kind: "approvals_unobservable",
      device: PEER,
    })
    await handle.detach()
  })
})

describe("attach rows: pending UI requests (#12750)", () => {
  test("#given a shown dialog #when a re-attach snapshot no longer holds it #then frame_settled cancelled, a new one is a frame, and pending is recomputed", async () => {
    const { owner, handle } = await attached()
    const events = reader(handle.events)
    const ui3 = { type: "extension_ui_request", id: "ui-3", method: "confirm", title: "Push?", message: "to main" }
    pushSnapshot(owner, {
      sessionId: "engine-1",
      isStreaming: true,
      pendingDialogs: [ui3, SECRET],
      pendingQuestions: [QUESTION],
    })
    expect(await events.next("the settled-away dialog")).toEqual({
      kind: "frame_settled",
      request_id: "ui-1",
      how: "cancelled",
    })
    expect(await events.next("the new dialog")).toEqual({
      kind: "frame",
      request: { request_id: "ui-3", kind: "confirm", title: "Push?", message: "to main" },
    })
    expect(ids(handle)).toEqual(["ui-3", "q-1"])
    expect(handle.snapshot.attach_id).toBe(2)
    await handle.detach()
  })

  test("#given the session's dialog mirror #when a dialog is raised and settled #then frame and frame_settled; a raiser-only one is never a frame or pending, only a record", async () => {
    const { owner, handle } = await attached({ sessionId: "engine-1", isStreaming: true, pendingDialogs: [] })
    const events = reader(handle.events)
    const ui5 = { type: "extension_ui_request", id: "ui-5", method: "input", title: "Name" }
    const secret = {
      type: "ui_request_pending",
      uiRequestId: "ui-4",
      method: "input",
      request: { ...SECRET, id: "ui-4" },
    }
    const secretSettled = { type: "ui_request_settled", uiRequestId: "ui-4", disposition: "answered" }
    pushRecords(owner, [
      secret,
      { type: "ui_request_pending", uiRequestId: "ui-5", method: "input", request: ui5 },
      { type: "ui_request_settled", uiRequestId: "ui-5", disposition: "answered" },
      secretSettled,
    ])
    // The session still waits on the raiser-only one, so its mirror goes on as a record for follow and wait.
    expect(await events.next("the raiser-only mirror record")).toEqual({ kind: "record", record: secret })
    expect(await events.next("the raised dialog")).toEqual({
      kind: "frame",
      request: { request_id: "ui-5", kind: "input", title: "Name" },
    })
    expect(await events.next("its settle")).toEqual({ kind: "frame_settled", request_id: "ui-5", how: "answered" })
    expect(await events.next("the raiser-only settle record")).toEqual({ kind: "record", record: secretSettled })
    expect(handle.pending()).toEqual([])
    await handle.detach()
  })

  test("#given a settle for a request this attach never showed #when it arrives #then no frame_settled, the record goes on as it is", async () => {
    const { owner, handle } = await attached({ sessionId: "engine-1", isStreaming: true, pendingDialogs: [] })
    const events = reader(handle.events)
    const settle = { type: "ui_request_settled", uiRequestId: "ui-77", disposition: "answered" }
    pushRecords(owner, [settle, { type: "agent_start" }])
    expect(await events.next("the settle record")).toEqual({ kind: "record", record: settle })
    expect(await events.next("the next record")).toEqual({ kind: "record", record: { type: "agent_start" } })
    await handle.detach()
  })

  test("#given a dialog raised on this connection's delegated channel #when it arrives #then it is a frame once, secret included, and pending holds it", async () => {
    const { owner, handle } = await attached({ sessionId: "engine-1", isStreaming: true, pendingDialogs: [] })
    const events = reader(handle.events)
    pushFrame(owner, { ...SECRET, id: "ui-6" })
    pushRecords(owner, [{ type: "agent_start" }])
    expect(await events.next("the delegated dialog")).toEqual({
      kind: "frame",
      request: { request_id: "ui-6", kind: "input", title: "API key", secret: true },
    })
    expect(await events.next("the next record")).toEqual({ kind: "record", record: { type: "agent_start" } })
    expect(ids(handle)).toEqual(["ui-6"])
    await handle.detach()
  })

  test("#given a secret dialog raised on this connection's own channel #when it is answered #then one frame_settled and pending is empty", async () => {
    const { owner, handle } = await attached({ sessionId: "engine-1", isStreaming: true, pendingDialogs: [] })
    const events = reader(handle.events)
    const mirror = {
      type: "ui_request_pending",
      uiRequestId: "ui-6",
      method: "input",
      request: { ...SECRET, id: "ui-6" },
    }
    pushFrame(owner, { ...SECRET, id: "ui-6" })
    pushRecords(owner, [mirror, { type: "ui_request_settled", uiRequestId: "ui-6", disposition: "answered" }])
    expect(await events.next("the raiser's frame")).toMatchObject({ kind: "frame", request: { request_id: "ui-6" } })
    expect(await events.next("the mirror record")).toEqual({ kind: "record", record: mirror })
    expect(await events.next("the settle")).toEqual({ kind: "frame_settled", request_id: "ui-6", how: "answered" })
    expect(handle.pending()).toEqual([])
    await handle.detach()
  })

  test("#given a pending dialog #when answer runs #then extension_ui_response names it by id and uiRequestId", async () => {
    const { owner, handle } = await attached()
    expect(await handle.answer("ui-1", { value: "Yes" })).toEqual({ kind: "ok", value: { answered: true } })
    expect(owner.state.commands).toContainEqual({
      type: "extension_ui_response",
      id: "ui-1",
      uiRequestId: "ui-1",
      value: "Yes",
    })
    await handle.detach()
  })
})

describe("attach rows: events buffer", () => {
  // The events kept for a reader that has not read yet: 1024. Past it the oldest go and the reader learns so first.
  const KEPT = 1024

  test("#given an attach nobody reads #when more events than it keeps arrive #then the first read is channel_lost events_overflow, then the newest", async () => {
    const { owner, handle } = await attached({ sessionId: "engine-1", isStreaming: true, pendingDialogs: [] })
    const sent = KEPT + 476
    for (let from = 0; from < sent; from += 100)
      pushRecords(
        owner,
        Array.from({ length: Math.min(100, sent - from) }, (_, i) => ({ type: "message_update", n: from + i })),
      )
    // A request on the same connection is answered after every record pushed before it.
    await handle.read({ tail: 1 })
    await handle.detach()
    const events = reader(handle.events)
    expect(await events.next("the overflow notice")).toEqual({ kind: "channel_lost", reason: "events_overflow" })
    const kept: unknown[] = []
    for (let event = await events.next("a kept record"); event !== "done"; event = await events.next("a kept record"))
      kept.push(event.kind === "record" ? event.record["n"] : event)
    expect(kept).toEqual(Array.from({ length: KEPT }, (_, i) => sent - KEPT + i))
  })
})

describe("attach rows: read", () => {
  test("#given an attach over the device service #when a read asks for a page the service refuses #then invalid_arguments, as the same read of a session on this device answers", async () => {
    const { handle } = await attached({ sessionId: "engine-1", isStreaming: false, pendingDialogs: [] })
    // The service refuses a page size outside 1-200 invalid_request; session.read carries nothing else of the caller's.
    for (const tail of [0, 201])
      expect(failureOf(await handle.read({ tail }))).toMatchObject({
        code: "invalid_arguments",
        next_action: nextActionFor("invalid_arguments"),
        details: { local_api_code: "invalid_request" },
      })
    await handle.detach()
  })
})

describe("attach rows: events reader", () => {
  test("#given an attach's events being read #when a second reader iterates them at the same time #then it fails at its start and the first keeps reading", async () => {
    const { owner, handle } = await attached({ sessionId: "engine-1", isStreaming: true, pendingDialogs: [] })
    const first = reader(handle.events)
    const second = handle.events[Symbol.asyncIterator]()
    const firstRead = first.next("the first reader's record")
    await expect(second.next()).rejects.toThrow("one reader")
    pushRecords(owner, [{ type: "agent_start" }])
    expect(await firstRead).toEqual({ kind: "record", record: { type: "agent_start" } })
    await handle.detach()
  })
})

describe("attach rows: end", () => {
  test("#given an attach #when the host closes the session #then session_closed and the events end", async () => {
    const { owner, handle } = await attached({ sessionId: "engine-1", isStreaming: false, pendingDialogs: [] })
    const events = reader(handle.events)
    pushDetached(owner, "session_closed")
    expect(await events.next("session_closed")).toEqual({ kind: "session_closed" })
    expect(await events.next("the end")).toBe("done")
  })

  test("#given an attach #when serveEndpoint runs and the attach detaches #then the endpoint names the session and goes away", async () => {
    const { handle } = await attached(STATE, [], SERVING)
    const served = await handle.serveEndpoint()
    if (served.kind !== "ok") throw new Error(`expected an endpoint, got ${JSON.stringify(served)}`)
    if (process.platform === "win32") {
      expect(existsSync(`${served.value.socketPath}.secret`)).toBe(true)
      expect(await pipeIsOpen(served.value.socketPath)).toBe(true)
    } else {
      expect(existsSync(served.value.socketPath)).toBe(true)
    }
    expect(served.value.sessionRef).toBe(SESSION_ID)
    await handle.detach()
    expect(
      existsSync(process.platform === "win32" ? `${served.value.socketPath}.secret` : served.value.socketPath),
    ).toBe(false)
  })

  test("#given a client built without serveAttach #when serveEndpoint runs #then it answers unsupported{serve_endpoint} as data", async () => {
    const { handle } = await attached()
    expect(failureOf(await handle.serveEndpoint())).toMatchObject({
      code: "unsupported",
      details: { feature: "serve_endpoint" },
    })
    await handle.detach()
  })

  test("#given an attach that already ended #when serveEndpoint runs #then the endpoint it made is closed at once and it answers session_ended", async () => {
    const closed: string[] = []
    const { owner, handle } = await attached(STATE, [], {
      serveAttach: async () => ({
        socketPath: "/served.sock",
        sessionRef: "s",
        close: async () => void closed.push("/served.sock"),
      }),
    })
    const events = reader(handle.events)
    pushDetached(owner, "session_closed")
    for (let event = await events.next("the end"); event !== "done"; event = await events.next("the end"));
    expect(failureOf(await handle.serveEndpoint())).toMatchObject({ code: "session_ended" })
    expect(closed).toEqual(["/served.sock"])
  })

  test("#given a served endpoint #when the far side ends the attach #then the endpoint's private directory and its secret are gone once the events end", async () => {
    const { owner, handle } = await attached(STATE, [], SERVING)
    const served = await handle.serveEndpoint()
    if (served.kind !== "ok") throw new Error(`expected an endpoint, got ${JSON.stringify(served)}`)
    const directory = dirname(served.value.socketPath)
    expect(existsSync(`${served.value.socketPath}.secret`)).toBe(true)
    const events = reader(handle.events)
    pushDetached(owner, "session_closed")
    let event = await events.next("session_closed")
    while (event !== "done" && event.kind !== "session_closed") event = await events.next("session_closed")
    expect(event).toEqual({ kind: "session_closed" })
    expect(await events.next("the end")).toBe("done")
    expect(existsSync(directory)).toBe(false)
  })
})

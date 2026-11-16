import { afterEach, describe, expect, test } from "bun:test"
import { PEER } from "../../../../device-service-core/test/local-api/conformance/world.ts"
import { pushDetached, pushFrame, pushRecords, pushSnapshot, reader, THREAD, worldWith } from "./attach.test-support"
import { DEADLINES } from "./deadlines"
import { sessionStatusOf } from "./follow"
import { handleOf } from "./seams"
import { clientOn, closeClients, fakeClock, startModeOwner, startOwner } from "./testing/fake-service"
import type { RemoteClient } from "./client"
import type { DeviceRow, FollowEvent, JsonObject, PendingRequest, RemoteSender, SendReceipt } from "./types"

// Rows of sessions.follow and sessions.wait (#13414 U2): both run on the attach's events, never a poll of read, over the
// device service's conformance owner and a fake clock.

afterEach(closeClients)

const IDLE: JsonObject = { sessionId: "engine-1", isStreaming: false, pendingDialogs: [] }
const RUNNING: JsonObject = { sessionId: "engine-1", isStreaming: true, pendingDialogs: [] }
const textDelta = (delta: string): JsonObject => ({
  type: "message_update",
  message: {},
  assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta, partial: {} },
})
// A secret input raised on another connection: only its raiser may answer it, so it is never shown here as a frame.
const SECRET_PENDING: JsonObject = {
  type: "ui_request_pending",
  uiRequestId: "ui-9",
  method: "input",
  request: { type: "extension_ui_request", id: "ui-9", method: "input", title: "API key", secret: true },
}
const DIALOG = {
  type: "extension_ui_request",
  id: "ui-1",
  method: "confirm",
  title: "Run rm?",
  message: "rm -rf build",
}

/** senpi's run lease: the `session-lifecycle` transcript entry its lifecycle ledger appends at each change. */
const lease = (state: string, seq: number): JsonObject => ({
  type: "custom",
  id: `lease-${seq}`,
  parentId: "e-3",
  customType: "session-lifecycle",
  data: { sessionId: "engine-1", state, seq, runId: "run-1", role: "root", since: "2026-11-16T07:13:22Z" },
})

const on = async (state: JsonObject, sender?: RemoteSender, extra?: Parameters<typeof worldWith>[2]) => {
  const owner = await startOwner(worldWith(state, [], extra))
  const clock = fakeClock()
  return { owner, clock, client: clientOn(owner.stateDir, clock, sender) }
}

/** Follows the thread and reads until the first `waiting`, which the stream sends once its attach is open. */
const following = async (client: RemoteClient) => {
  const events = reader(client.sessions.follow(THREAD))
  const first = await events.next("the opening state")
  return { events, first }
}

const drain = async (events: { readonly next: (what: string) => Promise<FollowEvent | "done"> }) => {
  const seen: FollowEvent[] = []
  for (let event = await events.next("an event"); event !== "done"; event = await events.next("an event"))
    seen.push(event)
  return seen
}

describe("sessions.follow rows", () => {
  test("#given an idle session #when a turn runs #then its state, text deltas, tool events and a settled end with the text", async () => {
    const { owner, client } = await on(IDLE)
    const { events, first } = await following(client)
    expect(first).toEqual({ kind: "waiting", state: "idle" })
    pushRecords(owner, [
      { type: "agent_start", runId: "run-7" },
      textDelta("Hel"),
      { type: "tool_execution_start", toolCallId: "c1", toolName: "bash", args: { command: "ls" } },
      { type: "tool_execution_end", toolCallId: "c1", toolName: "bash", result: "a b", isError: false },
      textDelta("lo"),
      { type: "agent_end", messages: [], willRetry: false },
      { type: "agent_settled" },
    ])
    expect(await drain(events)).toEqual([
      { kind: "waiting", state: "turn_running" },
      { kind: "text", delta: "Hel" },
      { kind: "tool_start", tool_call_id: "c1", name: "bash", args: { command: "ls" } },
      { kind: "tool_end", tool_call_id: "c1", name: "bash", result: "a b", is_error: false },
      { kind: "text", delta: "lo" },
      { kind: "end", outcome: { reason: "settled", text: "Hello", turn_id: "run-7" } },
    ])
  })

  test("#given a running turn #when it settles while compacting and the session then goes idle #then the end is settled, not a hang", async () => {
    const { owner, client } = await on(RUNNING)
    const { events, first } = await following(client)
    expect(first).toEqual({ kind: "waiting", state: "turn_running" })
    pushRecords(owner, [
      { type: "session_status", status: "compacting" },
      { type: "agent_settled" },
      { type: "session_status", status: "idle" },
    ])
    expect(await drain(events)).toEqual([
      { kind: "waiting", state: "compacting" },
      { kind: "end", outcome: { reason: "settled" } },
    ])
  })

  test("#given a running turn #when it is aborted #then the end is interrupted", async () => {
    const { owner, client } = await on(RUNNING)
    const { events, first } = await following(client)
    expect(first).toEqual({ kind: "waiting", state: "turn_running" })
    pushRecords(owner, [
      { type: "agent_end", messages: [], aborted: true, willRetry: false },
      { type: "agent_settled" },
    ])
    expect(await drain(events)).toEqual([{ kind: "end", outcome: { reason: "interrupted" } }])
  })

  test("#given a person follower #when the turn asks for approval #then the frame and awaiting_approval with the request", async () => {
    const { owner, client } = await on(RUNNING)
    const { events } = await following(client)
    pushRecords(owner, [{ type: "ui_request_pending", uiRequestId: "ui-1", method: "confirm", request: DIALOG }])
    const request: PendingRequest = { request_id: "ui-1", kind: "confirm", title: "Run rm?", message: "rm -rf build" }
    expect(await events.next("the frame")).toEqual({ kind: "frame", request })
    expect(await events.next("the waiting state")).toEqual({
      kind: "waiting",
      state: "awaiting_approval",
      pending: [request],
    })
  })

  test("#given a session follower #when the turn asks for approval #then no frame, and the pending requests redacted with where to answer", async () => {
    const { owner, client } = await on(RUNNING, { kind: "session", id: "dur-1" })
    const { events } = await following(client)
    pushRecords(owner, [{ type: "ui_request_pending", uiRequestId: "ui-1", method: "confirm", request: DIALOG }])
    expect(await events.next("the waiting state")).toEqual({
      kind: "waiting",
      state: "awaiting_approval",
      pending_redacted: { count: 1, kinds: ["confirm"] },
      next_action: expect.stringContaining("attach"),
    })
  })

  test("#given a person follower #when the approval is answered #then the next state is turn_running again", async () => {
    const { owner, client } = await on(RUNNING)
    const { events } = await following(client)
    pushRecords(owner, [{ type: "ui_request_pending", uiRequestId: "ui-1", method: "confirm", request: DIALOG }])
    expect(await events.next("the frame")).toMatchObject({ kind: "frame" })
    expect(await events.next("awaiting_approval")).toMatchObject({ kind: "waiting", state: "awaiting_approval" })
    pushRecords(owner, [{ type: "ui_request_settled", uiRequestId: "ui-1", disposition: "answered" }])
    expect(await events.next("the state after the answer")).toEqual({ kind: "waiting", state: "turn_running" })
  })

  test("#given a person follower #when a secret input is raised on its own channel and its mirror follows #then it stays answerable, listed in pending", async () => {
    const { owner, client } = await on(RUNNING)
    const { events } = await following(client)
    const request = { type: "extension_ui_request", id: "ui-6", method: "input", title: "API key", secret: true }
    pushFrame(owner, request)
    expect(await events.next("the frame")).toMatchObject({ kind: "frame" })
    expect(await events.next("awaiting_approval")).toMatchObject({ kind: "waiting", state: "awaiting_approval" })
    // The mirror changes nothing (no event); a second, ordinary dialog shows what this follower may answer now.
    pushRecords(owner, [
      { type: "ui_request_pending", uiRequestId: "ui-6", method: "input", request },
      { type: "ui_request_pending", uiRequestId: "ui-1", method: "confirm", request: DIALOG },
    ])
    expect(await events.next("the second frame")).toMatchObject({ kind: "frame", request: { request_id: "ui-1" } })
    expect(await events.next("the state with both")).toEqual({
      kind: "waiting",
      state: "awaiting_approval",
      pending: [
        { request_id: "ui-6", kind: "input", title: "API key", secret: true },
        { request_id: "ui-1", kind: "confirm", title: "Run rm?", message: "rm -rf build" },
      ],
    })
  })

  test("#given a person follower #when the turn waits on a secret input raised on another connection #then awaiting_approval, redacted, with no frame", async () => {
    const { owner, client } = await on(RUNNING)
    const { events } = await following(client)
    pushRecords(owner, [SECRET_PENDING])
    expect(await events.next("the waiting state")).toEqual({
      kind: "waiting",
      state: "awaiting_approval",
      pending_redacted: { count: 1, kinds: ["input"] },
      next_action: expect.any(String),
    })
  })

  test("#given a running turn #when a re-attach snapshot's run lease shows it done #then the turn that settled in the gap ends settled", async () => {
    const { owner, client } = await on(RUNNING)
    const { events } = await following(client)
    pushSnapshot(owner, IDLE, 2, [lease("running", 4), lease("done", 5)])
    expect(await drain(events)).toEqual([{ kind: "end", outcome: { reason: "settled" } }])
  })

  test("#given a follow #when the session closes #then the end is session_closed", async () => {
    const { owner, client } = await on(RUNNING)
    const { events } = await following(client)
    pushDetached(owner, "session_closed")
    expect(await drain(events)).toEqual([{ kind: "end", outcome: { reason: "session_closed" } }])
  })

  test("#given a turn that never ends #when followTotal passes #then failed timeout", async () => {
    const { client, clock } = await on(RUNNING)
    const { events } = await following(client)
    clock.advance(DEADLINES.followTotal)
    expect(await drain(events)).toEqual([
      {
        kind: "failed",
        failure: expect.objectContaining({ code: "timeout", details: { deadline_ms: DEADLINES.followTotal } }),
      },
    ])
  })

  test("#given a session that does not exist #when follow opens #then failed not_found", async () => {
    const { client } = await on(IDLE)
    // A well-formed listing key the device does not hold: a service with #1350 refuses an id that is no key at all as
    // invalid_request before any lookup.
    const events = reader(client.sessions.follow(handleOf(PEER, "bm90LWhlbGQta2V5LTAwMQ")))
    expect(await drain(events)).toEqual([
      {
        kind: "failed",
        failure: expect.objectContaining({ code: "not_found", details: expect.objectContaining({ kind: "session" }) }),
      },
    ])
  })
})

// One run as the engine streams it: its lease running, its start, its text, its lease done, its settle.
const turnRecords = (runId: string, text: string, seq: number): JsonObject[] => [
  { type: "session_lifecycle", lifecycle: { state: "running", seq, runId } },
  { type: "agent_start", runId },
  textDelta(text),
  { type: "session_lifecycle", lifecycle: { state: "done", seq: seq + 1, runId } },
  { type: "agent_settled" },
]

describe("sessions.follow rows: anchored at its open (#13753, the U6 waited send)", () => {
  // senpi's lifecycle seq also advances with no new run, and an idle lease keeps the previous run's id (rpc.md "Session
  // lifecycle"): a newer lease naming the snapshot's own idle run is not a new run (review M3).
  test.each([
    ["waiting_background", "the run's background work finishing"],
    ["done", "a durable lifecycle write while idle"],
  ])(
    "#given a snapshot lease %s for the last run #when %s advances the seq before the baseline #then that run stays history and the end is the next turn's",
    async (state) => {
      const atOpen = { ...IDLE, lifecycle: { state, seq: 5, runId: "run-1" } }
      const { owner, client } = await on(atOpen, undefined, {
        reply: { lifecycle: { state: "done", seq: 6, runId: "run-1" } },
      })
      const { events } = await following(client)
      pushRecords(owner, [...turnRecords("run-1", "pong", 3), ...turnRecords("run-2", "ping", 7)])
      expect(await drain(events)).toEqual([
        { kind: "waiting", state: "turn_running" },
        { kind: "text", delta: "ping" },
        { kind: "end", outcome: { reason: "settled", text: "ping", turn_id: "run-2" } },
      ])
    },
  )

  // The baseline read itself ends a run the snapshot showed running (the tracker sees its lease go done), so follow ends
  // at once, never hangs, whatever the anchor decides about that run's records.
  test("#given a run running in the snapshot that ends before the baseline answers #when its remainder streams #then follow ends, not a hang", async () => {
    const atOpen = { ...IDLE, lifecycle: { state: "running", seq: 5, runId: "run-1" } }
    const { owner, client } = await on(atOpen, undefined, {
      reply: { lifecycle: { state: "done", seq: 6, runId: "run-1" } },
    })
    const { events } = await following(client)
    pushRecords(owner, [
      textDelta("late"),
      { type: "session_lifecycle", lifecycle: { state: "done", seq: 6, runId: "run-1" } },
      { type: "agent_settled" },
    ])
    expect(await drain(events)).toEqual([{ kind: "end", outcome: { reason: "settled" } }])
  })

  test("#given a snapshot that already holds the last turn's lease #when that turn is replayed and a send starts the next #then the end is the next turn's", async () => {
    const atOpen = { ...IDLE, lifecycle: { state: "done", seq: 5, runId: "run-1" } }
    const { owner, client } = await on(atOpen, undefined, {
      reply: { lifecycle: { state: "done", seq: 5, runId: "run-1" } },
    })
    const { events } = await following(client)
    pushRecords(owner, [...turnRecords("run-1", "pong", 4), ...turnRecords("run-2", "ping", 6)])
    expect(await drain(events)).toEqual([
      { kind: "waiting", state: "turn_running" },
      { kind: "text", delta: "ping" },
      { kind: "end", outcome: { reason: "settled", text: "ping", turn_id: "run-2" } },
    ])
  })

  test("#given a run that starts and ends before follow's first get_state answers #when follow reads it #then its end, not a hang (review Probe A)", async () => {
    // At the open the snapshot holds run-0's lease (seq 3); the baseline already shows run-1 ended (seq 5).
    const atOpen = { ...IDLE, lifecycle: { state: "done", seq: 3, runId: "run-0" } }
    const { owner, client } = await on(atOpen, undefined, {
      reply: { lifecycle: { state: "done", seq: 5, runId: "run-1" } },
    })
    const { events } = await following(client)
    pushRecords(owner, turnRecords("run-1", "failed fast", 4))
    expect(await drain(events)).toEqual([
      { kind: "waiting", state: "turn_running" },
      { kind: "text", delta: "failed fast" },
      { kind: "end", outcome: { reason: "settled", text: "failed fast", turn_id: "run-1" } },
    ])
  })

  test("#given a send whose turn already runs when follow's first get_state answers #when the turn ends #then the end is that turn's, not a hang", async () => {
    // U6 opens follow and sends at once: the baseline read can land after the new run started.
    const { owner, client } = await on(IDLE, undefined, {
      reply: { lifecycle: { state: "running", seq: 6, runId: "run-2" } },
    })
    const { events } = await following(client)
    // Its start (lease running, agent_start) came before the attach's snapshot; only the rest of it streams.
    pushRecords(owner, turnRecords("run-2", "ping", 6).slice(2))
    expect(await drain(events)).toEqual([
      { kind: "waiting", state: "turn_running" },
      { kind: "text", delta: "ping" },
      { kind: "end", outcome: { reason: "settled", text: "ping" } },
    ])
  })

  test("#given turns the attach replays #when follow opens and then a send starts the next turn #then the end is that turn's, twice in a row", async () => {
    // get_state at each open answers the session as it is then: its last run done.
    const reply: { lifecycle: JsonObject } = { lifecycle: { state: "done", seq: 5, runId: "run-1" } }
    const { owner, client } = await on(IDLE, undefined, { reply })
    const sendAndFollow = async (replayed: readonly JsonObject[], live: readonly JsonObject[]) => {
      const { events } = await following(client)
      pushRecords(owner, [...replayed, ...live])
      return drain(events)
    }
    const turn1 = turnRecords("run-1", "pong", 4)
    const turn2 = turnRecords("run-2", "ping", 6)
    expect(await sendAndFollow(turn1, turn2)).toEqual([
      { kind: "waiting", state: "turn_running" },
      { kind: "text", delta: "ping" },
      { kind: "end", outcome: { reason: "settled", text: "ping", turn_id: "run-2" } },
    ])
    reply.lifecycle = { state: "done", seq: 7, runId: "run-2" }
    const turn3 = turnRecords("run-3", "third", 8)
    expect(await sendAndFollow([...turn1, ...turn2], turn3)).toEqual([
      { kind: "waiting", state: "turn_running" },
      { kind: "text", delta: "third" },
      { kind: "end", outcome: { reason: "settled", text: "third", turn_id: "run-3" } },
    ])
  })
})

// The records of one engine run as the real engine streams them (live relay trace, #13753): only the records of the
// turn that answers a prompt carry its clientMessageId; leases, status, agent_start and agent_settled carry none. A
// queued input is answered inside the same run: its turn_start takes over and the run's agent_end carries the last id.
const promptRun = (runId: string, seq: number, inputs: readonly (readonly [string, string])[]): JsonObject[] => {
  const turn = (id: string, text: string): JsonObject[] => [
    { type: "turn_start", clientMessageId: id },
    { type: "message_start", clientMessageId: id, message: { role: "user" } },
    { type: "message_end", clientMessageId: id, message: { role: "user" } },
    {
      type: "entry_appended",
      clientMessageId: id,
      entry: { type: "message", id: `entry-${id}`, message: { role: "user" } },
    },
    { ...textDelta(text), clientMessageId: id },
    { type: "turn_end", clientMessageId: id },
  ]
  const last = inputs.at(-1)?.[0] ?? ""
  return [
    { type: "session_lifecycle", lifecycle: { state: "running", seq, runId } },
    { type: "agent_start", runId },
    { type: "session_status", status: "running" },
    ...inputs.flatMap(([id, text]) => turn(id, text)),
    { type: "agent_end", messages: [], willRetry: false, clientMessageId: last },
    { type: "session_status", status: "running" },
    { type: "agent_settled" },
    { type: "session_status", status: "idle" },
    { type: "session_lifecycle", lifecycle: { state: "done", seq: seq + 1, runId } },
  ]
}

const DEVICE: DeviceRow = {
  id: PEER,
  name: "Studio",
  kind: "desktop",
  platform: "darwin",
  online: true,
  last_seen_ms: null,
  caps: { attach: true, machine: false, control: false },
}
const receiptOf = (id: string, lane: "started" | "queued", turn?: string): SendReceipt =>
  lane === "queued"
    ? { thread: THREAD, device: DEVICE, delivery_id: id, lane, queue_position: 1 }
    : { thread: THREAD, device: DEVICE, delivery_id: id, lane, ...(turn === undefined ? {} : { turn_id: turn }) }

describe("sessions.follow rows: from one send (#13753, the live relay shapes)", () => {
  // The attach serves a cached snapshot from the session's open and replays every record since it, then the live ones.
  const replayed = promptRun("run-1", 1, [["cm-1", "pong"]])
  // The caller sends without waiting for follow's attach, so its first get_state already shows the send's run.
  const runningAt = (seq: number, runId: string): JsonObject => ({ lifecycle: { state: "running", seq, runId } })
  const followFrom = async (from: SendReceipt, pushed: readonly JsonObject[], reply = runningAt(3, "run-2")) => {
    const { owner, client } = await on(IDLE, undefined, { reply })
    const events = reader(client.sessions.follow(THREAD, { from }))
    await listening(client)
    pushRecords(owner, pushed)
    return drain(events)
  }

  test("#given a back-to-back send #when the attach replays the previous turn first #then only this send's turn, ended by its own end", async () => {
    expect(
      await followFrom(receiptOf("cm-2", "started", "2"), [...replayed, ...promptRun("run-2", 3, [["cm-2", "ping"]])]),
    ).toEqual([
      { kind: "waiting", state: "turn_running" },
      { kind: "text", delta: "ping" },
      { kind: "end", outcome: { reason: "settled", text: "ping", turn_id: "2" } },
    ])
  })

  test("#given a send queued behind another in the same run #when its turn takes over #then only its text, and its own end", async () => {
    const run2 = promptRun("run-2", 3, [
      ["cm-2", "ping"],
      ["cm-3", "zebra"],
    ])
    expect(await followFrom(receiptOf("cm-3", "queued"), [...replayed, ...run2])).toEqual([
      { kind: "waiting", state: "queued" },
      { kind: "waiting", state: "turn_running" },
      { kind: "text", delta: "zebra" },
      { kind: "end", outcome: { reason: "settled", text: "zebra" } },
    ])
  })

  test("#given a send whose run takes a queued input next #when that input's turn starts #then this send's turn has ended", async () => {
    const run2 = promptRun("run-2", 3, [
      ["cm-2", "ping"],
      ["cm-3", "zebra"],
    ])
    expect(await followFrom(receiptOf("cm-2", "started", "2"), [...replayed, ...run2])).toEqual([
      { kind: "waiting", state: "turn_running" },
      { kind: "text", delta: "ping" },
      { kind: "end", outcome: { reason: "settled", text: "ping", turn_id: "2" } },
    ])
  })

  test("#given a send after an idle gap #when every earlier turn is replayed first #then its own reply only", async () => {
    const earlier = [
      ...replayed,
      ...promptRun("run-2", 3, [
        ["cm-2", "ping"],
        ["cm-3", "zebra"],
      ]),
    ]
    expect(
      await followFrom(
        receiptOf("cm-4", "started", "3"),
        [...earlier, ...promptRun("run-3", 5, [["cm-4", "kiwi"]])],
        runningAt(5, "run-3"),
      ),
    ).toEqual([
      { kind: "waiting", state: "turn_running" },
      { kind: "text", delta: "kiwi" },
      { kind: "end", outcome: { reason: "settled", text: "kiwi", turn_id: "3" } },
    ])
  })

  test("#given a follow opened after its send's turn already ended #when the replay holds that turn #then its reply and end at once", async () => {
    const done = { lifecycle: { state: "done", seq: 2, runId: "run-1" } }
    expect(await followFrom(receiptOf("cm-1", "started", "1"), replayed, done)).toEqual([
      { kind: "waiting", state: "turn_running" },
      { kind: "text", delta: "pong" },
      { kind: "end", outcome: { reason: "settled", text: "pong", turn_id: "1" } },
    ])
  })
})

// A turn answering an input with no client id (an extension's custom-message follow-up, a prompt typed on the device):
// senpi clears the active correlation for it, so its turn_start and the run's agent_end carry no clientMessageId.
const idlessTurn = (text: string): JsonObject[] => [
  { type: "turn_start" },
  { type: "message_start", message: { role: "custom" } },
  { type: "message_end", message: { role: "custom" } },
  textDelta(text),
  { type: "turn_end" },
]
const runWithIdlessTurn = (runId: string, seq: number, id: string, text: string): JsonObject[] => {
  const run = promptRun(runId, seq, [[id, text]])
  const end = run.findIndex((record) => record["type"] === "agent_end")
  return [
    ...run.slice(0, end),
    ...idlessTurn("task finished"),
    { type: "agent_end", messages: [], willRetry: false },
    ...run.slice(end + 1),
  ]
}

describe("sessions.follow rows: from one send, its run going on into an id-less turn (#13753 review M1)", () => {
  test("#given a send whose run goes on into an id-less turn #when that turn starts #then the send's turn has ended", async () => {
    const owner = await startOwner(
      worldWith(IDLE, [], { reply: { lifecycle: { state: "running", seq: 3, runId: "run-2" } } }),
    )
    const client = clientOn(owner.stateDir, fakeClock())
    const events = reader(client.sessions.follow(THREAD, { from: receiptOf("cm-2", "started", "2") }))
    await listening(client)
    pushRecords(owner, runWithIdlessTurn("run-2", 3, "cm-2", "ping"))
    expect(await drain(events)).toEqual([
      { kind: "waiting", state: "turn_running" },
      { kind: "text", delta: "ping" },
      { kind: "end", outcome: { reason: "settled", text: "ping", turn_id: "2" } },
    ])
  })

  test("#given the same run #when wait runs from the send #then it settles at the id-less turn's start", async () => {
    const owner = await startOwner(
      worldWith(IDLE, [], { reply: { lifecycle: { state: "running", seq: 3, runId: "run-2" } } }),
    )
    const client = clientOn(owner.stateDir, fakeClock())
    const settling = client.sessions.wait(THREAD, { from: receiptOf("cm-2", "started", "2") })
    await listening(client)
    pushRecords(owner, runWithIdlessTurn("run-2", 3, "cm-2", "ping"))
    expect(await settling).toMatchObject({ kind: "ok", value: { outcome: "settled", status: "running" } })
  })

  test("#given a send's turn whose run ends with no further turn and no stamped agent_end #when the run settles #then the send's turn has ended", async () => {
    const owner = await startOwner(
      worldWith(IDLE, [], { reply: { lifecycle: { state: "running", seq: 3, runId: "run-2" } } }),
    )
    const client = clientOn(owner.stateDir, fakeClock())
    const events = reader(client.sessions.follow(THREAD, { from: receiptOf("cm-2", "started", "2") }))
    await listening(client)
    const run = promptRun("run-2", 3, [["cm-2", "ping"]]).map((record) =>
      record["type"] === "agent_end" ? { type: "agent_end", messages: [], willRetry: false } : record,
    )
    pushRecords(owner, run)
    expect(await drain(events)).toEqual([
      { kind: "waiting", state: "turn_running" },
      { kind: "text", delta: "ping" },
      { kind: "end", outcome: { reason: "settled", text: "ping", turn_id: "2" } },
    ])
  })
})

describe("sessions.follow rows: from one send, waiting on a person", () => {
  test("#given a send's turn #when its run lease goes to waiting_human and the turn then answers #then it ends on its own end, not on the lease", async () => {
    const owner = await startOwner(
      worldWith(IDLE, [], { reply: { lifecycle: { state: "running", seq: 3, runId: "run-2" } } }),
    )
    const client = clientOn(owner.stateDir, fakeClock())
    const events = reader(client.sessions.follow(THREAD, { from: receiptOf("cm-2", "started", "2") }))
    await listening(client)
    pushRecords(owner, [
      { type: "turn_start", clientMessageId: "cm-2" },
      { type: "session_lifecycle", lifecycle: { state: "waiting_human", seq: 4, runId: "run-2" } },
      { type: "session_lifecycle", lifecycle: { state: "running", seq: 5, runId: "run-2" } },
      { ...textDelta("approved"), clientMessageId: "cm-2" },
      { type: "agent_end", messages: [], willRetry: false, clientMessageId: "cm-2" },
    ])
    expect(await drain(events)).toEqual([
      { kind: "waiting", state: "turn_running" },
      { kind: "text", delta: "approved" },
      { kind: "end", outcome: { reason: "settled", text: "approved", turn_id: "2" } },
    ])
  })
})

describe("sessions.follow rows: a Stop, a hold, a provider retry (#13753 review M4, M5)", () => {
  const live = async (reply: JsonObject = { lifecycle: { state: "running", seq: 3, runId: "run-2" } }) => {
    const owner = await startOwner(worldWith(IDLE, [], { reply }))
    const client = clientOn(owner.stateDir, fakeClock())
    return { owner, client }
  }
  const stopped: JsonObject[] = [
    { type: "turn_start", clientMessageId: "cm-2" },
    { ...textDelta("par"), clientMessageId: "cm-2" },
    // A user Stop writes a paused lease (a session hold ranks ahead of running) before the send's own aborted agent_end.
    { type: "session_lifecycle", lifecycle: { state: "paused", seq: 4, runId: "run-2" } },
    { type: "agent_end", messages: [], willRetry: false, aborted: true, clientMessageId: "cm-2" },
    { type: "agent_settled" },
  ]

  test("#given a send's turn #when the user stops it #then the end is interrupted, decided by its own aborted agent_end", async () => {
    const { owner, client } = await live()
    const events = reader(client.sessions.follow(THREAD, { from: receiptOf("cm-2", "started", "2") }))
    await listening(client)
    pushRecords(owner, stopped)
    expect(await drain(events)).toEqual([
      { kind: "waiting", state: "turn_running" },
      { kind: "text", delta: "par" },
      { kind: "end", outcome: { reason: "interrupted", turn_id: "2" } },
    ])
  })

  test("#given a send's turn #when an unattended hold makes its lease held mid-turn #then the turn goes on to its own end", async () => {
    const { owner, client } = await live()
    const events = reader(client.sessions.follow(THREAD, { from: receiptOf("cm-2", "started", "2") }))
    await listening(client)
    pushRecords(owner, [
      { type: "turn_start", clientMessageId: "cm-2" },
      { type: "session_lifecycle", lifecycle: { state: "held", seq: 4, runId: "run-2" } },
      { ...textDelta("still here"), clientMessageId: "cm-2" },
      { type: "agent_end", messages: [], willRetry: false, clientMessageId: "cm-2" },
    ])
    expect(await drain(events)).toEqual([
      { kind: "waiting", state: "turn_running" },
      { kind: "text", delta: "still here" },
      { kind: "end", outcome: { reason: "settled", text: "still here", turn_id: "2" } },
    ])
  })

  test("#given a send's turn #when the provider fails and senpi retries (agent_end willRetry) #then the retried answer, then the end", async () => {
    const { owner, client } = await live()
    const events = reader(client.sessions.follow(THREAD, { from: receiptOf("cm-2", "started", "2") }))
    await listening(client)
    pushRecords(owner, [
      { type: "turn_start", clientMessageId: "cm-2" },
      { type: "agent_end", messages: [], willRetry: true, clientMessageId: "cm-2" },
      { type: "turn_start", clientMessageId: "cm-2" },
      { ...textDelta("answer"), clientMessageId: "cm-2" },
      { type: "agent_end", messages: [], willRetry: false, clientMessageId: "cm-2" },
    ])
    expect(await drain(events)).toEqual([
      { kind: "waiting", state: "turn_running" },
      { kind: "text", delta: "answer" },
      { kind: "end", outcome: { reason: "settled", text: "answer", turn_id: "2" } },
    ])
  })

  test("#given a wait from a send #when the user stops it #then it settles only once the turn has ended", async () => {
    const { owner, client } = await live()
    const settling = client.sessions.wait(THREAD, { from: receiptOf("cm-2", "started", "2") })
    const settled = settledYet(settling)
    await listening(client)
    pushRecords(owner, stopped.slice(0, 3))
    await listening(client)
    expect(settled()).toBe(false)
    pushRecords(owner, stopped.slice(3))
    expect(await settling).toMatchObject({ kind: "ok", value: { outcome: "settled", status: "idle" } })
  })

  test("#given a follow without a send #when the user stops the run #then the end is interrupted, not settled at the paused lease", async () => {
    const { owner, client } = await live()
    const { events } = await following(client)
    pushRecords(owner, [
      { type: "session_lifecycle", lifecycle: { state: "paused", seq: 4, runId: "run-2" } },
      { type: "agent_end", messages: [], willRetry: false, aborted: true },
      { type: "agent_settled" },
    ])
    expect(await drain(events)).toEqual([
      { kind: "waiting", state: "turn_running" },
      { kind: "end", outcome: { reason: "interrupted" } },
    ])
  })
})

describe("sessions.follow rows: from one send, across a relay gap (#13753 review L1)", () => {
  test("#given a send's turn under way #when a re-attach after a gap lost its agent_end and the run lease is done #then the turn has ended", async () => {
    const owner = await startOwner(
      worldWith(IDLE, [], { reply: { lifecycle: { state: "done", seq: 4, runId: "run-2" } } }),
    )
    const clock = fakeClock()
    const client = clientOn(owner.stateDir, clock)
    const events = reader(client.sessions.follow(THREAD, { from: receiptOf("cm-2", "started", "2") }))
    await listening(client)
    const run = promptRun("run-2", 3, [["cm-2", "ping"]])
    pushRecords(
      owner,
      run.slice(
        0,
        run.findIndex((record) => record["type"] === "turn_end"),
      ),
    )
    expect(await events.next("turn_running")).toEqual({ kind: "waiting", state: "turn_running" })
    expect(await events.next("the text")).toEqual({ kind: "text", delta: "ping" })
    pushSnapshot(owner, IDLE)
    // Two round trips on the connection: the re-attach's get_state has been answered.
    await listening(client)
    await listening(client)
    clock.advance(5_000) // past the resync grace: no record of the send came, so the read decides
    expect(await drain(events)).toEqual([{ kind: "end", outcome: { reason: "settled", text: "ping", turn_id: "2" } }])
  })

  test("#given a re-attach whose get_state says the run is over #when the send's own end still streams after the reply #then that end, with its last text, decides (review L3)", async () => {
    const owner = await startOwner(
      worldWith(IDLE, [], { reply: { lifecycle: { state: "done", seq: 4, runId: "run-2" } } }),
    )
    const client = clientOn(owner.stateDir, fakeClock())
    const events = reader(client.sessions.follow(THREAD, { from: receiptOf("cm-2", "started", "2") }))
    await listening(client)
    pushRecords(owner, [
      { type: "turn_start", clientMessageId: "cm-2" },
      { ...textDelta("pi"), clientMessageId: "cm-2" },
    ])
    expect(await events.next("turn_running")).toEqual({ kind: "waiting", state: "turn_running" })
    expect(await events.next("the text")).toEqual({ kind: "text", delta: "pi" })
    pushSnapshot(owner, IDLE)
    await listening(client)
    await listening(client)
    pushRecords(
      owner,
      [
        { ...textDelta("ng"), clientMessageId: "cm-2" },
        { type: "agent_end", messages: [], willRetry: false, aborted: true, clientMessageId: "cm-2" },
      ],
      2,
    )
    expect(await drain(events)).toEqual([
      { kind: "text", delta: "ng" },
      { kind: "end", outcome: { reason: "interrupted", turn_id: "2" } },
    ])
  })
})

describe("sessions.follow rows: from one send, replayed with the snapshot at attach", () => {
  test("#given an attach whose first records already hold the send's whole turn #when follow opens from it #then that turn, not lost before follow is ready", async () => {
    // The owner sends these right behind the snapshot, as the device service replays them, before follow is wired.
    const owner = await startOwner(worldWith(IDLE, promptRun("run-1", 1, [["cm-1", "pong"]])))
    const client = clientOn(owner.stateDir, fakeClock())
    const events = reader(client.sessions.follow(THREAD, { from: receiptOf("cm-1", "started", "1") }))
    expect(await drain(events)).toEqual([
      { kind: "waiting", state: "turn_running" },
      { kind: "text", delta: "pong" },
      { kind: "end", outcome: { reason: "settled", text: "pong", turn_id: "1" } },
    ])
  })
})

describe("sessions.wait rows: from one send (#13753)", () => {
  test("#given a back-to-back send #when the previous turn's end is replayed #then wait settles only on this send's turn", async () => {
    const { owner, client } = await on(IDLE, undefined, {
      reply: { lifecycle: { state: "running", seq: 3, runId: "run-2" } },
    })
    const settling = client.sessions.wait(THREAD, { from: receiptOf("cm-2", "started", "2") })
    const settled = settledYet(settling)
    await listening(client)
    pushRecords(owner, promptRun("run-1", 1, [["cm-1", "pong"]]))
    await listening(client)
    expect(settled()).toBe(false)
    pushRecords(owner, promptRun("run-2", 3, [["cm-2", "ping"]]))
    expect(await settling).toMatchObject({ kind: "ok", value: { outcome: "settled", status: "idle" } })
  })
})

// A wait opens its attach before a follow started after it on the same connection: the follow's opening state is the
// signal that the wait is listening, so a push after it reaches both.
const listening = async (client: RemoteClient): Promise<void> => {
  await reader(client.sessions.follow(THREAD)).next("a follow opened after the wait")
}

/** Whether a wait has settled yet, read after the fixture had every chance to settle it. */
const settledYet = (settling: Promise<unknown>) => {
  let settled = false
  void settling.then(() => (settled = true))
  return () => settled
}

describe("sessions.wait rows: a running turn behind an idle snapshot (live relay bug)", () => {
  test("#given a snapshot that says idle while its run lease says running #when wait runs #then it settles only on the turn's agent_settled", async () => {
    const { owner, client } = await on(IDLE, undefined, { entries: [lease("running", 4)] })
    const settling = client.sessions.wait(THREAD)
    const settled = settledYet(settling)
    await listening(client)
    await listening(client)
    expect(settled()).toBe(false)
    pushRecords(owner, [{ type: "agent_end", messages: [], willRetry: false }, { type: "agent_settled" }])
    expect(await settling).toMatchObject({ kind: "ok", value: { outcome: "settled", status: "idle" } })
  })

  test("#given a snapshot that says idle while a fresh get_state says the run is running #when wait runs #then it settles only when the run lease records the run done", async () => {
    const { owner, client } = await on(IDLE, undefined, {
      reply: { isStreaming: false, lifecycle: { state: "running", seq: 4, runId: "run-1" } },
    })
    const settling = client.sessions.wait(THREAD)
    const settled = settledYet(settling)
    await listening(client)
    await listening(client)
    expect(settled()).toBe(false)
    pushRecords(owner, [{ type: "entry_appended", entry: lease("done", 5) }])
    expect(await settling).toMatchObject({ kind: "ok", value: { outcome: "settled", status: "idle" } })
  })

  test("#given a running wait #when a re-attach snapshot only says idle #then it does not settle; a session_lifecycle record that ends the run does", async () => {
    const { owner, client } = await on(RUNNING)
    const settling = client.sessions.wait(THREAD)
    const settled = settledYet(settling)
    await listening(client)
    pushSnapshot(owner, IDLE)
    await listening(client)
    expect(settled()).toBe(false)
    pushRecords(owner, [{ type: "session_lifecycle", sessionId: "engine-1", lifecycle: { state: "done", seq: 6 } }], 2)
    expect(await settling).toMatchObject({ kind: "ok", value: { outcome: "settled", status: "idle" } })
  })
})

describe("sessions.wait rows: a first get_state that tells nothing (#13753 review M1)", () => {
  // The engine's truth: a run lease still running. The snapshot says idle and carries no lease, so only the fresh read
  // could tell; when it fails, "no run" is unknown and wait must not answer settled/idle.
  const behind = { lifecycle: { state: "running", seq: 4 } }

  test.each([
    ["the engine refuses get_state", "terminal" as const, worldWith(IDLE, [], { reply: behind })],
    [
      "get_state ends uncertain",
      undefined,
      worldWith(IDLE, [], {
        reply: behind,
        outcome: [{ state: "uncertain", reason: "unconfirmed", retryable: false }],
      }),
    ],
    ["the host sends no engine reply", undefined, worldWith(IDLE, [], { undelegated: true })],
  ])(
    "#given %s on an idle-looking snapshot #when wait runs #then it answers a failure, never settled/idle",
    async (_name, mode, world) => {
      const owner = mode === undefined ? await startOwner(world) : (await startModeOwner(mode, world, [])).owner
      const outcome = await clientOn(owner.stateDir, fakeClock()).sessions.wait(THREAD)
      expect(outcome).toMatchObject({ kind: "error", details: expect.objectContaining({ phase: "baseline" }) })
    },
  )
})

describe("sessions.wait rows: replayed turns (#13753 review Probe B)", () => {
  test("#given a run in flight at wait's baseline #when the attach replays the previous turn's end #then wait does not settle until the live run ends", async () => {
    const { owner, client } = await on(IDLE, undefined, {
      reply: { lifecycle: { state: "running", seq: 6, runId: "run-2" } },
    })
    const settling = client.sessions.wait(THREAD)
    const settled = settledYet(settling)
    await listening(client)
    pushRecords(owner, turnRecords("run-1", "pong", 4))
    await listening(client)
    expect(settled()).toBe(false)
    pushRecords(owner, turnRecords("run-2", "ping", 6).slice(2))
    expect(await settling).toMatchObject({ kind: "ok", value: { outcome: "settled", status: "idle" } })
  })
})

describe("sessions.wait rows", () => {
  test("#given an idle session #when wait runs #then settled at once", async () => {
    const { client } = await on(IDLE)
    expect(await client.sessions.wait(THREAD)).toEqual({
      kind: "ok",
      value: { outcome: "settled", status: "idle", waited_ms: 0 },
    })
  })

  test("#given a running turn #when it settles #then settled idle, with the fake time waited", async () => {
    const { owner, client, clock } = await on(RUNNING)
    const settling = client.sessions.wait(THREAD)
    await listening(client)
    clock.advance(4_000)
    pushRecords(owner, [{ type: "agent_settled" }])
    expect(await settling).toEqual({ kind: "ok", value: { outcome: "settled", status: "idle", waited_ms: 4_000 } })
  })

  test("#given a turn that asks for input #when wait runs #then settled waiting_input", async () => {
    const { owner, client } = await on(RUNNING)
    const settling = client.sessions.wait(THREAD)
    await listening(client)
    pushFrame(owner, DIALOG)
    expect(await settling).toMatchObject({ kind: "ok", value: { outcome: "settled", status: "waiting_input" } })
  })

  test("#given a turn blocked on a secret input raised on another connection #when wait runs #then settled waiting_input, not its deadline", async () => {
    const { owner, client, clock } = await on(RUNNING)
    const settling = client.sessions.wait(THREAD, { deadlineMs: 1_000 })
    await listening(client)
    pushRecords(owner, [SECRET_PENDING])
    await listening(client)
    clock.advance(1_000)
    expect(await settling).toMatchObject({ kind: "ok", value: { outcome: "settled", status: "waiting_input" } })
  })

  test("#given a turn that never ends #when the wait's deadline passes #then timeout with the status it last saw", async () => {
    const { client, clock } = await on(RUNNING)
    const settling = client.sessions.wait(THREAD, { deadlineMs: 1_000 })
    await listening(client)
    clock.advance(1_000)
    expect(await settling).toEqual({ kind: "ok", value: { outcome: "timeout", status: "running", waited_ms: 1_000 } })
  })

  test("#given a wait #when its signal aborts #then cancelled", async () => {
    const { client } = await on(RUNNING)
    const abort = new AbortController()
    const settling = client.sessions.wait(THREAD, { signal: abort.signal })
    await listening(client)
    abort.abort()
    expect(await settling).toMatchObject({ kind: "ok", value: { outcome: "cancelled", status: "running" } })
  })

  test("#given a wait #when the session closes #then ended", async () => {
    const { owner, client } = await on(RUNNING)
    const settling = client.sessions.wait(THREAD)
    await listening(client)
    pushDetached(owner, "session_closed")
    expect(await settling).toMatchObject({ kind: "ok", value: { outcome: "ended", status: "closed" } })
  })
})

describe("sessionStatusOf: the rule sessions.get reads an engine state by (#13753)", () => {
  test.each([
    ["an idle state with no run lease", IDLE, [], "idle"],
    ["isStreaming false while the run lease still runs", IDLE, [lease("running", 4)], "running"],
    [
      "isStreaming false while get_state's lifecycle runs",
      { ...IDLE, lifecycle: { state: "running", seq: 4 } },
      [],
      "running",
    ],
    ["a run lease that moved off running", IDLE, [lease("running", 4), lease("done", 5)], "idle"],
    ["a run lease waiting on a person", IDLE, [lease("waiting_human", 5)], "waiting_input"],
    ["a pending dialog", { ...RUNNING, pendingDialogs: [DIALOG] }, [], "waiting_input"],
    ["isStreaming true", RUNNING, [], "running"],
  ] as const)("#given %s #then %s", (_name, state, entries, status) => {
    expect(sessionStatusOf(state, entries)).toBe(status)
  })
})

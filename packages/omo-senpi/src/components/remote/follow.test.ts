import { afterEach, describe, expect, test } from "bun:test"
import { PEER } from "../../../../device-service-core/test/local-api/conformance/world.ts"
import { pushDetached, pushFrame, pushRecords, pushSnapshot, reader, THREAD, worldWith } from "./attach.test-support"
import { DEADLINES } from "./deadlines"
import { sessionStatusOf } from "./follow"
import { handleOf } from "./seams"
import { clientOn, closeClients, fakeClock, startModeOwner, startOwner } from "./testing/fake-service"
import type { RemoteClient } from "./client"
import type { FollowEvent, JsonObject, PendingRequest, RemoteSender } from "./types"

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
    const events = reader(client.sessions.follow(handleOf(PEER, "no-such-session")))
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

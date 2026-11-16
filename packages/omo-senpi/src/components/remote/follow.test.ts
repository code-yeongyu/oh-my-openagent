import { afterEach, describe, expect, test } from "bun:test"
import { PEER } from "../../../../device-service-core/test/local-api/conformance/world.ts"
import { pushDetached, pushFrame, pushRecords, pushSnapshot, reader, THREAD, worldWith } from "./attach.test-support"
import { DEADLINES } from "./deadlines"
import { handleOf } from "./seams"
import { clientOn, closeClients, fakeClock, startOwner } from "./testing/fake-service"
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
const DIALOG = {
  type: "extension_ui_request",
  id: "ui-1",
  method: "confirm",
  title: "Run rm?",
  message: "rm -rf build",
}

const on = async (state: JsonObject, sender?: RemoteSender) => {
  const owner = await startOwner(worldWith(state))
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

  test("#given a running turn #when a re-attach snapshot shows it idle #then the turn that settled in the gap ends settled", async () => {
    const { owner, client } = await on(RUNNING)
    const { events } = await following(client)
    pushSnapshot(owner, IDLE)
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

// A wait opens its attach before a follow started after it on the same connection: the follow's opening state is the
// signal that the wait is listening, so a push after it reaches both.
const listening = async (client: RemoteClient): Promise<void> => {
  await reader(client.sessions.follow(THREAD)).next("a follow opened after the wait")
}

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

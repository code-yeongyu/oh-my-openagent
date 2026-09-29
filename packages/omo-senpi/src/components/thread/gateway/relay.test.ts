import { afterEach, describe, expect, test } from "bun:test"

import type { BindInput } from "./bindings"
import { createCompletionTracker } from "./completion"
import { createInboxDrain } from "./drain"
import { createGatewayRelay, type GatewayRelay } from "./relay"
import type { GatewayStore } from "./store"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"

let harness: GatewayHarness | undefined

afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

type UiResponse = { readonly session: string; readonly id: string; readonly value: string }

function relayOn(h: GatewayHarness, store: GatewayStore = h.store()) {
  const responses: UiResponse[] = []
  const relay = createGatewayRelay({
    store,
    engine: h.engineFor(store),
    endpoints: {
      wake: async () => ({ admitted: [] }),
      respondUi: async (endpoint, response) => {
        responses.push({ session: endpoint.socket.slice("fake:".length), ...response })
      },
    },
    locate: async (durableId) => {
      const online = h.entries().find((entry) => entry.thread_id === durableId && entry.liveness === "routable")
      return online?.endpoint ?? null
    },
    now: () => h.clock.now,
  })
  return { relay, store, responses }
}

function binding(session: string, extra: Partial<BindInput> = {}): BindInput {
  return { platform: "custom", account_id: "qa", chat_id: "c1", thread_id: "t1", session_durable_id: session, ...extra }
}

function ok<T extends { kind: string }>(result: T): Extract<T, { kind: "ok" }> {
  if (result.kind !== "ok") throw new Error(`expected ok, got ${JSON.stringify(result)}`)
  return result as Extract<T, { kind: "ok" }>
}

function code(result: { kind: string; error?: { code: string } }): string {
  return result.kind === "ok" ? "ok" : (result.error?.code ?? "?")
}

async function bindAs(relay: GatewayRelay, input: BindInput): Promise<string> {
  return ok(await relay.bind({ principal: "session:A", binding: input })).binding.binding_id
}

describe("relay_direction_question_authority_and_completion", () => {
  test("#given a connector message #when the same inbound event id arrives twice #then it is admitted once, and the target sees an external provenance header naming the binding", async () => {
    const h = (harness = createGatewayHarness())
    const b = h.session("B")
    const { relay } = relayOn(h)
    const x = await bindAs(relay, binding("B"))
    const first = await relay.inbound({ binding_id: x, event_id: "evt-1", text: "hello from outside" })
    const second = await relay.inbound({ binding_id: x, event_id: "evt-1", text: "hello from outside" })
    await h.quiesce()
    const deliveryId = ok(first).delivery_id
    expect({ first: ok(first).delivery.kind, replayId: ok(second).delivery_id, deduplicated: ok(second).deduplicated }).toEqual({ first: "started", replayId: deliveryId, deduplicated: true })
    expect({ enqueued: b.runtime.enqueueCount(deliveryId), entries: b.runtime.transcriptEntries(deliveryId), rows: (await b.store.list({ target_durable_id: "B" })).length }).toEqual({ enqueued: 1, entries: 1, rows: 1 })
    const header = (b.runtime.textOf(deliveryId) ?? "").split("\n")[0]
    expect(header).toContain("source=external")
    expect(header).toContain(`binding=${x}@1`)
    expect(header).toContain("actor=qa")
  })

  test("#given a session bound to two chat threads #when it reports without naming a binding #then only the originating binding's outbox gets the row, and a binding outside its direction or events refuses", async () => {
    const h = (harness = createGatewayHarness())
    h.session("B")
    h.session("D")
    const { relay } = relayOn(h)
    const x = await bindAs(relay, binding("B"))
    const y = await bindAs(relay, binding("B", { chat_id: "c2" }))
    const inboundOnly = await bindAs(relay, binding("B", { chat_id: "c3", direction: { inbound: true, outbound: false } }))
    const reportsOnly = await bindAs(relay, binding("B", { chat_id: "c4", outbound_events: ["report"] }))
    expect(code(await relay.report({ principal: "session:D", session_durable_id: "D", event: "milestone", text: "nothing came in" }))).toBe("invalid_arguments")
    ok(await relay.inbound({ binding_id: x, event_id: "evt-1", text: "start the job" }))
    await h.quiesce()
    const reported = ok(await relay.report({ principal: "session:B", session_durable_id: "B", event: "milestone", text: "step 1" }))
    expect({ binding: reported.binding_id, revision: reported.revision }).toEqual({ binding: x, revision: 1 })
    expect(ok(await relay.outbox({ binding_id: x })).rows.map((row) => row.text)).toEqual(["step 1"])
    expect(ok(await relay.outbox({ binding_id: y })).rows).toEqual([])
    expect(code(await relay.report({ principal: "session:B", session_durable_id: "B", binding_id: inboundOnly, event: "report", text: "r" }))).toBe("unsupported")
    expect(code(await relay.report({ principal: "session:B", session_durable_id: "B", binding_id: reportsOnly, event: "milestone", text: "m" }))).toBe("unsupported")
    expect(code(await relay.report({ principal: "session:D", session_durable_id: "D", binding_id: x, event: "report", text: "not my binding" }))).toBe("scope_denied")
  })

  test("#given milestones on a binding #when the connector acks the first with its posted message id #then later milestones carry that id to edit and the binding records it", async () => {
    const h = (harness = createGatewayHarness())
    h.session("B")
    const { relay } = relayOn(h)
    const x = await bindAs(relay, binding("B"))
    const one = ok(await relay.report({ principal: "session:B", session_durable_id: "B", binding_id: x, event: "milestone", text: "25%" }))
    expect(ok(await relay.outbox({ binding_id: x })).rows.map((row) => row.edit_message_id)).toEqual([null])
    ok(await relay.ack({ binding_id: x, cursor: one.cursor as number, provider_message_id: "pm-1" }))
    ok(await relay.report({ principal: "session:B", session_durable_id: "B", binding_id: x, event: "milestone", text: "50%" }))
    const rows = ok(await relay.outbox({ binding_id: x })).rows
    expect(rows.map((row) => [row.text, row.edit_message_id])).toEqual([["50%", "pm-1"]])
    expect(ok(await relay.bindings({ filter: { chat_id: "c1" } })).bindings[0]?.progress_message_id).toBe("pm-1")
  })

  test("#given a question relayed through binding X #when the answer arrives through binding Y #then it is binding_mismatch and the question stays pending; through X it resolves the session's UI request once and a replay is already_answered", async () => {
    const h = (harness = createGatewayHarness())
    h.session("B")
    const { relay, responses } = relayOn(h)
    const x = await bindAs(relay, binding("B"))
    const y = await bindAs(relay, binding("B", { chat_id: "c2" }))
    const asked = ok(await relay.report({ principal: "session:B", session_durable_id: "B", binding_id: x, event: "question", text: "deploy now?", request_id: "ui-7" }))
    const token = asked.reply_token as string
    expect(code(await relay.answer({ binding_id: y, reply_token: token, answer: "yes" }))).toBe("binding_mismatch")
    expect(ok(await relay.outbox({ binding_id: x })).rows.map((row) => row.question_state)).toEqual(["pending"])
    expect(responses).toEqual([])
    expect(ok(await relay.answer({ binding_id: x, reply_token: token, answer: "yes" }))).toMatchObject({ binding_id: x, session_durable_id: "B", cursor: asked.cursor })
    expect(responses).toEqual([{ session: "B", id: "ui-7", value: "yes" }])
    expect(code(await relay.answer({ binding_id: x, reply_token: token, answer: "yes" }))).toBe("already_answered")
    expect(code(await relay.answer({ binding_id: x, reply_token: `${token.slice(0, -2)}xx`, answer: "forged" }))).toBe("invalid_arguments")
    expect(responses).toHaveLength(1)
  })

  test("#given pending questions #when the binding is rebound, the session restarts, or the session is unreachable #then the answer is stale_token, stale_token, and host_unavailable with the question kept pending", async () => {
    const h = (harness = createGatewayHarness())
    const b = h.session("B")
    h.session("C")
    const { relay, store, responses } = relayOn(h)
    const x = await bindAs(relay, binding("B"))
    const y = await bindAs(relay, binding("B", { chat_id: "c2" }))
    const beforeRebind = ok(await relay.report({ principal: "session:B", session_durable_id: "B", binding_id: x, event: "question", text: "q1", request_id: "ui-1" })).reply_token as string
    ok(await relay.rebind({ principal: "session:A", binding_id: x, expected_revision: 1, session_durable_id: "C" }))
    expect(code(await relay.answer({ binding_id: x, reply_token: beforeRebind, answer: "a" }))).toBe("stale_token")
    const beforeRestart = ok(await relay.report({ principal: "session:B", session_durable_id: "B", binding_id: y, event: "question", text: "q2", request_id: "ui-2" })).reply_token as string
    await store.registerIncarnation({ durable_id: "B", incarnation: "runtime-after-restart" })
    expect(code(await relay.answer({ binding_id: y, reply_token: beforeRestart, answer: "a" }))).toBe("stale_token")
    const offline = ok(await relay.report({ principal: "session:B", session_durable_id: "B", binding_id: y, event: "question", text: "q3", request_id: "ui-3" })).reply_token as string
    b.online = false
    expect(code(await relay.answer({ binding_id: y, reply_token: offline, answer: "later" }))).toBe("host_unavailable")
    expect(ok(await relay.outbox({ binding_id: y })).rows.find((row) => row.reply_token === offline)?.question_state).toBe("pending")
    b.online = true
    ok(await relay.answer({ binding_id: y, reply_token: offline, answer: "later" }))
    expect(responses).toEqual([{ session: "B", id: "ui-3", value: "later" }])
  })

  test("#given a completion armed through a binding #when agent_end fires, a retry ends again, and the session settles #then no row appears at any agent_end and exactly one appears at the settle, with the final run's real outcome", async () => {
    const h = (harness = createGatewayHarness())
    h.session("B")
    const { relay } = relayOn(h)
    const x = await bindAs(relay, binding("B"))
    const tracker = createCompletionTracker((durableId, outcome) => relay.settle({ session_durable_id: durableId, outcome }))
    const armed = ok(await relay.report({ principal: "session:B", session_durable_id: "B", binding_id: x, event: "completion", text: "job finished" }))
    expect({ armed: armed.armed, cursor: armed.cursor }).toEqual({ armed: true, cursor: null })
    tracker.agentEnd("B", { messages: [{ role: "assistant", stopReason: "error" }] })
    expect(ok(await relay.outbox({ binding_id: x })).rows).toEqual([])
    tracker.agentEnd("B", { aborted: true, messages: [] })
    expect(ok(await relay.outbox({ binding_id: x })).rows).toEqual([])
    expect(await tracker.settled("B")).toHaveLength(1)
    expect(ok(await relay.outbox({ binding_id: x })).rows.map((row) => [row.event, row.outcome, row.text])).toEqual([["completion", "cancelled", "job finished"]])
    tracker.agentEnd("B", { messages: [{ role: "assistant", stopReason: "stop" }] })
    expect(await tracker.settled("B")).toEqual([])
    expect(ok(await relay.outbox({ binding_id: x, after_cursor: 0 })).rows).toHaveLength(1)
  })

  test("#given the user is composing in the bound session #when a connector message waits behind the draft and inbox wakes repeat #then the session shows one queued notice naming the actor and delivery, and the message lands after submit", async () => {
    const h = (harness = createGatewayHarness())
    const b = h.session("B", { online: false })
    const { relay } = relayOn(h)
    const x = await bindAs(relay, binding("B"))
    const notices: string[] = []
    const drain = createInboxDrain({ store: b.store, runtime: b.runtime, durableId: "B", sessionPath: () => b.runtime.sessionPath, now: () => h.clock.now, notify: (text) => notices.push(text) })
    b.runtime.typeDraft()
    const deliveryId = ok(await relay.inbound({ binding_id: x, event_id: "evt-1", text: "while you type" })).delivery_id
    await drain.drain({ reason: "inbox" })
    await drain.drain({ reason: "inbox" })
    expect({ notices, enqueued: b.runtime.enqueueCalls.length }).toEqual({ notices: [`remote message from qa queued (${deliveryId})`], enqueued: 0 })
    b.runtime.submitDraft()
    await drain.drain({ reason: "submission" })
    expect({ notices: notices.length, lanes: b.runtime.enqueueCalls.map((call) => call.lane) }).toEqual({ notices: 1, lanes: ["followUp"] })
  })

  test("#given three outbox rows #when the connector acks and re-reads #then a read after the ack returns nothing new, an older ack is a no-op, and an older cursor re-reads from there", async () => {
    const h = (harness = createGatewayHarness())
    h.session("B")
    const { relay } = relayOn(h)
    const x = await bindAs(relay, binding("B"))
    const cursors: number[] = []
    for (const text of ["r1", "r2", "r3"]) cursors.push(ok(await relay.report({ principal: "session:B", session_durable_id: "B", binding_id: x, event: "report", text })).cursor as number)
    expect(ok(await relay.outbox({ binding_id: x })).rows.map((row) => row.text)).toEqual(["r1", "r2", "r3"])
    expect(ok(await relay.ack({ binding_id: x, cursor: cursors[1] }))).toMatchObject({ changed: true, acked_cursor: cursors[1] })
    expect(ok(await relay.outbox({ binding_id: x })).rows.map((row) => row.text)).toEqual(["r3"])
    expect(ok(await relay.ack({ binding_id: x, cursor: cursors[0] }))).toMatchObject({ changed: false, acked_cursor: cursors[1] })
    expect(ok(await relay.outbox({ binding_id: x, after_cursor: cursors[0] })).rows.map((row) => [row.text, row.state])).toEqual([["r2", "acked"], ["r3", "pending"]])
    expect(code(await relay.ack({ binding_id: x, cursor: cursors[2] + 10 }))).toBe("cursor_invalid")
    ok(await relay.ack({ binding_id: x, cursor: cursors[2] }))
    expect(ok(await relay.outbox({ binding_id: x })).rows).toEqual([])
  })
})

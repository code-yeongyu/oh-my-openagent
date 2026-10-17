import { Database } from "bun:sqlite"
import { afterEach, describe, expect, test } from "bun:test"

import type { UiAnswerReply } from "./adapter"
import type { AnswerFields } from "./answer-shape"
import { gatewayDatabasePath } from "./paths"
import { createGatewayRelay } from "./relay"
import { ANSWER_IN_FLIGHT_MAX_MS } from "./store-relay-ops"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"

let harness: GatewayHarness | undefined

afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

const ENDPOINT = { kind: "rpc_host", socket: "fake:B", routing_id: "rpc-1" } as const

async function abandonedQuestion(refusal: string) {
  const h = (harness = createGatewayHarness())
  h.session("B")
  const sent: AnswerFields[] = []
  const store = h.store()
  const relay = createGatewayRelay({
    store,
    engine: h.engineFor(store),
    endpoints: {
      wake: async () => ({ admitted: [] }),
      respondUi: async (_endpoint, answer): Promise<UiAnswerReply> => {
        sent.push(answer.fields)
        return { delivered: false, error: refusal }
      },
    },
    locate: async () => ENDPOINT,
    now: () => h.clock.now,
  })
  const bound = await relay.bind({ principal: "session:A", binding: { platform: "custom", account_id: "qa", chat_id: "c-1", thread_id: "t1", session_durable_id: "B" } })
  if (bound.kind !== "ok") throw new Error(`bind failed: ${JSON.stringify(bound)}`)
  const bindingId = bound.binding.binding_id
  const reported = await relay.report({ principal: "session:B", session_durable_id: "B", binding_id: bindingId, event: "question", text: "?", request_id: "ui-1", request_kind: "select" })
  if (reported.kind !== "ok" || typeof reported.reply_token !== "string") throw new Error(`report failed: ${JSON.stringify(reported)}`)
  const token = reported.reply_token

  let reached!: () => void
  const handOffStarted = new Promise<void>((resolve) => { reached = resolve })
  const deadStore = h.store()
  const dead = createGatewayRelay({
    store: deadStore,
    engine: h.engineFor(deadStore),
    endpoints: { wake: async () => ({ admitted: [] }), respondUi: () => { reached(); return new Promise<UiAnswerReply>(() => {}) } },
    locate: async () => ENDPOINT,
    now: () => h.clock.now,
  })
  void dead.answer({ binding_id: bindingId, reply_token: token, answer: "from the dead claimant" })
  let watchdog: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([handOffStarted, new Promise((_, reject) => { watchdog = setTimeout(() => reject(new Error("waited 10s for the dead claimant's hand-off")), 10_000) })])
  } finally {
    clearTimeout(watchdog)
  }
  h.clock.now += ANSWER_IN_FLIGHT_MAX_MS

  const answer = (text: string) => relay.answer({ binding_id: bindingId, reply_token: token, answer: text })
  const row = () => {
    const db = new Database(gatewayDatabasePath(h.agentDir), { readonly: true })
    try {
      return db.query("SELECT question_state, answer_state, answer FROM outbox WHERE reply_token = ?").get(token)
    } finally {
      db.close()
    }
  }
  return { answer, row, sent }
}

describe("a_taking_over_answer_refused_because_the_question_was_closed_elsewhere", () => {
  test.each(["unknown_extension_ui_request", "unknown_request"])("#given an abandoned answer and a session that no longer knows the request (%s) #when another answer takes the claim over #then the question is delivered with NO answer text, the result says it was answered or closed elsewhere, and no later answer sends a frame", async (refusal) => {
    // given
    const q = await abandonedQuestion(refusal)

    // when
    const takeover = await q.answer("from B")
    const later = await q.answer("from C")

    // then
    expect(takeover).toMatchObject({ kind: "error", error: { code: "already_answered", details: { reason: refusal } } })
    const takeoverError = (takeover as { error: { message: string; next_action: string } }).error
    expect(takeoverError.message).toContain("no longer waits for this question (answered or closed elsewhere)")
    expect(takeoverError.message).not.toContain("earlier answer")
    expect(q.row()).toEqual({ question_state: "answered", answer_state: "delivered", answer: null })
    expect(later).toMatchObject({ kind: "error", error: { code: "already_answered" } })
    expect((later as { error: { message: string } }).error.message).toContain("no longer waits for this question (answered or closed elsewhere)")
    expect(q.sent).toEqual([{ value: "from B" }])
  })

  test("#given the same abandoned answer and a session that already resolved the request #when another answer takes the claim over #then only question_already_resolved keeps the dead claimant's answer as the delivered one", async () => {
    // given
    const q = await abandonedQuestion("question_already_resolved")

    // when
    const takeover = await q.answer("from B")

    // then
    expect(takeover).toMatchObject({ kind: "error", error: { code: "already_answered", details: { reason: "question_already_resolved" } } })
    expect((takeover as { error: { message: string } }).error.message).toContain("already took an earlier answer")
    expect(q.row()).toEqual({ question_state: "answered", answer_state: "delivered", answer: "from the dead claimant" })
    expect((await q.answer("from C") as { error: { message: string } }).error.message).toBe("This question was already answered.")
    expect(q.sent).toEqual([{ value: "from B" }])
  })
})

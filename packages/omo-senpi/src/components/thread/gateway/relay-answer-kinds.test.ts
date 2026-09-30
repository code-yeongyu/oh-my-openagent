import { Database } from "bun:sqlite"
import { afterEach, describe, expect, test } from "bun:test"

import type { UiAnswerReply } from "./adapter"
import type { AnswerFields, UiRequestKind } from "./answer-shape"
import { gatewayDatabasePath } from "./paths"
import { createGatewayRelay } from "./relay"
import { ANSWER_IN_FLIGHT_MAX_MS } from "./store-relay-ops"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"

let harness: GatewayHarness | undefined

afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

type HandOff = (fields: AnswerFields, uiRequestId: string) => Promise<UiAnswerReply>

function relayFor(handOff: HandOff) {
  const h = (harness = createGatewayHarness())
  h.session("B")
  const sent: AnswerFields[] = []
  const relayOver = () => {
    const store = h.store()
    return createGatewayRelay({
      store,
      engine: h.engineFor(store),
      endpoints: {
        wake: async () => ({ admitted: [] }),
        respondUi: async (_endpoint, answer) => {
          sent.push(answer.fields)
          return await handOff(answer.fields, answer.ui_request_id)
        },
      },
      locate: async () => ({ kind: "rpc_host", socket: "fake:B", routing_id: "rpc-1" }),
      now: () => h.clock.now,
    })
  }
  const relay = relayOver()
  let asks = 0
  const ask = async (kind?: UiRequestKind) => {
    asks += 1
    const bound = await relay.bind({ principal: "session:A", binding: { platform: "custom", account_id: "qa", chat_id: `c-${asks}`, thread_id: "t1", session_durable_id: "B" } })
    if (bound.kind !== "ok") throw new Error(`bind failed: ${JSON.stringify(bound)}`)
    const bindingId = bound.binding.binding_id
    const reported = await relay.report({ principal: "session:B", session_durable_id: "B", binding_id: bindingId, event: "question", text: "?", request_id: `ui-${asks}`, ...(kind === undefined ? {} : { request_kind: kind }) })
    if (reported.kind !== "ok" || typeof reported.reply_token !== "string") throw new Error(`report failed: ${JSON.stringify(reported)}`)
    const token = reported.reply_token
    const answer = (text: string) => relay.answer({ binding_id: bindingId, reply_token: token, answer: text })
    const state = async () => {
      const outbox = await relay.outbox({ binding_id: bindingId })
      if (outbox.kind !== "ok") throw new Error(`outbox failed: ${JSON.stringify(outbox)}`)
      return outbox.rows.map((row) => row.question_state)
    }
    return { bindingId, token, answer, state }
  }
  return { h, relay, relayOver, sent, ask }
}

/**
 * Turns the store back into what the v2 code left on disk: the rows keep their data, the v3 and v4
 * columns go, and the version reads 2. `before` runs first, to put a row into a state only the v2 code
 * wrote. The next store that opens it migrates it to the current version again.
 */
function downgradeToV2(agentDir: string, before: (db: Database) => void = () => {}): void {
  const db = new Database(gatewayDatabasePath(agentDir))
  try {
    before(db)
    db.run("ALTER TABLE outbox DROP COLUMN ui_request_kind")
    db.run("ALTER TABLE outbox DROP COLUMN answer_state")
    db.run("ALTER TABLE outbox DROP COLUMN answered_by")
    db.run("PRAGMA user_version = 2")
  } finally {
    db.close()
  }
}

function rowOf(agentDir: string, replyToken: string) {
  const db = new Database(gatewayDatabasePath(agentDir), { readonly: true })
  try {
    return db.query("SELECT question_state, answer_state, answer FROM outbox WHERE reply_token = ?").get(replyToken)
  } finally {
    db.close()
  }
}

async function stateOf(relay: ReturnType<typeof createGatewayRelay>, bindingId: string) {
  const outbox = await relay.outbox({ binding_id: bindingId })
  if (outbox.kind !== "ok") throw new Error(`outbox failed: ${JSON.stringify(outbox)}`)
  return outbox.rows.map((row) => row.question_state)
}

function code(result: { readonly kind: string; readonly error?: { readonly code: string } }): string {
  return result.kind === "ok" ? "ok" : (result.error?.code ?? "?")
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function within<T>(promise: Promise<T>, label: string, ms = 10_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`waited ${ms} ms for ${label}`)), ms) })]).finally(() => clearTimeout(timer))
}

describe("answer_while_another_answer_is_in_flight", () => {
  test("#given an answer still being handed to the session #when a second answer arrives #then it is answer_in_progress, not already_answered; the first failing leaves the question pending and a later answer delivers once", async () => {
    // given
    const reached = deferred<void>()
    const gate = deferred<UiAnswerReply>()
    let calls = 0
    const { ask, sent } = relayFor(async () => {
      if (++calls > 1) return { delivered: true }
      reached.resolve()
      return await gate.promise
    })
    const q = await ask()
    const first = q.answer("yes")
    await within(reached.promise, "the first hand-off")

    // when
    const second = await q.answer("yes")

    // then
    expect(second).toMatchObject({ kind: "error", error: { code: "answer_in_progress" } })

    // when
    gate.resolve({ delivered: false, error: "unknown_extension_ui_request" })

    // then
    expect(code(await within(first, "the first answer"))).toBe("stale_token")
    expect(await q.state()).toEqual(["pending"])
    expect(code(await q.answer("yes"))).toBe("ok")
    expect(code(await q.answer("yes"))).toBe("already_answered")
    expect(sent).toHaveLength(2)
  })

  test("#given a claim whose claimant stopped mid-hand-off #when the in-flight bound has passed #then a new answer takes it over and delivers", async () => {
    // given
    const { h, ask, sent } = relayFor(async () => ({ delivered: true }))
    const q = await ask()
    const reached = deferred<void>()
    const stalledStore = h.store()
    const stalled = createGatewayRelay({
      store: stalledStore,
      engine: h.engineFor(stalledStore),
      endpoints: { wake: async () => ({ admitted: [] }), respondUi: () => { reached.resolve(); return new Promise<UiAnswerReply>(() => {}) } },
      locate: async () => ({ kind: "rpc_host", socket: "fake:B", routing_id: "rpc-1" }),
      now: () => h.clock.now,
    })
    void stalled.answer({ binding_id: q.bindingId, reply_token: q.token, answer: "first" })
    await within(reached.promise, "the stalled hand-off")
    expect(code(await q.answer("second"))).toBe("answer_in_progress")

    // when
    h.clock.now += ANSWER_IN_FLIGHT_MAX_MS

    // then
    expect(code(await q.answer("second"))).toBe("ok")
    expect(sent).toEqual([{ value: "second", answers: {}, comment: "second" }])
  })

  const lateOutcomes: ReadonlyArray<readonly [string, (late: { resolve: (reply: UiAnswerReply) => void; reject: (error: Error) => void }) => void]> = [
    ["refused by the session", (late) => late.resolve({ delivered: false, error: "question_already_resolved" })],
    ["failed with no reply", (late) => late.reject(new Error("rpc deadline"))],
  ]
  for (const [how, settleLate] of lateOutcomes) {
    test(`#given a claimant stalled past the in-flight bound and a second answer that took over and was delivered #when the stalled hand-off is finally ${how} #then its late release leaves the delivered answer in place`, async () => {
      // given
      const { h, ask, sent } = relayFor(async () => ({ delivered: true }))
      const q = await ask("select")
      const reached = deferred<void>()
      let late!: { resolve: (reply: UiAnswerReply) => void; reject: (error: Error) => void }
      const pending = new Promise<UiAnswerReply>((resolve, reject) => { late = { resolve, reject } })
      const stalledStore = h.store()
      const stalled = createGatewayRelay({
        store: stalledStore,
        engine: h.engineFor(stalledStore),
        endpoints: { wake: async () => ({ admitted: [] }), respondUi: () => { reached.resolve(); return pending } },
        locate: async () => ({ kind: "rpc_host", socket: "fake:B", routing_id: "rpc-1" }),
        now: () => h.clock.now,
      })
      const first = stalled.answer({ binding_id: q.bindingId, reply_token: q.token, answer: "from A" })
      await within(reached.promise, "the stalled hand-off")
      h.clock.now += ANSWER_IN_FLIGHT_MAX_MS + 1_000
      expect(code(await q.answer("from B"))).toBe("ok")

      // when
      settleLate(late)
      await within(first, "the stalled answer")

      // then
      expect(await q.state()).toEqual(["answered"])
      expect(code(await q.answer("from C"))).toBe("already_answered")
      expect(sent).toEqual([{ value: "from B" }])
    })
  }

  for (const refusal of ["question_already_resolved", "unknown_extension_ui_request"] as const) {
    test(`#given a claimant stalled past the in-flight bound and a second answer that took over #when the session accepts the stalled answer and then refuses the second (${refusal}) #then the question ends delivered with the stalled answer, the second answer and a later one are already_answered`, async () => {
      // given
      const second = deferred<UiAnswerReply>()
      const secondReached = deferred<void>()
      const { h, ask } = relayFor(async () => { secondReached.resolve(); return await second.promise })
      const q = await ask("select")
      const reached = deferred<void>()
      const late = deferred<UiAnswerReply>()
      const stalledStore = h.store()
      const stalled = createGatewayRelay({
        store: stalledStore,
        engine: h.engineFor(stalledStore),
        endpoints: { wake: async () => ({ admitted: [] }), respondUi: () => { reached.resolve(); return late.promise } },
        locate: async () => ({ kind: "rpc_host", socket: "fake:B", routing_id: "rpc-1" }),
        now: () => h.clock.now,
      })
      const first = stalled.answer({ binding_id: q.bindingId, reply_token: q.token, answer: "from A" })
      await within(reached.promise, "the stalled hand-off")
      h.clock.now += ANSWER_IN_FLIGHT_MAX_MS + 1_000
      const takeover = q.answer("from B")
      await within(secondReached.promise, "the second hand-off")

      // when
      late.resolve({ delivered: true })
      expect(code(await within(first, "the stalled answer"))).toBe("ok")
      second.resolve({ delivered: false, error: refusal })

      // then
      expect(code(await within(takeover, "the second answer"))).toBe("already_answered")
      expect(rowOf(h.agentDir, q.token)).toEqual({ question_state: "answered", answer_state: "delivered", answer: "from A" })
      expect(code(await q.answer("from C"))).toBe("already_answered")
    })
  }

})

describe("a_late_confirmation_is_the_fact_that_the_session_took_that_answer", () => {
  test("#given a claimant stalled past the in-flight bound and a second answer that took over #when the session accepts the stalled answer and the second hand-off then fails with no reply #then the question stays delivered with the stalled answer", async () => {
    // given
    let failSecond!: (error: Error) => void
    const secondReached = deferred<void>()
    const { h, ask } = relayFor(() => { secondReached.resolve(); return new Promise<UiAnswerReply>((_, reject) => { failSecond = reject }) })
    const q = await ask("select")
    const reached = deferred<void>()
    const late = deferred<UiAnswerReply>()
    const stalledStore = h.store()
    const stalled = createGatewayRelay({
      store: stalledStore,
      engine: h.engineFor(stalledStore),
      endpoints: { wake: async () => ({ admitted: [] }), respondUi: () => { reached.resolve(); return late.promise } },
      locate: async () => ({ kind: "rpc_host", socket: "fake:B", routing_id: "rpc-1" }),
      now: () => h.clock.now,
    })
    const first = stalled.answer({ binding_id: q.bindingId, reply_token: q.token, answer: "from A" })
    await within(reached.promise, "the stalled hand-off")
    h.clock.now += ANSWER_IN_FLIGHT_MAX_MS + 1_000
    const takeover = q.answer("from B")
    await within(secondReached.promise, "the second hand-off")

    // when
    late.resolve({ delivered: true })
    expect(code(await within(first, "the stalled answer"))).toBe("ok")
    failSecond(new Error("rpc deadline"))

    // then
    expect(code(await within(takeover, "the second answer"))).toBe("host_unavailable")
    expect(rowOf(h.agentDir, q.token)).toEqual({ question_state: "answered", answer_state: "delivered", answer: "from A" })
    expect(code(await q.answer("from C"))).toBe("already_answered")
  })
})

describe("answer_shape_follows_the_request_kind", () => {
  test("#given confirm, select, input, editor and question requests #when each is answered #then the session gets confirmed, value, value, value and answers+comment", async () => {
    const { ask, sent } = relayFor(async () => ({ delivered: true }))
    const cases: Array<[UiRequestKind, string, AnswerFields]> = [
      ["confirm", " Yes ", { confirmed: true }],
      ["select", "Allow", { value: "Allow" }],
      ["input", "", { value: "" }],
      ["editor", "  \n", { value: "  \n" }],
      ["question", "ship it", { answers: {}, comment: "ship it" }],
    ]
    for (const [kind, text] of cases) expect(code(await (await ask(kind)).answer(text))).toBe("ok")
    expect(sent).toEqual(cases.map(([, , fields]) => fields))
  })

  test("#given a confirm request #when the answer is no, n or false, or is not a yes/no #then no/n/false deliver confirmed:false and anything else is invalid_arguments with nothing sent", async () => {
    const { ask, sent } = relayFor(async () => ({ delivered: true }))
    for (const text of ["no", "N", "false"]) expect(code(await (await ask("confirm")).answer(text))).toBe("ok")
    const maybe = await ask("confirm")
    expect(code(await maybe.answer("maybe"))).toBe("invalid_arguments")
    expect(await maybe.state()).toEqual(["pending"])
    expect(sent).toEqual([{ confirmed: false }, { confirmed: false }, { confirmed: false }])
  })

  test("#given a pending select reported with no request_kind #when it is answered X #then the session gets value X, in the frame that also carries answers and comment", async () => {
    const { ask, sent } = relayFor(async () => ({ delivered: true }))
    expect(code(await (await ask()).answer("X"))).toBe("ok")
    expect(sent).toEqual([{ value: "X", answers: {}, comment: "X" }])
  })

  test("#given questions reported with no request_kind #when they are answered with yes/no words and with other text #then a yes/no word also goes out as confirmed, beside the value a select reads", async () => {
    const { ask, sent } = relayFor(async () => ({ delivered: true }))
    for (const text of ["yes", " No ", "maybe"]) expect(code(await (await ask()).answer(text))).toBe("ok")
    expect(sent).toEqual([
      { value: "yes", answers: {}, comment: "yes", confirmed: true },
      { value: " No ", answers: {}, comment: " No ", confirmed: false },
      { value: "maybe", answers: {}, comment: "maybe" },
    ])
  })

  test("#given a question with no request_kind #when the answer is blank #then it is invalid_arguments and nothing is claimed or sent", async () => {
    const { ask, sent } = relayFor(async () => ({ delivered: true }))
    const q = await ask()
    for (const text of ["", "  ", "\u200b"]) expect(code(await q.answer(text))).toBe("invalid_arguments")
    expect(await q.state()).toEqual(["pending"])
    expect(sent).toEqual([])
  })

  test("#given a question row written by the v2 code, which recorded no kind #when the upgraded store answers it #then the session gets the combined frame", async () => {
    const { h, ask, relayOver, sent } = relayFor(async () => ({ delivered: true }))
    const q = await ask("select")
    downgradeToV2(h.agentDir)

    const upgraded = relayOver()
    expect(code(await upgraded.answer({ binding_id: q.bindingId, reply_token: q.token, answer: "Option C" }))).toBe("ok")
    expect(sent).toEqual([{ value: "Option C", answers: {}, comment: "Option C" }])
    expect(await stateOf(upgraded, q.bindingId)).toEqual(["answered"])
  })

  test("#given a report that is not a question #when it names a request_kind #then it is invalid_arguments", async () => {
    const { relay } = relayFor(async () => ({ delivered: true }))
    const bound = await relay.bind({ principal: "session:A", binding: { platform: "custom", account_id: "qa", chat_id: "c1", thread_id: "t1", session_durable_id: "B" } })
    if (bound.kind !== "ok") throw new Error("bind failed")
    const reported = await relay.report({ principal: "session:B", session_durable_id: "B", binding_id: bound.binding.binding_id, event: "milestone", text: "50%", request_kind: "confirm" })
    expect(code(reported)).toBe("invalid_arguments")
  })
})

describe("blank_answers_only_where_the_kind_cannot_take_them", () => {
  test("#given question, select and confirm requests #when the answer is empty, whitespace or only zero-width characters #then each is invalid_arguments, nothing is claimed and nothing is sent", async () => {
    const { ask, sent } = relayFor(async () => ({ delivered: true }))
    for (const kind of ["question", "select", "confirm"] as const) {
      const q = await ask(kind)
      for (const text of ["", " \n\t", "\u200b", " \u200b\u200d\ufeff "]) expect(code(await q.answer(text))).toBe("invalid_arguments")
      expect(await q.state()).toEqual(["pending"])
    }
    expect(sent).toEqual([])
  })

  test("#given input and editor requests #when the answer is empty or a zero-width space #then it is delivered as that value", async () => {
    const { ask, sent } = relayFor(async () => ({ delivered: true }))
    expect(code(await (await ask("input")).answer("\u200b"))).toBe("ok")
    expect(code(await (await ask("editor")).answer(""))).toBe("ok")
    expect(sent).toEqual([{ value: "\u200b" }, { value: "" }])
  })
})

describe("a_question_claimed_before_v3", () => {
  test("#given a row the v2 code left answered mid-claim #when an answer arrives within the in-flight bound, then after it #then it is answer_in_progress, then taken over and delivered once", async () => {
    // given
    const { h, ask, relayOver, sent } = relayFor(async () => ({ delivered: true }))
    const q = await ask()
    downgradeToV2(h.agentDir, (db) => {
      db.run("UPDATE outbox SET question_state = 'answered', answer = 'lost', answered_at = ? WHERE reply_token = ?", [h.clock.now, q.token])
    })
    const upgraded = relayOver()
    const answer = () => upgraded.answer({ binding_id: q.bindingId, reply_token: q.token, answer: "again" })

    // when / then
    expect(code(await answer())).toBe("answer_in_progress")
    h.clock.now += ANSWER_IN_FLIGHT_MAX_MS
    expect(code(await answer())).toBe("ok")
    expect(code(await answer())).toBe("already_answered")
    expect(sent).toEqual([{ value: "again", answers: {}, comment: "again" }])
  })

})

describe("settling_a_claim_in_the_store", () => {
  test("#given a delivered question #when the claim that delivered it is released late, and confirmed again with another answer #then it stays delivered with the first answer", async () => {
    // given
    const { h, ask } = relayFor(async () => ({ delivered: true }))
    const q = await ask("select")
    const store = h.store()
    const claim = await store.claimAnswer({ now: h.clock.now, binding_id: q.bindingId, reply_token: q.token, answer: "first" })
    if (claim.kind !== "ok") throw new Error(JSON.stringify(claim))
    const own = { reply_token: q.token, claimed_at: claim.claimed_at }
    expect(await store.confirmAnswer({ ...own, answer: "first" })).toBe(true)

    // when
    const released = await store.releaseAnswer(own)
    const confirmedAgain = await store.confirmAnswer({ reply_token: q.token, claimed_at: claim.claimed_at + 1, answer: "second" })

    // then
    expect({ released, confirmedAgain }).toEqual({ released: false, confirmedAgain: false })
    expect(rowOf(h.agentDir, q.token)).toEqual({ question_state: "answered", answer_state: "delivered", answer: "first" })
  })
})

/** A session that resolves each request once, as senpi does: a late answer is question_already_resolved. */
function dedupingSession(alreadyResolved: readonly string[] = []) {
  const resolved = new Set(alreadyResolved)
  const handOff: HandOff = async (_fields, uiRequestId) => {
    if (resolved.has(uiRequestId)) return { delivered: false, error: "question_already_resolved" }
    resolved.add(uiRequestId)
    return { delivered: true }
  }
  return { resolved, handOff }
}

describe("an_answer_that_took_over_a_question_the_session_already_resolved", () => {
  test("#given a row the v2 code answered and delivered, and the clock past the in-flight bound #when it is answered twice #then exactly one frame is sent, both answers are already_answered, and the row keeps the old answer, delivered", async () => {
    // given
    const session = dedupingSession(["ui-1"])
    const { h, ask, relayOver, sent } = relayFor(session.handOff)
    const q = await ask()
    downgradeToV2(h.agentDir, (db) => {
      db.run("UPDATE outbox SET question_state = 'answered', answer = 'old answer', answered_at = ? WHERE reply_token = ?", [h.clock.now, q.token])
    })
    h.clock.now += ANSWER_IN_FLIGHT_MAX_MS + 1_000
    const upgraded = relayOver()
    const answer = () => upgraded.answer({ binding_id: q.bindingId, reply_token: q.token, answer: "new answer" })

    // when
    const first = await answer()
    const second = await answer()

    // then
    expect(first).toMatchObject({ kind: "error", error: { code: "already_answered", details: { reason: "question_already_resolved" } } })
    expect(code(second)).toBe("already_answered")
    expect(sent).toHaveLength(1)
    expect(rowOf(h.agentDir, q.token)).toEqual({ question_state: "answered", answer_state: "delivered", answer: "old answer" })
  })

  test("#given a claimant whose frame the session took before the claimant died #when another answer takes the claim over after the bound #then it is already_answered, the row is delivered with the dead claimant's answer, and no later answer sends a frame", async () => {
    // given
    const session = dedupingSession()
    const { h, ask, sent } = relayFor(session.handOff)
    const q = await ask("select")
    const reached = deferred<void>()
    const deadStore = h.store()
    const dead = createGatewayRelay({
      store: deadStore,
      engine: h.engineFor(deadStore),
      endpoints: { wake: async () => ({ admitted: [] }), respondUi: (_endpoint, answer) => { session.resolved.add(answer.ui_request_id); reached.resolve(); return new Promise<UiAnswerReply>(() => {}) } },
      locate: async () => ({ kind: "rpc_host", socket: "fake:B", routing_id: "rpc-1" }),
      now: () => h.clock.now,
    })
    void dead.answer({ binding_id: q.bindingId, reply_token: q.token, answer: "from the dead claimant" })
    await within(reached.promise, "the dead claimant's hand-off")
    h.clock.now += ANSWER_IN_FLIGHT_MAX_MS

    // when
    const takeover = await q.answer("from B")

    // then
    expect(code(takeover)).toBe("already_answered")
    expect(rowOf(h.agentDir, q.token)).toEqual({ question_state: "answered", answer_state: "delivered", answer: "from the dead claimant" })
    expect(code(await q.answer("from C"))).toBe("already_answered")
    expect(sent).toEqual([{ value: "from B" }])
  })

  test("#given a row the v2 code left answered mid-claim #when the taking-over answer is refused as unreadable #then the question goes back to pending, as any refusal that does not mean the session already has an answer", async () => {
    const { h, ask, relayOver } = relayFor(async () => ({ delivered: false, error: "question_incomplete" }))
    const q = await ask()
    downgradeToV2(h.agentDir, (db) => {
      db.run("UPDATE outbox SET question_state = 'answered', answer = 'lost', answered_at = ? WHERE reply_token = ?", [h.clock.now, q.token])
    })
    h.clock.now += ANSWER_IN_FLIGHT_MAX_MS
    const upgraded = relayOver()

    expect(code(await upgraded.answer({ binding_id: q.bindingId, reply_token: q.token, answer: "again" }))).toBe("invalid_arguments")
    expect(rowOf(h.agentDir, q.token)).toEqual({ question_state: "pending", answer_state: null, answer: null })
  })

  test("#given a taking-over claim #when the prior answer is marked delivered under a claim that is not the caller's #then nothing changes", async () => {
    const { h, ask } = relayFor(async () => ({ delivered: true }))
    const q = await ask()
    const store = h.store()
    const claim = await store.claimAnswer({ now: h.clock.now, binding_id: q.bindingId, reply_token: q.token, answer: "mine" })
    if (claim.kind !== "ok") throw new Error(JSON.stringify(claim))

    expect(await store.markPriorDelivered({ reply_token: q.token, claimed_at: claim.claimed_at - 1, prior: { answer: "old", answered_at: 1 } })).toBe(false)
    expect(rowOf(h.agentDir, q.token)).toEqual({ question_state: "answered", answer_state: "in_flight", answer: "mine" })
  })
})

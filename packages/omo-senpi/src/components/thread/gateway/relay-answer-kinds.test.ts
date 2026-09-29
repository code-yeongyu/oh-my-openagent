import { afterEach, describe, expect, test } from "bun:test"

import type { UiAnswerReply } from "./adapter"
import type { AnswerFields, UiRequestKind } from "./answer-shape"
import { createGatewayRelay } from "./relay"
import { ANSWER_IN_FLIGHT_MAX_MS } from "./store-relay-ops"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"

let harness: GatewayHarness | undefined

afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

type HandOff = (fields: AnswerFields) => Promise<UiAnswerReply>

function relayFor(handOff: HandOff) {
  const h = (harness = createGatewayHarness())
  h.session("B")
  const store = h.store()
  const sent: AnswerFields[] = []
  const relay = createGatewayRelay({
    store,
    engine: h.engineFor(store),
    endpoints: {
      wake: async () => ({ admitted: [] }),
      respondUi: async (_endpoint, answer) => {
        sent.push(answer.fields)
        return await handOff(answer.fields)
      },
    },
    locate: async () => ({ kind: "rpc_host", socket: "fake:B", routing_id: "rpc-1" }),
    now: () => h.clock.now,
  })
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
  return { h, relay, sent, ask }
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
    expect(sent).toEqual([{ answers: {}, comment: "second" }])
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

  test("#given a question with no request_kind #when it is answered #then it is a question answer", async () => {
    const { ask, sent } = relayFor(async () => ({ delivered: true }))
    expect(code(await (await ask()).answer("ok"))).toBe("ok")
    expect(sent).toEqual([{ answers: {}, comment: "ok" }])
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

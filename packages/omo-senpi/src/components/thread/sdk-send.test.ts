import { afterEach, describe, expect, test } from "bun:test"
import { sdkOn, type Cleanups } from "./address/testing/entries"
import { createTwoDevices, T } from "./address/testing/two-devices"

const cleanups: Cleanups = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

// T1a of #14943 (the T1b pin of the SDK's send): a send to a thread on another device answers the id of what it sent,
// from the agent's tool (a delivery) and from a script's SDK (the person's prompt), so either caller can name it later.
describe("a send to a thread on another device answers its delivery_id", () => {
  test("#given a live thread on device b #when thread_send and ThreadSdk.send address it #then both answers carry a delivery_id", async () => {
    // given
    const td = createTwoDevices()
    cleanups.push(td.cleanup)

    // when
    const tool = (await td.run("thread_send", { thread: T.bLive, message: "x" })) as {
      readonly kind: string
      readonly delivery_id?: unknown
    }
    const sdk = (await sdkOn(td, cleanups).send({ thread: T.bLive, text: "x" })) as {
      readonly kind: string
      readonly delivery_id?: unknown
    }

    // then
    expect({ tool: tool.kind, sdk: sdk.kind }).toEqual({ tool: "ok", sdk: "ok" })
    expect({ tool: typeof tool.delivery_id, sdk: typeof sdk.delivery_id }).toEqual({ tool: "string", sdk: "string" })
  })

  // #15011: the holder admits a person's prompt once per client message id, so a keyed repeat must carry the same id
  // from any process (a fresh SDK object here), not only from the client whose cache still holds the key.
  test("#given a keyed ThreadSdk.send to device b #when a fresh SDK repeats the key #then both prompts carry one client message id", async () => {
    // given
    const td = createTwoDevices()
    cleanups.push(td.cleanup)

    // when
    await sdkOn(td, cleanups).send({ thread: T.bLive, text: "x", idempotency_key: "k-1" })
    await sdkOn(td, cleanups).send({ thread: T.bLive, text: "x", idempotency_key: "k-1" })

    // then
    const ids = td.account.sent
      .filter((entry) => entry.rpc?.["type"] === "prompt")
      .map((entry) => entry.rpc?.["clientMessageId"])
    expect({ prompts: ids.length, ids: new Set(ids).size }).toEqual({ prompts: 2, ids: 1 })
  })
})

// #15021: one keyed send is one message at the holder whatever adapter and principal carried it, so the id the holder
// admits is derived from the thread and the key: the tool's delivery and the script's prompt to one thread under one key
// carry the same id (the engine's two id books are code-yeongyu/senpi#7479; this device's receipt book is T1b's half).
describe("a keyed send's holder id is derived from the thread and the key (#15021)", () => {
  test("#given one key #when thread_send and ThreadSdk.send address one thread on device b #then the delivery and the prompt carry one id", async () => {
    // given
    const td = createTwoDevices()
    cleanups.push(td.cleanup)

    // when
    await td.run("thread_send", { thread: T.bLive, message: "x", idempotency_key: "k-15021" })
    await sdkOn(td, cleanups).send({ thread: T.bLive, text: "x", idempotency_key: "k-15021" })

    // then
    const sent = td.account.sent.map((entry) => entry.rpc ?? {})
    const delivery = sent.filter((rpc) => rpc["type"] === "admit_external_message").map((rpc) => rpc["deliveryId"])
    const prompt = sent.filter((rpc) => rpc["type"] === "prompt").map((rpc) => rpc["clientMessageId"])
    expect({ delivery: delivery.length, prompt: prompt.length, same: delivery[0] === prompt[0] }).toEqual({
      delivery: 1,
      prompt: 1,
      same: true,
    })
  })
})

type Answer = {
  readonly kind: string
  readonly delivery?: { readonly kind?: string }
  readonly error?: { readonly code?: string }
}
const outcome = (answer: Answer): string =>
  answer.kind === "ok" ? `ok ${answer.delivery?.kind ?? "?"}` : String(answer.error?.code ?? answer.kind)

// The steer contract by principal (design ruling of record on #14943, issue #15007): a session must name the turn it
// steers; a person or script may omit it, and the core then steers the running turn, on every leg.
describe("a steer without expected_turn_id, by principal and by leg", () => {
  test.each([
    ["a session (thread_send)", "here", "invalid_arguments", T.hereSlash],
    ["a session (thread_send)", "device b", "invalid_arguments", T.bLive],
    ["a script (ThreadSdk.send)", "device b", "ok steered", T.bLive],
  ] as const)(
    "#given %s steering a thread on %s with no turn id #then it answers %s",
    async (who, _leg, want, thread) => {
      const td = createTwoDevices({ bRunning: true })
      cleanups.push(td.cleanup)
      const answer = who.startsWith("a session")
        ? ((await td.run("thread_send", { thread, message: "x", delivery: "steer" })) as Answer)
        : ((await sdkOn(td, cleanups).send({ thread, text: "x", mode: "steer" })) as Answer)
      expect(outcome(answer)).toBe(want)
    },
  )

  test("#given a script steering a session here that runs turn 7, with no turn id #then it steers that turn, as naming turn 7 does", async () => {
    // given
    const td = createTwoDevices()
    cleanups.push(td.cleanup)
    const sdk = sdkOn(td, cleanups, { runningTurn: "7" })

    // when
    const unnamed = (await sdk.send({ thread: T.hereSlash, text: "x", mode: "steer" })) as Answer
    const named = (await sdk.send({ thread: T.hereSlash, text: "y", mode: "steer", expected_turn_id: 7 })) as Answer

    // then
    expect(outcome(unnamed)).not.toBe("invalid_arguments")
    expect(outcome(unnamed)).toBe(outcome(named))
  })
})

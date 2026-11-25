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

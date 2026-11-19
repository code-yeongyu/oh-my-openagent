import { afterEach, describe, expect, test } from "bun:test"
import { DEFAULT_THREAD_DELIVERY, ThreadDeliveryMode } from "./contracts"
import { ENGINE, createRemoteThreadFixture } from "./thread-remote-fixture"

/**
 * #14333: a send that names no delivery mode steers a running turn and starts an idle one on every surface, from the
 * ONE default the schema declares; follow_up is only ever asked for. The SDK leg is pinned in `sdk.test.ts`, the CLI
 * legs in `omo-native/remote-session-verbs.test.ts`.
 */
const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

const ADMIT = "admit_external_message"
type SentRecord = { readonly rpc?: Readonly<Record<string, unknown>> }
const admits = (sent: readonly SentRecord[]) =>
  sent.filter((entry) => entry.rpc?.["type"] === ADMIT).map((entry) => entry.rpc ?? {})
const MID_TURN = { ...ENGINE, streaming: true, pending: 0, currentTurnId: "3" }

describe("#14333: the default delivery mode is auto on every send surface", () => {
  test("#given the delivery field #when its schema is read #then it declares the one shared default, auto", () => {
    expect(DEFAULT_THREAD_DELIVERY).toBe("auto")
    expect((ThreadDeliveryMode as { default?: unknown }).default).toBe("auto")
  })

  test.each(["thread_send", "thread_handoff"] as const)(
    "#given a receiver mid-turn #when %s names no mode #then it steers that turn and the header names auto as requested",
    async (tool) => {
      const a = account({ engine: MID_TURN })
      const { run } = surface(a.remote)
      expect(await run(tool, { thread: "dur-on-b", message: "x" })).toMatchObject({
        kind: "ok",
        delivery: { kind: "steered", turn_id: "3" },
      })
      const [record = {}] = admits(a.sent)
      expect(record["deliverAs"]).toBe("steer")
      expect(String(record["text"])).toContain(" requested=auto effective=steer ")
    },
  )

  test.each(["thread_send", "thread_handoff"] as const)(
    "#given an idle receiver #when %s names no mode #then it starts a turn there, on the followUp lane that starts an idle session",
    async (tool) => {
      const a = account()
      const { run } = surface(a.remote)
      expect(await run(tool, { thread: "dur-on-b", message: "x" })).toMatchObject({
        kind: "ok",
        delivery: { kind: "started" },
        effective_mode: "follow_up",
      })
      const [record = {}] = admits(a.sent)
      expect(String(record["text"])).toContain(" requested=auto effective=follow_up ")
    },
  )

  test("#given a receiver mid-turn #when thread_send asks for follow_up #then the message queues behind that turn instead of steering it", async () => {
    const a = account({ engine: MID_TURN })
    const { run } = surface(a.remote)
    const sent = await run("thread_send", { thread: "dur-on-b", message: "x", delivery: "follow_up" })
    expect(sent).toMatchObject({ kind: "ok", effective_mode: "follow_up" })
    const [record = {}] = admits(a.sent)
    expect(record["deliverAs"]).toBe("followUp")
    expect(String(record["text"])).toContain(" requested=follow_up effective=follow_up ")
  })
})

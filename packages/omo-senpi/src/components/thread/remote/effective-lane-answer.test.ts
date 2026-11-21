import { afterEach, describe, expect, test } from "bun:test"
import type { JsonObject } from "./ports"
import { B_ROW, createRemoteThreadFixture } from "../thread-remote-fixture"

/**
 * #14333, relay leg: the lane a result names is the one the receiver's answer proves. The probe before the send only
 * chooses what to ask for, and a turn can begin or end before the record lands.
 */
const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

const ADMIT = "admit_external_message"
const answered = (data: JsonObject) =>
  ({ kind: "ok", response: { type: "response", id: null, command: ADMIT, success: true, data } }) as const
const LOST_PROBE = { kind: "uncertain", reason: "timeout" } as const
const ENDED = "0195f0c2-1a2b-7c3d-8e4f-00000000e001"
const WOKEN = { rows: [B_ROW], ended: { b: { [ENDED]: "rk-ended" } }, wakeFeature: true } as const
const types = (sent: readonly { readonly rpc?: Readonly<Record<string, unknown>> }[]) =>
  sent.map((entry) => entry.rpc?.["type"])

describe("#14333: the relay result's effective_mode follows the receiver's answer", () => {
  test("#given the state probe is lost #when thread_send asks for follow_up #then the message is still sent and the answer names its lane", async () => {
    const a = account({ stateOutcomes: [LOST_PROBE] })
    const { run } = surface(a.remote)
    const sent = await run("thread_send", { thread: "dur-on-b", message: "x", delivery: "follow_up" })
    expect(sent).toMatchObject({ kind: "ok", delivery: { kind: "started" }, effective_mode: "start" })
    expect(types(a.sent)).toContain(ADMIT)
  })

  test("#given the state probe is lost #when thread_send names no mode #then nothing is sent, because the default needs the probe to pick its lane", async () => {
    const a = account({ stateOutcomes: [LOST_PROBE] })
    const { run } = surface(a.remote)
    const sent = await run("thread_send", { thread: "dur-on-b", message: "x" })
    expect(sent).toMatchObject({ kind: "error", error: { code: "host_unavailable" } })
    expect(types(a.sent)).not.toContain(ADMIT)
  })

  test("#given the probe saw an idle receiver #when a turn began first and the receiver answers queued #then the result says follow_up, not start", async () => {
    const a = account({ admitOutcome: answered({ kind: "queued" }) })
    const { run } = surface(a.remote)
    const sent = await run("thread_send", { thread: "dur-on-b", message: "x" })
    expect(sent).toMatchObject({ kind: "ok", delivery: { kind: "queued" }, effective_mode: "follow_up" })
  })

  test("#given the receiver already holds the delivery #when it answers already_admitted #then the result is queued on the follow_up lane", async () => {
    const a = account({ admitOutcome: answered({ kind: "already_admitted" }) })
    const { run } = surface(a.remote)
    const sent = await run("thread_send", { thread: "dur-on-b", message: "x" })
    expect(sent).toMatchObject({
      kind: "ok",
      delivery: { kind: "queued" },
      deduplicated: true,
      effective_mode: "follow_up",
    })
  })

  test.each(["hold", "approval"] as const)(
    "#given a woken session that waits on a %s #when the wake path answers queued #then the result says follow_up: nothing starts until it lifts",
    async (wait) => {
      const a = account({ ...WOKEN, wakeOutcome: answered({ kind: "queued", waiting_on: { kind: wait } }) })
      const { run } = surface(a.remote)
      const sent = await run("thread_send", { thread: ENDED, message: "x" })
      expect(sent).toMatchObject({
        kind: "ok",
        delivery: { kind: "queued", waiting_on: { kind: wait } },
        effective_mode: "follow_up",
      })
    },
  )
})

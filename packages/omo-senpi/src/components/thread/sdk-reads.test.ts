import { afterEach, describe, expect, test } from "bun:test"

import { assembleOmoSdk } from "../omo-sdk/assembly"
import { createRemoteThreadFixture } from "./thread-remote-fixture"

// #14951: the reads the SDK lacked (threads.receipt, threads.readAfterWait, threads.messages) on the root, each the
// thread core's one body the tool runs, on this device (dur-local) and on device b (dur-on-b).

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

function rootOn() {
  const a = account()
  const s = surface(a.remote)
  const root = assembleOmoSdk(
    {
      agentDir: s.agentDir,
      cwd: process.cwd(),
      uid: 501,
      user: "qa",
      ports: { host: s.host, store: s.store, remote: a.remote },
    },
    {},
  )
  return { a, s, root }
}

describe("threads.receipt", () => {
  test("#given the root sent to a thread on this device #when it asks for that delivery's receipt #then it answers the delivery's outcome, as thread_read's receipt branch does for its caller", async () => {
    const { root } = rootOn()
    const sent = (await root.threads.send({ thread: "dur-local", message: "receipt me" })) as { delivery_id?: string }
    const receipt = await root.threads.receipt({ thread: "dur-local", delivery_id: String(sent.delivery_id) })
    expect(receipt).toMatchObject({
      kind: "ok",
      thread: "dur-local",
      delivery_id: sent.delivery_id,
      outcome: { kind: "pending" },
    })
  })

  test("#given a delivery id the root never sent #when it asks for its receipt #then outcome_unavailable, and nothing is read or sent", async () => {
    const { root, a } = rootOn()
    const before = a.sent.length
    expect(await root.threads.receipt({ thread: "dur-local", delivery_id: "dlv-nobody" })).toMatchObject({
      kind: "ok",
      outcome: { kind: "outcome_unavailable" },
    })
    expect(a.sent.length).toBe(before)
  })
})

describe("threads.readAfterWait", () => {
  test.each(["dur-local", "dur-on-b"])(
    "#given an idle thread %s #when the root reads after a wait #then it answers the transcript with the wait block, as thread_read's wait branch does",
    async (thread) => {
      const { root, s } = rootOn()
      const unmeasured = (answer: unknown) => {
        const { wait, ...rest } = answer as { readonly wait?: Record<string, unknown> }
        return { ...rest, wait: wait === undefined ? undefined : { ...wait, waited_ms: 0 } }
      }
      const viaRoot = unmeasured(await root.threads.readAfterWait({ thread, wait_ms: 1 }))
      const viaTool = unmeasured(await s.run("thread_read", { thread, wait_ms: 1 }))
      expect(viaRoot.wait).toBeDefined()
      expect(viaRoot).toEqual(viaTool)
    },
  )
})

describe("threads.messages", () => {
  test.each(["dur-local", "dur-on-b"])(
    "#given a live thread %s #when the root asks for its messages #then it answers the engine's whole message list",
    async (thread) => {
      const { root } = rootOn()
      const answer = (await root.threads.messages({ thread })) as { kind: string; messages?: readonly unknown[] }
      expect(answer.kind).toBe("ok")
      expect(answer.messages?.length).toBeGreaterThan(0)
    },
  )

  test("#given an address nothing holds #when the root asks for its messages #then not_found, as every control answers it", async () => {
    const { root } = rootOn()
    expect(await root.threads.messages({ thread: "nobody-here" })).toMatchObject({
      kind: "error",
      error: { code: "not_found" },
    })
  })
})

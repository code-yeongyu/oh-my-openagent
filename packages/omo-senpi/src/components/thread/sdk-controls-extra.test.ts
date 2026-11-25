import { afterEach, describe, expect, test } from "bun:test"

import { assembleOmoSdk } from "../omo-sdk/assembly"
import { createRemoteThreadFixture } from "./thread-remote-fixture"

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

function world() {
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

describe("threads.setReasoning and threads.archive: the tools' bodies on the root (#14951)", () => {
  test.each(["dur-local", "dur-on-b"])(
    "#given thread %s #when the root sets its reasoning #then the same answer as thread_set_reasoning",
    async (thread) => {
      const viaRoot = await world().root.threads.setReasoning({ thread, level: "high" })
      const viaTool = await world().s.run("thread_set_reasoning", { thread, level: "high" })
      expect(viaRoot as unknown).toEqual(viaTool)
      expect(viaRoot).toMatchObject({ kind: "ok" })
    },
  )

  test("#given a level the engine does not support #when the root sets it #then the tool's typed refusal", async () => {
    const viaRoot = await world().root.threads.setReasoning({ thread: "dur-local", level: "max" as never })
    const viaTool = await world().s.run("thread_set_reasoning", { thread: "dur-local", level: "max" })
    expect(viaRoot as unknown).toEqual(viaTool)
  })

  test.each(["dur-local", "dur-on-b"])(
    "#given thread %s #when the root archives it #then the same answer as thread_archive, and archived: false restores it",
    async (thread) => {
      const { root } = world()
      const timeless = (answer: unknown) => ({ ...(answer as object), created_at: "<time>", updated_at: "<time>" })
      const viaRoot = await root.threads.archive({ thread })
      const viaTool = await world().s.run("thread_archive", { thread })
      expect(timeless(viaRoot)).toEqual(timeless(viaTool))
      expect(await root.threads.archive({ thread, archived: false })).toMatchObject({ kind: "ok", archived: false })
    },
  )

  test("#given a keyed archive #when it is repeated under the key #then the first answer and one effect", async () => {
    const { root, s } = world()
    const first = await root.threads.archive({ thread: "dur-local", idempotency_key: "k-arch" })
    const again = await root.threads.archive({ thread: "dur-local", idempotency_key: "k-arch" })
    expect(again).toEqual(first)
    expect(s.archived.length).toBe(1)
  })
})

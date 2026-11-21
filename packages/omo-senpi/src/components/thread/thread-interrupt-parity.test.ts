import { afterEach, describe, expect, test } from "bun:test"
import { comparable, createRemoteThreadFixture, ENGINE } from "./thread-remote-fixture"

const { account, surface, cleanup } = createRemoteThreadFixture()

afterEach(cleanup)

const RUNNING = {
  ...ENGINE,
  streaming: true,
  interrupt: {
    interrupted: true,
    turnId: "7",
    background: {
      stopped: [{ kind: "bash", id: "bash_1", description: "sleep 60" }],
      failed: [{ kind: "bash", id: "bash_c1_2", description: "watch", reason: "runs on the session's tool child" }],
    },
  },
}

const EXPECTED = {
  kind: "ok",
  turn_id: "7",
  interrupted: true,
  background: {
    status: "stopped",
    stopped: [{ kind: "bash", id: "bash_1", description: "sleep 60" }],
    failed: [{ kind: "bash", id: "bash_c1_2", description: "watch", reason: "runs on the session's tool child" }],
  },
}

describe("thread_interrupt: LOCAL and REMOTE are one implementation", () => {
  test.each([
    ["LOCAL", "dur-local"],
    ["REMOTE", "dur-on-b"],
  ] as const)(
    "#given a running turn that left a background bash #when thread_interrupt runs %s #then one interrupt record asks the engine to stop the turn's background jobs and the answer names what it stopped",
    async (leg, thread) => {
      const a = account({ engine: RUNNING })
      const { run, interrupts } = surface(a.remote, { engine: RUNNING })

      const result = await run("thread_interrupt", { thread, turn_id: "7" })

      const received =
        leg === "LOCAL"
          ? interrupts
          : a.sent.flatMap((entry) => (entry.rpc?.["type"] === "interrupt" ? [entry.rpc] : []))
      expect(received).toEqual([expect.objectContaining({ type: "interrupt", turnId: "7", background: "stop" })])
      expect(comparable(result)).toEqual(EXPECTED)
    },
  )

  test("#given an engine that predates the background stop #when thread_interrupt runs on either leg #then both answer not_supported with the same shape", async () => {
    const legacy = { ...ENGINE, interrupt: { interrupted: true, turnId: "7" } }
    const a = account({ engine: legacy })
    const { run } = surface(a.remote, { engine: legacy })
    const here = await run("thread_interrupt", { thread: "dur-local" })
    const there = await run("thread_interrupt", { thread: "dur-on-b" })
    expect(comparable(here)).toEqual({
      kind: "ok",
      turn_id: "7",
      interrupted: true,
      background: { status: "not_supported" },
    })
    expect(comparable(there)).toEqual(comparable(here))
  })
})

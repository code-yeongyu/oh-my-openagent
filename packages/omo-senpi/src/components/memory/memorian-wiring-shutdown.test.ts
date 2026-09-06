import { PendingNudges } from "@oh-my-opencode/memory-core"
import { CANDIDATE_PATH, roots, SESSION_ID, context, gate } from "./memorian-wiring.test-support"
import { afterEach, describe, expect, test } from "bun:test"
import { rmEfaultTolerant } from "./teardown.test-support"

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rmEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))) })

describe("createMemorianGateWiring shutdown", () => {
  test("#given an active session #when shutdown runs #then the runner cancels, drains, and clears its compaction epoch", async () => {
    // given
    const identity = await context()
    const calls: string[] = []
    const wiring = gate({
      collect: async () => undefined,
      launches: [],
      identity,
      cancel: async () => { calls.push("cancel") },
      whenIdle: async () => { calls.push("idle") },
    })
    wiring.onCompactionAccepted(SESSION_ID)
    expect(wiring.currentCompactionEpoch(SESSION_ID)).toBe(1)

    // when
    await wiring.onSessionShutdown(SESSION_ID)

    // then
    expect(calls).toEqual(["cancel", "idle"])
    expect(wiring.currentCompactionEpoch(SESSION_ID)).toBe(0)
  })
})

describe("createMemorianGateWiring onCompactionAccepted", () => {
  test("#given pending nudges #when a compaction is accepted #then they are dropped instead of surfacing after the rewrite", async () => {
    // given: the nudges judged the pre-compaction transcript, which no longer exists
    const identity = await context()
    const pending = new PendingNudges(identity.identityPaths.recallPending)
    await pending.write(SESSION_ID, [{ path: CANDIDATE_PATH, hint: "Drain nodes first." }], { epoch: 0 })
    const wiring = gate({ collect: async () => undefined, launches: [], identity })

    // when
    wiring.onCompactionAccepted(SESSION_ID)
    await wiring.whenIdle()

    // then
    expect(await pending.take(SESSION_ID, { currentEpoch: 0 })).toEqual([])
  })

  test("#given another session's pending nudges #when a compaction is accepted #then they survive untouched", async () => {
    // given
    const identity = await context()
    const pending = new PendingNudges(identity.identityPaths.recallPending)
    await pending.write("other-session", [{ path: CANDIDATE_PATH, hint: "Drain nodes first." }], { epoch: 0 })
    const wiring = gate({ collect: async () => undefined, launches: [], identity })

    // when
    wiring.onCompactionAccepted(SESSION_ID)
    await wiring.whenIdle()

    // then
    expect(await pending.take("other-session", { currentEpoch: 0 })).toEqual([
      { path: CANDIDATE_PATH, hint: "Drain nodes first." },
    ])
  })
})

describe("createMemorianGateWiring currentCompactionEpoch", () => {
  test("#given an untouched session #when its epoch is read #then it is the launch-time default", async () => {
    // given: the consumer needs the SAME epoch source the launch stamps into the payload
    const identity = await context()
    const wiring = gate({ collect: async () => undefined, launches: [], identity })

    // when / then
    expect(wiring.currentCompactionEpoch(SESSION_ID)).toBe(0)
  })

  test("#given accepted compactions #when the epoch is read #then it reflects every bump for that session alone", async () => {
    // given
    const identity = await context()
    const wiring = gate({ collect: async () => undefined, launches: [], identity })

    // when
    wiring.onCompactionAccepted(SESSION_ID)
    wiring.onCompactionAccepted(SESSION_ID)
    await wiring.whenIdle()

    // then
    expect(wiring.currentCompactionEpoch(SESSION_ID)).toBe(2)
    expect(wiring.currentCompactionEpoch("other-session")).toBe(0)
  })
})

import { afterEach, describe, expect, test } from "bun:test"
import { PendingNudges } from "@oh-my-opencode/memory-core"
import { ModelRegistry, ModelRuntime } from "../../senpi-test-runtime"
import { createMemorianGateWiring, type MemorianGatePort } from "./memorian-wiring"
import { CANDIDATES, CANDIDATE_PATH, roots, SESSION_ID, context, gate, collected } from "./memorian-wiring.test-support"
import type { CollectedRecallCandidates } from "./recall-wiring"
import type { MemoryIdentityContext } from "./context"
import type { RecallCandidate } from "@oh-my-opencode/memory-core"

type Launch = Parameters<MemorianGatePort["launch"]>[0]
import { rmEfaultTolerant } from "./teardown.test-support"

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rmEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))) })

describe("createMemorianGateWiring onSettled", () => {
  test("#given collected candidates #when a turn settles #then the gate child launches with the judge's inputs", async () => {
    // given
    const identity = await context()
    const launches: Launch[] = []
    const wiring = gate({ collect: async () => collected(identity), launches })

    // when
    wiring.onSettled({})
    await wiring.whenIdle()

    // then
    expect(launches).toHaveLength(1)
    expect(launches[0]).toMatchObject({
      sessionId: SESSION_ID,
      candidates: CANDIDATES,
      surfaced: new Set<string>(),
      maxItems: 2,
      transcript: [{ role: "user", text: "how do we handle kubernetes rollouts" }],
    })
  })

  test("#given a gate child in flight #when a compaction is accepted mid-flight #then the launch's epoch check reports the verdict as stale", async () => {
    // given: a child judging transcript T1 can finish AFTER a compaction rewrote T1. The wiring
    // stamps the launch with the session's compaction epoch and exposes the live one, so the
    // runner can discard a verdict that outlived its transcript.
    const identity = await context()
    const launches: Launch[] = []
    let observedInFlight: { captured: number, current: number } | undefined
    const wiring = gate({
      collect: async () => collected(identity),
      launches,
      identity,
      launch: async (launchInput) => {
        launches.push(launchInput)
        // Simulate the mid-flight compaction: it lands while the child is still running.
        wiring.onCompactionAccepted(SESSION_ID)
        observedInFlight = {
          captured: launchInput.compactionEpoch ?? -1,
          current: launchInput.currentCompactionEpoch?.() ?? -1,
        }
        return { status: "empty" as const }
      },
    })

    // when
    wiring.onSettled({})
    await wiring.whenIdle()

    // then
    expect(launches).toHaveLength(1)
    expect(observedInFlight).toBeDefined()
    expect(observedInFlight?.current).toBeGreaterThan(observedInFlight?.captured ?? 0)
  })

  test("#given no compaction #when a gate child runs to completion #then the captured and live epochs match", async () => {
    // given
    const identity = await context()
    const launches: Launch[] = []
    const wiring = gate({ collect: async () => collected(identity), launches, identity })

    // when
    wiring.onSettled({})
    await wiring.whenIdle()

    // then
    const launch = launches[0]
    expect(launch?.compactionEpoch).toBe(0)
    expect(launch?.currentCompactionEpoch?.()).toBe(0)
  })

  test("#given repeated skipped outcomes with one cause #when turns settle #then one gate entry is appended for the session", async () => {
    const identity = await context()
    const entries: Array<{ customType: string; data: unknown }> = []
    const wiring = gate({
      collect: async () => collected(identity),
      launches: [],
      entries,
      launch: async () => ({ status: "skipped", cause: "quick_category_unavailable", candidateCount: 1 }),
    })

    wiring.onSettled({})
    await wiring.whenIdle()
    wiring.onSettled({})
    await wiring.whenIdle()
    wiring.onSettled({})
    await wiring.whenIdle()

    expect(entries).toEqual([{
      customType: "omo-memorian:gate",
      data: { version: 1, status: "skipped", cause: "quick_category_unavailable", candidateCount: 1 },
    }])
  })

  test("#given no collected candidates #when a turn settles #then no gate child launches", async () => {
    // given: collection already encodes the recall.enabled gate, the sentinel gate and empty matches
    const launches: Launch[] = []
    const wiring = gate({ collect: async () => undefined, launches })

    // when
    wiring.onSettled({})
    await wiring.whenIdle()

    // then
    expect(launches).toEqual([])
  })

  test("#given a settle handler #when the launch rejects #then the turn is unaffected and the failure is logged", async () => {
    // given
    const identity = await context()
    const logs: Array<{ message: string, details?: unknown }> = []
    const wiring = gate({
      collect: async () => collected(identity),
      launches: [],
      launch: async () => {
        throw new Error("gate exploded")
      },
      logs,
    })

    // when
    wiring.onSettled({})
    await wiring.whenIdle()

    // then
    expect(logs).toHaveLength(1)
  })

  test("#given a ctx that goes stale once the handler returns #when a turn settles #then the launch still uses the snapshotted registry", async () => {
    // given: the real senpi ctx is invalidated by AgentSession dispose the moment the settle
    // handler returns, so any ctx read from the detached task throws assertActive's stale error.
    const identity = await context()
    const registry = new ModelRegistry(ModelRuntime.createSync({ modelsPath: null }))
    let stale = false
    const eventCtx = {
      get modelRegistry(): unknown {
        if (stale) throw new Error("This extension ctx is stale after session replacement or reload.")
        return registry
      },
    }
    const launches: Launch[] = []
    const logs: Array<{ message: string, details?: unknown }> = []
    const wiring = createMemorianGateWiring({
      // Collection is handed the snapshot, never the live ctx.
      snapshotSession: () => ({ id: SESSION_ID, entries: [] }),
      collectCandidatesFromSnapshot: async () => collected(identity),
      resolveContext: () => identity,
      runnerFor: () => ({
        launch: async (launchInput) => {
          launches.push(launchInput)
          return { status: "empty" as const }
        },
      }),
      resolveModelRegistry: (ctx) => (ctx as { modelRegistry?: unknown }).modelRegistry as never,
      logger: {
        info: (message, details) => logs.push({ message, details }),
        warn: (message, details) => logs.push({ message, details }),
        error: (message, details) => logs.push({ message, details }),
      },
    })

    // when: the handler returns, THEN the host disposes the ctx
    wiring.onSettled(eventCtx)
    stale = true
    await wiring.whenIdle()

    // then: the gate still launched, carrying the registry captured before dispose
    expect(logs).toEqual([])
    expect(launches).toHaveLength(1)
    expect(launches[0]?.modelRegistry).toBe(registry)
  })

  test("#given an incomplete session snapshot #when the ctx is invalidated after the handler returns #then the gate no-ops with a warning and never rereads the ctx", async () => {
    // given: snapshotSession returns undefined for a ctx that carries no usable session. The
    // detached task must NOT fall back to collectCandidates(eventCtx): by then the host has run
    // AgentSession dispose and every ctx read throws.
    const identity = await context()
    let stale = false
    let ctxReads = 0
    const eventCtx = {
      get session(): unknown {
        ctxReads += 1
        if (stale) throw new Error("This extension ctx is stale after session replacement or reload.")
        return undefined
      },
    }
    const launches: Launch[] = []
    const logs: Array<{ message: string, details?: unknown }> = []
    const wiring = createMemorianGateWiring({
      snapshotSession: (ctx) => {
        void (ctx as { session?: unknown }).session
        return undefined
      },
      collectCandidatesFromSnapshot: async () => collected(identity),
      resolveContext: () => identity,
      runnerFor: () => ({
        launch: async (launchInput) => {
          launches.push(launchInput)
          return { status: "empty" as const }
        },
      }),
      logger: {
        info: (message, details) => logs.push({ message, details }),
        warn: (message, details) => logs.push({ message, details }),
        error: (message, details) => logs.push({ message, details }),
      },
    })

    // when: the handler returns, THEN the host disposes the ctx
    wiring.onSettled(eventCtx)
    stale = true
    await wiring.whenIdle()

    // then: clean no-op - exactly the one synchronous snapshot read, no launch, one warning
    expect(ctxReads).toBe(1)
    expect(launches).toEqual([])
    expect(logs.map((entry) => entry.message)).toEqual(["omo-senpi memorian gate session snapshot incomplete"])
  })

  test("#given a settle #when the handler returns #then it never waits on the gate child", async () => {
    // given: the settle path must not block on an advisory read
    const identity = await context()
    let released = (): void => {}
    const blocked = new Promise<void>((resolve) => {
      released = resolve
    })
    const wiring = gate({
      collect: async () => collected(identity),
      launches: [],
      launch: async () => {
        await blocked
        return { status: "empty" as const }
      },
    })

    // when
    const returned = wiring.onSettled({})

    // then
    expect(returned).toBeUndefined()
    released()
    await wiring.whenIdle()
  })
})

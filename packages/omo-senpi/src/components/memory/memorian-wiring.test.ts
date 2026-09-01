import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { PendingNudges, buildIdentityPaths, type RecallCandidate } from "@oh-my-opencode/memory-core"

import { createMemoryBinding } from "./binding"
import { createMemoryIdentityContext, type MemoryIdentityContext } from "./context"
import { createMemorianGateWiring, type MemorianGatePort } from "./memorian-wiring"
import type { CollectedRecallCandidates } from "./recall-wiring"
import { rmEfaultTolerant } from "./teardown.test-support"

const IDENTITY = "memorian-agent"
const SESSION_ID = "session-gate-1"
const CANDIDATE_PATH = "reference/kubernetes-rollouts.md"
const roots: string[] = []

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rmEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })),
  )
})

const CANDIDATES: readonly RecallCandidate[] = [
  { path: CANDIDATE_PATH, description: "Rollout policy", excerpt: "drain first", score: 1 },
]

async function context(): Promise<MemoryIdentityContext> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memorian-wiring-")))
  roots.push(root)
  return createMemoryIdentityContext({
    identity: IDENTITY,
    identityPaths: buildIdentityPaths(root, IDENTITY),
    binding: createMemoryBinding({ identity: IDENTITY, repoPath: join(root, "repo"), boundAt: 0 }),
  })
}

function collected(identity: MemoryIdentityContext): CollectedRecallCandidates {
  return {
    sessionId: SESSION_ID,
    context: identity,
    candidates: CANDIDATES,
    surfaced: new Set<string>(),
    maxItems: 2,
    transcript: [{ role: "user", text: "how do we handle kubernetes rollouts" }],
  }
}

type Launch = Parameters<MemorianGatePort["launch"]>[0]

function gate(input: {
  readonly collect: () => Promise<CollectedRecallCandidates | undefined>
  readonly launches: Launch[]
  readonly identity?: MemoryIdentityContext
  readonly launch?: MemorianGatePort["launch"]
  readonly logs?: Array<{ message: string, details?: unknown }>
}) {
  return createMemorianGateWiring({
    snapshotSession: () => ({ id: SESSION_ID, entries: [] }),
    collectCandidatesFromSnapshot: input.collect,
    resolveContext: (sessionId) => (sessionId === SESSION_ID ? input.identity : undefined),
    runnerFor: () => ({
      launch: input.launch ?? (async (launchInput) => {
        input.launches.push(launchInput)
        return { status: "empty" as const }
      }),
    }),
    ...(input.logs === undefined
      ? {}
      : {
          logger: {
            info: (message, details) => input.logs?.push({ message, details }),
            warn: (message, details) => input.logs?.push({ message, details }),
            error: (message, details) => input.logs?.push({ message, details }),
          },
        }),
  })
}

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
    const registry = { getAvailable: () => [], find: () => undefined }
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

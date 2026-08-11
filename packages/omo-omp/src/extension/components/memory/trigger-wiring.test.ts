import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  buildIdentityPaths,
  ReflectionReservationStore,
  TranscriptJournal,
  type MemoryIdentity,
  type ReflectionRequest,
} from "@oh-my-opencode/memory-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { MemoryPendingLedger } from "./context"
import { memorySettings } from "./memory.test-support"
import {
  createReflectionTriggerWiring,
  resolveReflectionTriggerConfig,
  type ReflectionTriggerSession,
} from "./trigger-wiring"

const CONVERSATION = "conversation-a"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

type Fixture = {
  readonly pi: FakeExtensionAPI
  readonly ledger: MemoryPendingLedger
  readonly store: ReflectionReservationStore
  readonly launches: ReflectionRequest[]
  readonly logs: Array<{ level: string; message: string; details?: unknown }>
  readonly wiring: ReturnType<typeof createReflectionTriggerWiring>
}

async function fixture(options: {
  readonly stepCount?: number
  readonly onCompaction?: boolean
  readonly steps?: number
  readonly onLaunch?: (request: ReflectionRequest) => void
  readonly withoutLaunchHandler?: boolean
  readonly session?: ReflectionTriggerSession | undefined
} = {}): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "omo-trigger-wiring-"))
  roots.push(root)
  const identity: MemoryIdentity = { id: "agent-test", safeSlug: "agent-test", paths: buildIdentityPaths(root, "agent-test") }
  const journal = new TranscriptJournal({ journalDir: join(identity.paths.transcripts, CONVERSATION) })
  await journal.reconcile(
    Array.from({ length: options.steps ?? 2 }, (_value, index) => ({
      kind: "assistant" as const,
      messageId: `assistant-${index + 1}`,
      textBlocks: [`step ${index + 1}`],
    })),
  )
  let nextRunId = 0
  const store = new ReflectionReservationStore({
    identity,
    config: { stepCount: options.stepCount ?? 1, onCompaction: options.onCompaction ?? true },
    getJournal: async (conversationId) => {
      if (conversationId !== CONVERSATION) throw new Error(`missing journal: ${conversationId}`)
      return journal
    },
    createRunId: () => `run-${++nextRunId}`,
  })

  const ledger: MemoryPendingLedger = { pendingCompaction: false, configRestartNotified: false }
  const launches: ReflectionRequest[] = []
  const logs: Array<{ level: string; message: string; details?: unknown }> = []
  const session: ReflectionTriggerSession = { conversationId: CONVERSATION, ledger, engine: store }
  const resolvedSession = "session" in options ? options.session : session

  const pi = new FakeExtensionAPI()
  const wiring = createReflectionTriggerWiring({
    resolveSession: () => resolvedSession,
    ...(options.withoutLaunchHandler === true
      ? {}
      : { onLaunch: options.onLaunch ?? ((request: ReflectionRequest) => void launches.push(request)) }),
    logger: {
      info: (message, details) => logs.push({ level: "info", message, details }),
      warn: (message, details) => logs.push({ level: "warn", message, details }),
      error: (message, details) => logs.push({ level: "error", message, details }),
    },
  })
  wiring.register(pi)
  return { pi, ledger, store, launches, logs, wiring }
}

async function agentEnd(pi: FakeExtensionAPI, payload: Record<string, unknown> = {}): Promise<void> {
  await pi.dispatch("agent_end", { type: "agent_end", messages: [], ...payload })
}

async function settle(pi: FakeExtensionAPI): Promise<void> {
  await pi.dispatch("agent_settled", { type: "agent_settled" })
}

async function successfulSettle(pi: FakeExtensionAPI): Promise<void> {
  await agentEnd(pi)
  await settle(pi)
}

async function compact(pi: FakeExtensionAPI, accepted: boolean): Promise<void> {
  await pi.dispatch(
    "session_compact",
    accepted
      ? { type: "session_compact", reason: "auto", requestId: "compact-1", accepted: true, fromExtension: false, willRetry: true }
      : { type: "session_compact", reason: "manual", requestId: "compact-1", accepted: false, rejectionCause: "cancelled-by-extension", fromExtension: false, willRetry: false },
  )
}

describe("reflection trigger wiring", () => {
  test("#given a met step threshold #when a clean run settles #then exactly one step-count launch fires with no visible message", async () => {
    const { pi, launches, store } = await fixture({ stepCount: 1 })

    await successfulSettle(pi)

    expect(launches).toHaveLength(1)
    expect(launches[0]?.trigger).toBe("step-count")
    expect(launches[0]?.conversationIds).toEqual([CONVERSATION])
    expect(launches[0]?.snapshots[0]?.snapshot.end_message_id).toBe("assistant-2")
    expect((await store.readState()).active?.request.trigger).toBe("step-count")
    expect(pi.messages).toEqual([])
    expect(pi.userMessages).toEqual([])
  })

  test("#given the wiring #when registered #then it observes only agent_end, agent_settled and session_compact", async () => {
    const { pi } = await fixture()

    expect(pi.handlers.map((registration) => registration.event)).toEqual([
      "agent_end",
      "agent_settled",
      "session_compact",
    ])
    expect(pi.commands).toEqual([])
    expect(pi.tools).toEqual([])
  })

  test("#given a zero step threshold #when a clean run settles #then nothing ever launches", async () => {
    const { pi, launches, store } = await fixture({ stepCount: 0, onCompaction: false, steps: 5 })

    await successfulSettle(pi)

    expect(launches).toEqual([])
    expect((await store.readState()).active).toBeUndefined()
  })

  test("#given an unsuccessful or missing run outcome #when settled #then no launch is attempted", async () => {
    for (const scenario of [
      { name: "aborted", payload: { aborted: true, abortSource: "user" as const } },
      { name: "willRetry", payload: { willRetry: true } },
      { name: "aborted-and-retrying", payload: { aborted: true, willRetry: true } },
    ]) {
      const { pi, launches, store } = await fixture({ stepCount: 1 })

      await agentEnd(pi, scenario.payload)
      await settle(pi)

      expect(launches, scenario.name).toEqual([])
      expect((await store.readState()).active, scenario.name).toBeUndefined()
    }

    const bare = await fixture({ stepCount: 1 })
    await settle(bare.pi)
    expect(bare.launches).toEqual([])
    expect((await bare.store.readState()).active).toBeUndefined()
  })

  test("#given a retried run #when the final agent_end is clean #then the settle counts as success", async () => {
    const { pi, launches } = await fixture({ stepCount: 1 })

    await agentEnd(pi, { willRetry: true })
    await agentEnd(pi)
    await settle(pi)

    expect(launches).toHaveLength(1)
    expect(launches[0]?.trigger).toBe("step-count")
  })

  test("#given a settled run outcome #when a second settle arrives without a new run #then the stale outcome cannot relaunch", async () => {
    const { pi, launches } = await fixture({ stepCount: 1, onCompaction: false })

    await successfulSettle(pi)
    await settle(pi)

    expect(launches).toHaveLength(1)
  })

  test("#given an accepted compaction #when the event fires #then it only records the pending flag and never launches", async () => {
    const { pi, ledger, launches, store } = await fixture({ stepCount: 0 })

    await compact(pi, true)

    expect(ledger.pendingCompaction).toBe(true)
    expect(launches).toEqual([])
    expect((await store.readState()).active).toBeUndefined()
    expect(pi.messages).toEqual([])
  })

  test("#given a rejected compaction #when the event fires #then no pending flag is recorded", async () => {
    const { pi, ledger, launches } = await fixture({ stepCount: 0 })

    await compact(pi, false)
    await successfulSettle(pi)

    expect(ledger.pendingCompaction).toBe(false)
    expect(launches).toEqual([])
  })

  test("#given a pending compaction #when the next settle fails and only then succeeds #then the flag is consumed exactly once", async () => {
    const { pi, ledger, launches } = await fixture({ stepCount: 0 })

    await compact(pi, true)
    await agentEnd(pi, { aborted: true })
    await settle(pi)

    expect(launches).toEqual([])
    expect(ledger.pendingCompaction).toBe(true)

    await successfulSettle(pi)

    expect(launches).toHaveLength(1)
    expect(launches[0]?.trigger).toBe("compaction")
    expect(ledger.pendingCompaction).toBe(false)

    await successfulSettle(pi)

    expect(launches).toHaveLength(1)
  })

  test("#given compaction and the step threshold ready in the same settle #when it is evaluated #then exactly one run launches", async () => {
    const { pi, launches, store } = await fixture({ stepCount: 1, steps: 3 })

    await compact(pi, true)
    await successfulSettle(pi)

    expect(launches).toHaveLength(1)
    expect(launches[0]?.trigger).toBe("compaction")
    expect((await store.readState()).active?.request.trigger).toBe("compaction")
    expect((await store.readState()).pending).toBeUndefined()
  })

  test("#given repeated successful settles before the active run completes #when they are evaluated #then one launch fires and pending collapses to a single record", async () => {
    const { pi, launches, store } = await fixture({ stepCount: 1, steps: 3 })

    await successfulSettle(pi)
    await compact(pi, true)
    await successfulSettle(pi)
    await successfulSettle(pi)
    await successfulSettle(pi)

    const state = await store.readState()
    expect(launches).toHaveLength(1)
    expect(launches[0]?.trigger).toBe("step-count")
    expect(state.active?.request.trigger).toBe("step-count")
    expect(state.pending?.request.trigger).toBe("compaction")
  })

  test("#given a manual request #when it is made outside any event #then it launches with its focus and journal filters", async () => {
    const { launches, wiring } = await fixture({ stepCount: 0 })

    wiring.requestManualReflection("remember names", { recentN: 3, conversationIds: [CONVERSATION] })
    await wiring.whenIdle()

    expect(launches).toHaveLength(1)
    expect(launches[0]).toMatchObject({
      trigger: "manual",
      focus: "remember names",
      recentN: 3,
      conversationIds: [CONVERSATION],
    })
  })

  test("#given a manual request without arguments #when it is made #then it targets the bound conversation without a focus", async () => {
    const { launches, wiring } = await fixture({ stepCount: 0 })

    wiring.requestManualReflection()
    await wiring.whenIdle()

    expect(launches).toHaveLength(1)
    expect(launches[0]?.trigger).toBe("manual")
    expect(launches[0]?.conversationIds).toEqual([CONVERSATION])
    expect(launches[0]?.focus).toBeUndefined()
  })

  test("#given an active run #when a manual request queues behind it #then it is reserved as pending without launching", async () => {
    const { pi, launches, store, wiring } = await fixture({ stepCount: 1 })

    await successfulSettle(pi)
    wiring.requestManualReflection("later")
    await wiring.whenIdle()

    expect(launches).toHaveLength(1)
    expect((await store.readState()).pending?.request.trigger).toBe("manual")
  })

  test("#given a launch handler that never settles #when a run settles #then the event handler still completes", async () => {
    const { pi } = await fixture({ stepCount: 1, onLaunch: () => new Promise<never>(() => {}) })

    const dispatched = await pi.dispatch("agent_end", { type: "agent_end", messages: [] }).then(() => settle(pi)).then(() => "completed")

    expect(dispatched).toBe("completed")
  })

  test("#given no launch handler #when a run settles #then the reservation still happens without throwing", async () => {
    const { pi, store } = await fixture({ stepCount: 1, withoutLaunchHandler: true })

    await successfulSettle(pi)

    expect((await store.readState()).active?.request.trigger).toBe("step-count")
  })

  test("#given no bound memory session #when events fire #then the wiring stays inert", async () => {
    const { pi, launches, logs, wiring } = await fixture({ stepCount: 1, session: undefined })

    await compact(pi, true)
    await successfulSettle(pi)
    wiring.requestManualReflection("ignored")
    await wiring.whenIdle()

    expect(launches).toEqual([])
    expect(logs).toEqual([])
  })

  test("#given an engine failure #when a run settles #then the host handler resolves and the failure is logged once", async () => {
    const base = await fixture({ stepCount: 1 })
    const session: ReflectionTriggerSession = {
      conversationId: "missing-conversation",
      ledger: base.ledger,
      engine: base.store,
    }
    const pi = new FakeExtensionAPI()
    const logs: Array<{ level: string; message: string; details?: unknown }> = []
    createReflectionTriggerWiring({
      resolveSession: () => session,
      onLaunch: () => {
        throw new Error("must not launch")
      },
      logger: {
        info: (message, details) => logs.push({ level: "info", message, details }),
        warn: (message, details) => logs.push({ level: "warn", message, details }),
        error: (message, details) => logs.push({ level: "error", message, details }),
      },
    }).register(pi)

    await successfulSettle(pi)

    expect(logs.filter((entry) => entry.level === "warn")).toHaveLength(1)
    expect(base.launches).toEqual([])
  })
})

describe("resolveReflectionTriggerConfig", () => {
  test("#given resolved memory settings #when no agent override applies #then the base trigger config is used", () => {
    expect(resolveReflectionTriggerConfig(memorySettings())).toEqual({ stepCount: 0, onCompaction: true })
    expect(
      resolveReflectionTriggerConfig(
        memorySettings({
          reflection: { trigger: { step_count: 4, on_compaction: false }, merge: "auto", category: "quick", timeout_minutes: 15, sandbox: "auto" },
        }),
      ),
    ).toEqual({ stepCount: 4, onCompaction: false })
  })

  test("#given a per-agent override #when the bound agent matches #then its trigger fields win field by field", () => {
    const settings = memorySettings({
      reflection: { trigger: { step_count: 4, on_compaction: false }, merge: "auto", category: "quick", timeout_minutes: 15, sandbox: "auto" },
      agents: {
        writer: { reflection: { trigger: { step_count: 9 } } },
        reviewer: { reflection: { trigger: { on_compaction: true } } },
      },
    })

    expect(resolveReflectionTriggerConfig(settings, "writer")).toEqual({ stepCount: 9, onCompaction: false })
    expect(resolveReflectionTriggerConfig(settings, "reviewer")).toEqual({ stepCount: 4, onCompaction: true })
    expect(resolveReflectionTriggerConfig(settings, "unknown-agent")).toEqual({ stepCount: 4, onCompaction: false })
  })
})

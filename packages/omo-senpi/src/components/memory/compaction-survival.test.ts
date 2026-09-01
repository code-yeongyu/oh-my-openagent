// Compaction survival + trigger integration (plan todo 34).
//
// The real component owns prompt, journal, and trigger wiring. The test replaces only its
// reflection runtime so launches are observable without spawning a worker; registering a
// second trigger over the same identity would race the production reservation store.

import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { BeforeAgentStartEventResult } from "@code-yeongyu/senpi"
import {
  GitMemoryRepo,
  ReflectionReservationStore,
  TranscriptJournal,
  resolveMemoryIdentity,
  type MemoryIdentity,
  type ReflectionRequest,
} from "@oh-my-opencode/memory-core"

import { ensureIdentityRuntimeDirs, type MemoryPendingLedger } from "./context"
import type { MemoryIdentityRuntime } from "./identity-runtime"
import type { ReservedRun } from "@oh-my-opencode/memory-core"
import { MEMORY_BINDING_CUSTOM_TYPE, createMemoryComponent } from "./index"
import {
  MemoryFakeExtensionAPI,
  componentContext,
  loadedMemoryConfig,
  memorySettings,
} from "./memory.test-support"
import { resolveReflectionTriggerConfig } from "./trigger-wiring"
import { realpathSync } from "node:fs"
import { rmEfaultTolerant } from "./teardown.test-support"

const SESSION_ID = "session-compaction-survival"
const BASE_SYSTEM_PROMPT = "You are senpi, a coding agent."
const PERSONA_BODY = "Aria charts the tidal archives by lantern light."
const BRANCH = [{ id: "message-1" }, { id: "message-2" }, { id: "message-3" }] as const

const roots: string[] = []
const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
  await Promise.all(roots.splice(0).map((root) => rmEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

interface CompactionFixture {
  readonly pi: MemoryFakeExtensionAPI
  readonly identity: MemoryIdentity
  readLedger(): MemoryPendingLedger
  readonly launches: ReflectionRequest[]
  readonly logs: Array<{ level: string; message: string; details?: unknown }>
}

async function compactionFixture(): Promise<CompactionFixture> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memory-compaction-")))
  roots.push(root)
  const cwd = join(root, "project")
  const env = { OMO_MEMORY_HOME: join(root, "memory") }
  const settings = memorySettings()
  const identity = resolveMemoryIdentity(settings.agent, cwd, env)

  // Memory content committed to the identity repo BEFORE the session binds.
  const repo = new GitMemoryRepo({ dir: identity.paths.repo, agentId: identity.id })
  await repo.init({
    seedFiles: [
      { relativePath: "system/persona.md", content: `---\ndescription: Persona\n---\n${PERSONA_BODY}\n` },
    ],
  })
  await ensureIdentityRuntimeDirs(identity.paths)

  const journals = new Map<string, TranscriptJournal>()
  let nextRunId = 0
  const store = new ReflectionReservationStore({
    identity,
    config: resolveReflectionTriggerConfig(settings),
    getJournal: async (conversationId) => {
      const cached = journals.get(conversationId)
      if (cached !== undefined) return cached
      const journal = new TranscriptJournal({ journalDir: join(identity.paths.transcripts, conversationId) })
      journals.set(conversationId, journal)
      return journal
    },
    createRunId: () => `reflection-run-${++nextRunId}`,
  })
  const launches: ReflectionRequest[] = []
  let boundLedger: MemoryPendingLedger | undefined
  const ctx = componentContext()
  const pi = new MemoryFakeExtensionAPI()
  createMemoryComponent({
    env,
    loadConfig: () => loadedMemoryConfig(settings),
    resolveCwd: () => cwd,
    createRuntime: (context) => {
      boundLedger = context.ledger
      return {
        store,
        launch: (run: ReservedRun) => {
          launches.push(run.request)
        },
        reconcile: async () => {},
      } as unknown as MemoryIdentityRuntime
    },
  }).register(pi, ctx)
  await pi.dispatch("session_start", { type: "session_start" }, sessionEventContext())

  cleanups.push(async () => {
    await pi.dispatch("session_shutdown", { type: "session_shutdown" }, sessionEventContext())
  })
  return {
    pi,
    identity,
    readLedger: () => {
      if (boundLedger === undefined) throw new Error("memory runtime was not created")
      return boundLedger
    },
    launches,
    logs: ctx.logs,
  }
}

function sessionEventContext(): unknown {
  return {
    sessionManager: {
      getEntries: () => [],
      getSessionId: () => SESSION_ID,
      getBranch: () => [...BRANCH],
    },
    ui: { notify: () => {} },
  }
}

function readSessionId(eventCtx: unknown): string | undefined {
  if (!isRecord(eventCtx) || !isRecord(eventCtx.sessionManager)) return undefined
  const getSessionId = eventCtx.sessionManager.getSessionId
  if (typeof getSessionId !== "function") return undefined
  const id: unknown = Reflect.apply(getSessionId, eventCtx.sessionManager, [])
  return typeof id === "string" && id.length > 0 ? id : undefined
}

async function compact(pi: MemoryFakeExtensionAPI, accepted: boolean): Promise<void> {
  await pi.dispatch(
    "session_compact",
    accepted
      ? { type: "session_compact", reason: "auto", requestId: "compact-1", accepted: true, fromExtension: false, willRetry: true }
      : { type: "session_compact", reason: "manual", requestId: "compact-1", accepted: false, rejectionCause: "cancelled-by-extension", fromExtension: false, willRetry: false },
    sessionEventContext(),
  )
}

async function endRun(
  pi: MemoryFakeExtensionAPI,
  outcome: { readonly aborted?: boolean; readonly willRetry?: boolean } = {},
): Promise<void> {
  await pi.dispatch("agent_end", { type: "agent_end", messages: [], ...outcome }, sessionEventContext())
}

async function settle(pi: MemoryFakeExtensionAPI): Promise<void> {
  await pi.dispatch("agent_settled", { type: "agent_settled" }, sessionEventContext())
}

async function beforeAgentStart(pi: MemoryFakeExtensionAPI): Promise<string> {
  const results = await pi.dispatch(
    "before_agent_start",
    { type: "before_agent_start", prompt: "continue", systemPrompt: BASE_SYSTEM_PROMPT },
    sessionEventContext(),
  )
  const result = results[0] as BeforeAgentStartEventResult | undefined
  expect(result?.systemPrompt).toBeDefined()
  return result?.systemPrompt ?? ""
}

function memoryBlock(systemPrompt: string, identity: string): string {
  const begin = `<!-- senpi-memory:${identity}:begin -->`
  const end = `<!-- senpi-memory:${identity}:end -->`
  const start = systemPrompt.indexOf(begin)
  const stop = systemPrompt.indexOf(end)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(stop).toBeGreaterThan(start)
  return systemPrompt.slice(start, stop + end.length)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

describe("compaction survival + trigger integration", () => {
  test("#given a bound session with committed memory #when an accepted compaction settles successfully #then exactly one reflection launches and the sentinel block survives byte-identical", async () => {
    const { pi, identity, readLedger, launches, logs } = await compactionFixture()

    // The real component bound this session to the same identity the repo was seeded under.
    expect(pi.entries).toHaveLength(1)
    expect(pi.entries[0]?.customType).toBe(MEMORY_BINDING_CUSTOM_TYPE)
    expect(pi.entries[0]?.data).toMatchObject({
      identity: identity.id,
      repoPathHash: createHash("sha256").update(identity.paths.repo, "utf8").digest("hex"),
    })

    const baseline = memoryBlock(await beforeAgentStart(pi), identity.id)
    expect(baseline).toContain(PERSONA_BODY)

    await compact(pi, true)
    expect(readLedger().pendingCompaction).toBe(true)

    await endRun(pi)
    await settle(pi)

    expect(launches, JSON.stringify(logs)).toHaveLength(1)
    expect(launches[0]?.trigger).toBe("compaction")
    expect(launches[0]?.conversationIds).toEqual([SESSION_ID])
    expect(readLedger().pendingCompaction).toBe(false)

    // Memory content is independent of compaction: the next run's audit injects the same block.
    const after = memoryBlock(await beforeAgentStart(pi), identity.id)
    expect(after).toBe(baseline)
    expect(after).toContain(PERSONA_BODY)
  }, 30_000)

  test("#given a bound session #when compaction is rejected #then no flag is recorded and settle launches nothing", async () => {
    const { pi, readLedger, launches } = await compactionFixture()

    await compact(pi, false)

    await endRun(pi)
    await settle(pi)

    expect(launches).toHaveLength(0)
    expect(readLedger().pendingCompaction).toBe(false)
  }, 30_000)

  test("#given compaction accepted mid-run #when the retried turn chain settles #then exactly one launch fires across all settles", async () => {
    const { pi, readLedger, launches, logs } = await compactionFixture()

    await pi.dispatch("turn_start", { type: "turn_start", turnIndex: 0 }, sessionEventContext())
    await compact(pi, true)
    expect(readLedger().pendingCompaction).toBe(true)

    // The compacted turn ends in a retry: the settle must not consume the flag or launch.
    await endRun(pi, { willRetry: true })
    await settle(pi)
    expect(launches).toHaveLength(0)
    expect(readLedger().pendingCompaction).toBe(true)

    await pi.dispatch("turn_start", { type: "turn_start", turnIndex: 1 }, sessionEventContext())
    await endRun(pi)
    await settle(pi)

    expect(launches, JSON.stringify(logs)).toHaveLength(1)
    expect(launches[0]?.trigger).toBe("compaction")
    expect(readLedger().pendingCompaction).toBe(false)
  }, 30_000)

  test("#given two consecutive accepted compactions #when the run settles #then the flag is consumed once with exactly one launch", async () => {
    const { pi, readLedger, launches, logs } = await compactionFixture()

    await compact(pi, true)
    await compact(pi, true)
    expect(readLedger().pendingCompaction).toBe(true)

    await endRun(pi)
    await settle(pi)

    expect(launches, JSON.stringify(logs)).toHaveLength(1)
    expect(launches[0]?.trigger).toBe("compaction")
    expect(readLedger().pendingCompaction).toBe(false)

    // Consumed: a later clean settle without a new compaction launches nothing more.
    await endRun(pi)
    await settle(pi)
    expect(launches).toHaveLength(1)
  }, 30_000)
})

// Compaction survival + trigger integration. The launch spy is injected into the component's
// single real identity runtime so the test cannot race a second reservation store.

import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { BeforeAgentStartEventResult } from "@code-yeongyu/senpi"
import {
  GitMemoryRepo,
  resolveMemoryIdentity,
  type MemoryIdentity,
  type ReflectionRequest,
} from "@oh-my-opencode/memory-core"

import { ensureIdentityRuntimeDirs } from "./context"
import { createIdentityRuntime } from "./identity-runtime"
import { MEMORY_BINDING_CUSTOM_TYPE, createMemoryComponent } from "./index"
import {
  MemoryFakeExtensionAPI,
  componentContext,
  loadedMemoryConfig,
  memorySettings,
} from "./memory.test-support"

const SESSION_ID = "session-compaction-survival"
const BASE_SYSTEM_PROMPT = "You are senpi, a coding agent."
const PERSONA_BODY = "Aria charts the tidal archives by lantern light."
const FIXED_CLOCK = () => new Date("2026-08-09T12:00:00.000Z")
const BRANCH = [{ id: "message-1" }, { id: "message-2" }, { id: "message-3" }] as const

const roots: string[] = []
const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

interface CompactionFixture {
  readonly pi: MemoryFakeExtensionAPI
  readonly identity: MemoryIdentity
  readonly launches: ReflectionRequest[]
}

async function compactionFixture(): Promise<CompactionFixture> {
  const root = await mkdtemp(join(tmpdir(), "omo-memory-compaction-"))
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

  const pi = new MemoryFakeExtensionAPI()
  const launches: ReflectionRequest[] = []
  createMemoryComponent({
    clock: FIXED_CLOCK,
    env,
    loadConfig: () => loadedMemoryConfig(settings),
    resolveCwd: () => cwd,
    createRuntime: (context, deps) => {
      const runtime = createIdentityRuntime(context, deps)
      return {
        ...runtime,
        launch: (run) => {
          launches.push(run.request)
        },
      }
    },
  }).register(pi, componentContext())
  await pi.dispatch("session_start", { type: "session_start" }, sessionEventContext())
  expect(pi.handlers.filter(({ event }) => event === "session_compact")).toHaveLength(1)

  cleanups.push(async () => {
    await pi.dispatch("session_shutdown", { type: "session_shutdown" }, sessionEventContext())
  })
  return { pi, identity, launches }
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

describe("compaction survival + trigger integration", () => {
  test("#given a bound session with committed memory #when an accepted compaction settles successfully #then exactly one reflection launches and the sentinel block survives byte-identical", async () => {
    const { pi, identity, launches } = await compactionFixture()

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

    await endRun(pi)
    await settle(pi)

    expect(launches).toHaveLength(1)
    expect(launches[0]?.trigger).toBe("compaction")
    expect(launches[0]?.conversationIds).toEqual([SESSION_ID])

    // Memory content is independent of compaction: the next run's audit injects the same block.
    const after = memoryBlock(await beforeAgentStart(pi), identity.id)
    expect(after).toBe(baseline)
    expect(after).toContain(PERSONA_BODY)
  })

  test("#given a bound session #when compaction is rejected #then no flag is recorded and settle launches nothing", async () => {
    const { pi, launches } = await compactionFixture()

    await compact(pi, false)

    await endRun(pi)
    await settle(pi)

    expect(launches).toHaveLength(0)
  })

  test("#given compaction accepted mid-run #when the retried turn chain settles #then exactly one launch fires across all settles", async () => {
    const { pi, launches } = await compactionFixture()

    await pi.dispatch("turn_start", { type: "turn_start", turnIndex: 0 }, sessionEventContext())
    await compact(pi, true)

    // The compacted turn ends in a retry: the settle must not consume the flag or launch.
    await endRun(pi, { willRetry: true })
    await settle(pi)
    expect(launches).toHaveLength(0)

    await pi.dispatch("turn_start", { type: "turn_start", turnIndex: 1 }, sessionEventContext())
    await endRun(pi)
    await settle(pi)

    expect(launches).toHaveLength(1)
    expect(launches[0]?.trigger).toBe("compaction")
  })

  test("#given two consecutive accepted compactions #when the run settles #then the flag is consumed once with exactly one launch", async () => {
    const { pi, launches } = await compactionFixture()

    await compact(pi, true)
    await compact(pi, true)

    await endRun(pi)
    await settle(pi)

    expect(launches).toHaveLength(1)
    expect(launches[0]?.trigger).toBe("compaction")

    // Consumed: a later clean settle without a new compaction launches nothing more.
    await endRun(pi)
    await settle(pi)
    expect(launches).toHaveLength(1)
  })
})

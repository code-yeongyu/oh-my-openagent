import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, writeFile, readFile, readdir } from "node:fs/promises"
import { realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rmEfaultTolerant } from "./teardown.test-support"

import { GitMemoryRepo, TranscriptJournal, buildIdentityPaths } from "@oh-my-opencode/memory-core"

import type { SenpiExtensionAPI } from "../../extension/types"
import { createMemoryIdentityContext, type MemoryIdentityContext } from "./context"
import {
  MEMORY_STATUS_RPC_METHOD,
  MEMORY_UPDATED_RPC_EVENT,
  createMemoryRpcBridge,
  type MemoryRpcGitRepo,
  type MemoryRpcSnapshot,
} from "./memory-rpc-bridge"
import { createMemoryRpcGitRepo } from "./memory-rpc-snapshot-state"
import { recapFixture } from "./worker/reflection-recap.test-support"
import { readMemoryReflections } from "./memory-rpc-reflections"
import type { MemoryRpcSync } from "./memory-rpc-sync"
import type { SyncStatusReader } from "./sync-status-surface"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rmEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

interface FakeRpcHost {
  readonly pi: SenpiExtensionAPI
  readonly emits: Array<{ name: string; data: unknown }>
  readonly handlers: Map<string, (data: unknown) => unknown | Promise<unknown>>
}

function rpcHost(options: { readonly withHandle?: boolean } = {}): FakeRpcHost {
  const emits: Array<{ name: string; data: unknown }> = []
  const handlers = new Map<string, (data: unknown) => unknown | Promise<unknown>>()
  const rpc: NonNullable<SenpiExtensionAPI["rpc"]> = {
    emit: (name, data) => {
      emits.push({ name, data })
    },
  }
  if (options.withHandle !== false) {
    rpc.handle = (name, handler) => {
      handlers.set(name, handler)
    }
  }
  return { pi: { rpc } as unknown as SenpiExtensionAPI, emits, handlers }
}

function stubRepo(overrides: Partial<MemoryRpcGitRepo> = {}): MemoryRpcGitRepo {
  return {
    head: async () => "0123456789abcdef0123456789abcdef01234567",
    headCommitTimestamp: async () => Date.parse("2026-08-10T00:00:00.000Z") / 1000,
    headSubject: async () => "memory: record the plan",
    status: async () => "",
    lsTree: async () => [],
    show: async () => "",
    ...overrides,
  }
}

async function contextFixture(identityId = "agent-test"): Promise<MemoryIdentityContext> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memory-rpc-")))
  roots.push(root)
  const paths = buildIdentityPaths(root, identityId)
  await mkdir(paths.transcripts, { recursive: true })
  await mkdir(join(paths.reflection, "completions"), { recursive: true })
  return createMemoryIdentityContext({
    identity: identityId,
    identityPaths: paths,
    binding: { identity: identityId, repoPathHash: "hash", boundAt: 1 },
  })
}

async function writeTranscriptState(
  context: MemoryIdentityContext,
  sessionId: string,
  state: Record<string, unknown>,
): Promise<void> {
  const dir = join(context.identityPaths.transcripts, sessionId)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, "state.json"), JSON.stringify(state), "utf8")
}

async function writeCompletion(
  context: MemoryIdentityContext,
  record: Record<string, unknown>,
): Promise<void> {
  const dir = join(context.identityPaths.reflection, "completions")
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${String(record.runId)}.json`), JSON.stringify(record), "utf8")
}

function failedCompletion(runId: string, finishedAt: string): Record<string, unknown> {
  return {
    schemaVersion: 1,
    runId,
    identity: "agent-test",
    category: "quick",
    conversationIds: ["session-1"],
    trigger: "step_count",
    outcome: "failed",
    reason: "spawn_failed",
    detail: "senpi executable not found",
    startedAt: finishedAt,
    finishedAt,
    delivery: { status: "consumed" },
  }
}

describe("memory rpc bridge", () => {
  test.each(["new", "failed-full"] as const)("#given a %s binding without a published snapshot #when journal delivery runs #then it never reads git", async (mode) => {
    const context = await contextFixture()
    const host = rpcHost()
    let gitReads = 0
    const bridge = createMemoryRpcBridge(host.pi, {
      resolveContext: () => context, activeRun: () => undefined,
      createGitRepo: () => stubRepo({ head: async () => { gitReads++; throw new Error("git unavailable") } }),
    })
    bridge.attach("session-1")
    if (mode === "failed-full") await expect(bridge.sync()).rejects.toThrow("git unavailable")
    const before = gitReads
    await bridge.syncJournal([{ kind: "assistant", messageId: "answer", textBlocks: ["Done."] }])
    expect(gitReads).toBe(before)
    expect(host.emits).toHaveLength(1)
    expect(host.emits[0]?.data).toMatchObject({
      nonJournalState: "unknown", journal: { sessionId: "session-1", totalSteps: 1 },
      reflection: { backlogSteps: 1 },
    })
  })

  test.each(["changed", "unchanged"] as const)("#given an unreadable transcript and %s durable counters #when journal delivery runs #then durable accounting is still published", async (mode) => {
    const context = await contextFixture()
    const host = rpcHost()
    const bridge = createMemoryRpcBridge(host.pi, {
      resolveContext: () => context, activeRun: () => undefined, createGitRepo: () => stubRepo(),
    })
    bridge.attach("session-1")
    const state = {
      total_completed_steps: 7, reflected_completed_steps: 3,
      steps_since_last_successful_reflection: 4, pending_compaction: true,
    }
    if (mode === "unchanged") await writeTranscriptState(context, "session-1", state)
    await bridge.sync()
    if (mode === "changed") await writeTranscriptState(context, "session-1", state)
    // A directory at the file path produces a real non-ENOENT filesystem error, without permission assumptions.
    await mkdir(join(context.identityPaths.transcripts, "session-1", "transcript.jsonl"))
    await bridge.syncJournal([{ kind: "assistant", messageId: "answer", textBlocks: ["Done."] }])
    expect(host.emits).toHaveLength(2)
    expect(host.emits[1]?.data).toMatchObject({
      journal: { totalSteps: 7, reflectedSteps: 3 },
      reflection: { backlogSteps: 4, pendingCompaction: true },
    })
    if (mode === "unchanged") expect(host.emits[1]?.data).toEqual(host.emits[0]?.data)
  })

  test("#given persisted and observed branch steps #when replay, reflection and rebinding occur #then counters count each canonical answer once", async () => {
    const context = await contextFixture()
    const host = rpcHost()
    const bridge = createMemoryRpcBridge(host.pi, {
      resolveContext: () => context, activeRun: () => undefined, createGitRepo: () => stubRepo(),
    })
    const journal = new TranscriptJournal({ journalDir: join(context.identityPaths.transcripts, "session-1") })
    const first = { kind: "assistant", messageId: "first", textBlocks: ["One."] } as const
    const second = { kind: "assistant", messageId: "second", textBlocks: ["Two."] } as const
    const toolOnly = { kind: "assistant", messageId: "tool", toolCalls: [{ callId: "call", name: "read" }] } as const
    await journal.reconcile([first])
    bridge.attach("session-1")
    await bridge.syncJournal([first, second, toolOnly])
    await bridge.syncJournal([first, second, toolOnly])
    expect(host.emits).toHaveLength(1)
    expect(host.emits[0]?.data).toMatchObject({
      journal: { totalSteps: 2, reflectedSteps: 0 }, reflection: { backlogSteps: 2 },
    })
    // A completed reflection may advance the cursor while the new answer is not journaled yet.
    await writeTranscriptState(context, "session-1", {
      total_completed_steps: 1, reflected_completed_steps: 1, steps_since_last_successful_reflection: 0,
    })
    await bridge.sync()
    expect(host.emits.at(-1)?.data).toMatchObject({
      journal: { totalSteps: 2, reflectedSteps: 1 }, reflection: { backlogSteps: 1 },
    })
    // A branch that omits the already observed answer cannot rewind the session's step count.
    await bridge.syncJournal([first])
    expect(host.emits).toHaveLength(2)
    bridge.attach("session-2")
    await bridge.syncJournal([toolOnly])
    expect(host.emits.at(-1)?.data).toMatchObject({
      journal: { sessionId: "session-2", totalSteps: 0 }, reflection: { backlogSteps: 0 },
    })
  })

  test("#given a published snapshot and stalled git reads #when settle delivers journal steps #then the update is published without any git read", async () => {
    const context = await contextFixture()
    const host = rpcHost()
    const stalled = Promise.withResolvers<string>()
    const gitEntered = Promise.withResolvers<void>()
    let gitReads = 0
    let stall = false
    const bridge = createMemoryRpcBridge(host.pi, {
      resolveContext: () => context, activeRun: () => undefined,
      createGitRepo: () => stubRepo({
        head: () => {
          gitReads += 1
          if (stall) gitEntered.resolve()
          return stall ? stalled.promise : Promise.resolve("0123456789abcdef0123456789abcdef01234567")
        },
      }),
    })
    bridge.attach("session-1")
    await bridge.sync()
    stall = true
    const readsBefore = gitReads
    const delivery = bridge.syncJournal([{ kind: "assistant", messageId: "answer", textBlocks: ["Done."] }])
    try {
      await Promise.race([delivery, gitEntered.promise])
      expect(gitReads).toBe(readsBefore)
      expect(host.emits.map(({ data }) => (data as MemoryRpcSnapshot).journal.totalSteps)).toEqual([0, 1])
      expect(host.emits.at(-1)?.data).toMatchObject({
        repo: { headSha: "0123456789abcdef0123456789abcdef01234567" }, reflection: { backlogSteps: 1 },
      })
    } finally {
      stalled.resolve("0123456789abcdef0123456789abcdef01234567")
      await delivery
    }
  })

  test("#given an old binding with queued snapshots #when a new session attaches #then its delivery does not wait for or reuse the retired queue", async () => {
    const context = await contextFixture()
    const host = rpcHost()
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<string>()
    let builds = 0
    const bridge = createMemoryRpcBridge(host.pi, {
      resolveContext: () => context, activeRun: () => undefined,
      createGitRepo: () => stubRepo({
        head: () => {
          if (++builds !== 1) return Promise.resolve("new")
          entered.resolve()
          return release.promise
        },
      }),
    })
    bridge.attach("old")
    const first = bridge.sync()
    await entered.promise
    const queued = bridge.sync()
    bridge.attach("new")
    try {
      await bridge.sync()
      expect(host.emits.map(({ data }) => (data as MemoryRpcSnapshot).journal.sessionId)).toEqual(["new"])
    } finally {
      release.resolve("old")
      await Promise.all([first, queued])
    }
    expect(builds).toBe(2)
    expect(host.emits).toHaveLength(1)
  })

  test("#given overlapping publications #when the first snapshot is held #then the next build waits for its publication", async () => {
    const context = await contextFixture()
    const host = rpcHost()
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<string>()
    let builds = 0
    const bridge = createMemoryRpcBridge(host.pi, {
      resolveContext: () => context,
      activeRun: () => undefined,
      createGitRepo: () => stubRepo({
        head: () => {
          builds += 1
          if (builds === 1) {
            entered.resolve()
            return release.promise
          }
          return Promise.resolve("newer")
        },
      }),
    })
    bridge.attach("session-1")
    const first = bridge.sync()
    await entered.promise
    const second = bridge.sync()
    try {
      expect(builds).toBe(1)
    } finally {
      release.resolve("older")
      await Promise.all([first, second])
    }
    expect(host.emits.map(({ data }) => (data as MemoryRpcSnapshot).repo.headSha)).toEqual(["older", "newer"])
  })

  test.each(["cancel", "attach", "detach"] as const)(
    "#given a pending status snapshot #when %s retires its observer #then it cannot publish into the next binding",
    async (retire) => {
      const context = await contextFixture()
      const host = rpcHost()
      const entered = Promise.withResolvers<void>()
      const release = Promise.withResolvers<string | null>()
      const bridge = createMemoryRpcBridge(host.pi, {
        resolveContext: () => context,
        activeRun: () => undefined,
        createGitRepo: () => stubRepo({ head: () => { entered.resolve(); return release.promise } }),
      })
      const controller = new AbortController()
      bridge.attach("session-1")
      const pending = bridge.sync(controller.signal)
      await entered.promise
      if (retire === "cancel") controller.abort()
      else if (retire === "attach") bridge.attach("session-2")
      else bridge.detach()
      release.resolve("0123456789abcdef0123456789abcdef01234567")
      await pending
      expect(host.emits).toEqual([])
    },
  )

  test("#given a never-written identity #when backfill reads #then no runtime directories are created", async () => {
    const root = await mkdtemp(join(tmpdir(), "recap-read-only-"))
    roots.push(root)
    const context = createMemoryIdentityContext({ identity: "agent-test", identityPaths: buildIdentityPaths(root, "agent-test"),
      binding: { identity: "agent-test", repoPathHash: "hash", boundAt: 1 } })
    expect((await readMemoryReflections(context, "session-1", {})).entries).toEqual([])
    expect(await readdir(root)).toEqual([])
  })
  test("#given equal timestamps and consumed records #when paging #then keys advance and completion bytes stay unchanged", async () => {
    const root = await mkdtemp(join(tmpdir(), "recap-paging-"))
    roots.push(root)
    const first = await recapFixture(root, { runId: "run-a", delivery: { status: "consumed", sessionId: "recipient" } })
    await recapFixture(root, { runId: "run-b", delivery: { status: "consumed", sessionId: "recipient" } })
    const path = join(first.completionsDir, "run-a.json")
    const before = await readFile(path, "utf8")
    const page = await readMemoryReflections(first.context, "recipient", { limit: 1 })
    const next = await readMemoryReflections(first.context, "recipient", { limit: 1, cursor: page.nextCursor })
    expect(page.entries.map((entry) => entry.runId)).toEqual(["run-b"])
    expect(next.entries.map((entry) => entry.runId)).toEqual(["run-a"])
    expect(next.nextCursor).toBeUndefined()
    expect(await readFile(path, "utf8")).toBe(before)
    expect((await readMemoryReflections(first.context, "conversation-b", {})).entries).toHaveLength(2)
    expect((await readMemoryReflections(first.context, "unrelated", {})).entries).toHaveLength(0)
  })

  test.each([{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { cursor: "../secret" }, { cursor: "e30" }, { directory: "/tmp" }])(
    "#given malformed request %j #when paging #then it is rejected", async (request) => {
      const context = await contextFixture()
      await expect(readMemoryReflections(context, "session-1", request)).rejects.toThrow()
    },
  )

  test.each(["attach", "detach", "dispose"] as const)("#given an in-flight page #when %s changes binding #then the stale result is discarded", async (operation) => {
    const context = await contextFixture()
    const host = rpcHost()
    const bridge = createMemoryRpcBridge(host.pi, { resolveContext: () => context, activeRun: () => undefined })
    bridge.attach("session-1")
    const result = host.handlers.get("omo.memory.reflections")?.({})
    if (operation === "attach") bridge.attach("session-1")
    else bridge[operation]()
    expect(await result).toMatchObject({ kind: "unavailable" })
  })
  test("#given a bound session #when reflections are requested #then a read-only page is returned", async () => {
    const context = await contextFixture()
    const host = rpcHost()
    const bridge = createMemoryRpcBridge(host.pi, { resolveContext: () => context, activeRun: () => undefined })
    bridge.attach("session-1")
    expect(await host.handlers.get("omo.memory.reflections")?.({ limit: 1 })).toEqual({
      schemaVersion: 1, identity: context.identity, sessionId: "session-1", entries: [],
    })
    expect(host.emits).toEqual([])
  })
  describe("#given a bound memory session and an rpc-capable host", () => {
    test("#when the bridge syncs #then it emits one snapshot describing repo, reflection, and journal state", async () => {
      const context = await contextFixture()
      await writeTranscriptState(context, "session-1", {
        schema_version: "v3_assistant_steps",
        total_completed_steps: 42,
        reflected_completed_steps: 28,
        steps_since_last_successful_reflection: 14,
        pending_compaction: true,
      })
      await writeCompletion(context, failedCompletion("run-1", minutesAgoISO(90)))
      const host = rpcHost()
      const bridge = createMemoryRpcBridge(host.pi, {
        resolveContext: () => context,
        activeRun: () => ({
          runId: "run-2",
          trigger: "manual",
          category: "quick",
          model: "sonnet",
          startedAt: "2026-08-10T01:00:00.000Z",
        }),
        createGitRepo: () => stubRepo({ status: async () => " M system/persona.md\n?? notes.md\n" }),
      })

      bridge.attach("session-1")
      await bridge.sync()

      expect(host.emits).toHaveLength(1)
      expect(host.emits[0]?.name).toBe(MEMORY_UPDATED_RPC_EVENT)
      const snapshot = host.emits[0]?.data as MemoryRpcSnapshot
      expect(snapshot).toMatchObject({
        schemaVersion: 1,
        identity: "agent-test",
        repo: {
          headSha: "0123456789abcdef0123456789abcdef01234567",
          headSubject: "memory: record the plan",
          committedAtISO: "2026-08-10T00:00:00.000Z",
          dirty: true,
          dirtyPaths: 2,
          systemTokensEstimate: 0,
        },
        reflection: {
          backlogSteps: 14,
          pendingCompaction: true,
          activeRun: {
            runId: "run-2",
            trigger: "manual",
            category: "quick",
            model: "sonnet",
            startedAt: "2026-08-10T01:00:00.000Z",
          },
          consecutiveFailures: 1,
          lastFailureFingerprint: "spawn_failed:senpi executable not found",
        },
        journal: { sessionId: "session-1", totalSteps: 42, reflectedSteps: 28 },
      })
      bridge.dispose()
    })

    test("#when the same state syncs twice #then the identical second snapshot is suppressed", async () => {
      const context = await contextFixture()
      await writeTranscriptState(context, "session-1", {
        schema_version: "v3_assistant_steps",
        total_completed_steps: 3,
        reflected_completed_steps: 3,
        steps_since_last_successful_reflection: 0,
      })
      const host = rpcHost()
      const bridge = createMemoryRpcBridge(host.pi, {
        resolveContext: () => context,
        activeRun: () => undefined,
        createGitRepo: () => stubRepo(),
      })

      bridge.attach("session-1")
      await bridge.sync()
      await bridge.sync()
      await bridge.sync()

      expect(host.emits).toHaveLength(1)
      bridge.dispose()
    })

    test("#when HEAD moves #then the changed state emits a fresh snapshot", async () => {
      const context = await contextFixture()
      const host = rpcHost()
      let head = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      const bridge = createMemoryRpcBridge(host.pi, {
        resolveContext: () => context,
        activeRun: () => undefined,
        createGitRepo: () => stubRepo({ head: async () => head }),
      })

      bridge.attach("session-1")
      await bridge.sync()
      head = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      await bridge.sync()

      expect(host.emits).toHaveLength(2)
      expect((host.emits[1]?.data as MemoryRpcSnapshot).repo.headSha).toBe(head)
      bridge.dispose()
    })

    test("#when the failure streak grows #then the changed health emits a fresh snapshot", async () => {
      const context = await contextFixture()
      await writeCompletion(context, failedCompletion("run-1", minutesAgoISO(90)))
      const host = rpcHost()
      const bridge = createMemoryRpcBridge(host.pi, {
        resolveContext: () => context,
        activeRun: () => undefined,
        createGitRepo: () => stubRepo(),
      })

      bridge.attach("session-1")
      await bridge.sync()
      await writeCompletion(context, failedCompletion("run-2", minutesAgoISO(60)))
      await bridge.sync()

      expect(host.emits).toHaveLength(2)
      expect((host.emits[1]?.data as MemoryRpcSnapshot).reflection.consecutiveFailures).toBe(2)
      bridge.dispose()
    })

    test("#when a client calls the status method #then the current snapshot round-trips without emitting", async () => {
      const context = await contextFixture()
      const host = rpcHost()
      const bridge = createMemoryRpcBridge(host.pi, {
        resolveContext: () => context,
        activeRun: () => undefined,
        createGitRepo: () => stubRepo(),
      })

      bridge.attach("session-1")
      const handler = host.handlers.get(MEMORY_STATUS_RPC_METHOD)
      const response = await handler?.({})

      expect(response).toMatchObject({
        schemaVersion: 1,
        identity: "agent-test",
        journal: { sessionId: "session-1" },
      })
      expect(host.emits).toEqual([])
      bridge.dispose()
    })
  })

  describe("#given no bound memory session", () => {
    test("#when the bridge syncs #then nothing is emitted and no git runs", async () => {
      const host = rpcHost()
      let repoCalls = 0
      const bridge = createMemoryRpcBridge(host.pi, {
        resolveContext: () => undefined,
        activeRun: () => undefined,
        createGitRepo: () => {
          repoCalls += 1
          return stubRepo()
        },
      })

      bridge.attach("session-1")
      await bridge.sync()

      expect(host.emits).toEqual([])
      expect(repoCalls).toBe(0)
      bridge.dispose()
    })

    test("#when a client calls the status method #then it reports the unbound state", async () => {
      const host = rpcHost()
      const bridge = createMemoryRpcBridge(host.pi, {
        resolveContext: () => undefined,
        activeRun: () => undefined,
        createGitRepo: () => stubRepo(),
      })

      const handler = host.handlers.get(MEMORY_STATUS_RPC_METHOD)

      expect(await handler?.({})).toEqual({ kind: "unavailable", reason: "No bound memory session." })
      bridge.dispose()
    })
  })

  describe("#given a host without rpc support", () => {
    test("#when the bridge attaches and syncs #then it stays a silent no-op", async () => {
      const context = await contextFixture()
      const pi = {} as SenpiExtensionAPI
      let repoCalls = 0
      const bridge = createMemoryRpcBridge(pi, {
        resolveContext: () => context,
        activeRun: () => undefined,
        createGitRepo: () => {
          repoCalls += 1
          return stubRepo()
        },
      })

      bridge.attach("session-1")
      await bridge.sync()
      bridge.detach()
      bridge.dispose()

      expect(repoCalls).toBe(0)
    })

    test("#when the host emits but cannot handle requests #then snapshots still publish", async () => {
      const context = await contextFixture()
      const host = rpcHost({ withHandle: false })
      const bridge = createMemoryRpcBridge(host.pi, {
        resolveContext: () => context,
        activeRun: () => undefined,
        createGitRepo: () => stubRepo(),
      })

      bridge.attach("session-1")
      await bridge.sync()

      expect(host.emits).toHaveLength(1)
      expect(host.handlers.size).toBe(0)
      bridge.dispose()
    })
  })

  describe("#given a detached bridge", () => {
    test("#when it syncs after detach #then no snapshot is published and re-attach republishes", async () => {
      const context = await contextFixture()
      const host = rpcHost()
      const bridge = createMemoryRpcBridge(host.pi, {
        resolveContext: () => context,
        activeRun: () => undefined,
        createGitRepo: () => stubRepo(),
      })

      bridge.attach("session-1")
      await bridge.sync()
      bridge.detach()
      await bridge.sync()
      expect(host.emits).toHaveLength(1)

      bridge.attach("session-1")
      await bridge.sync()

      expect(host.emits).toHaveLength(2)
      bridge.dispose()
    })

    test("#when the repo has no HEAD #then the snapshot omits commit facts instead of throwing", async () => {
      const context = await contextFixture()
      const host = rpcHost()
      const bridge = createMemoryRpcBridge(host.pi, {
        resolveContext: () => context,
        activeRun: () => undefined,
        createGitRepo: () => stubRepo({ head: async () => null, headCommitTimestamp: async () => null, headSubject: async () => null }),
      })

      bridge.attach("session-1")
      await bridge.sync()

      const snapshot = host.emits[0]?.data as MemoryRpcSnapshot
      expect(snapshot.repo).toEqual({ dirty: false, dirtyPaths: 0, systemTokensEstimate: 0 })
      bridge.dispose()
    })
  })

  describe("#given a real two-commit memory repo", () => {
    test("#when the bridge syncs #then the snapshot carries size and timeline fields at schemaVersion 1", async () => {
      const context = await contextFixture()
      const dir = context.identityPaths.repo
      const gitRepo = new GitMemoryRepo({ dir, agentId: "omo-memory-rpc" })
      await gitRepo.init({ seedFiles: [{ relativePath: "system/persona.md", content: "first\n" }] })
      await writeFile(join(dir, "system/persona.md"), "second entry body\n", "utf8")
      await gitRepo.commitWrite(["system/persona.md"], "memory: second entry", {
        agentId: "omo-memory-rpc",
        authorName: "OmO Agent",
      })
      const log = await gitRepo.log({ limit: 2 })
      const host = rpcHost()
      const bridge = createMemoryRpcBridge(host.pi, {
        resolveContext: () => context,
        activeRun: () => undefined,
        createGitRepo: createMemoryRpcGitRepo,
      })

      bridge.attach("session-1")
      await bridge.sync()

      const snapshot = host.emits[0]?.data as MemoryRpcSnapshot
      expect(snapshot.schemaVersion).toBe(1)
      expect(snapshot.repo.fileCount).toBe(1)
      expect(snapshot.repo.totalBytes).toBe(Buffer.byteLength("second entry body\n", "utf8"))
      expect(snapshot.repo.systemBytes).toBe(snapshot.repo.totalBytes)
      expect(snapshot.repo.entriesToday).toBe(2)
      expect(snapshot.repo.previousEntryAtISO).toBe(log[1]!.committedAt)
      bridge.dispose()
    })
  })
})

function minutesAgoISO(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

describe("memory rpc bridge sync field (omo #10637)", () => {
  test("#given this device's sync is failing on a stranded lock #when the status is pulled #then the snapshot carries the same kind, reason, action and paths the TUI shows", async () => {
    const context = await contextFixture()
    const host = rpcHost()
    const repos: string[] = []
    const bridge = createMemoryRpcBridge(host.pi, {
      resolveContext: () => context,
      activeRun: () => undefined,
      createGitRepo: () => stubRepo(),
      syncStatus: async (repo) => {
        repos.push(repo)
        return {
          kind: "failing",
          since: Date.parse("2026-10-22T10:00:00.000Z"),
          attempts: 2,
          failure: { kind: "stranded_lock", paths: ["/m/.git/index.lock"], reason: "A git lock blocks sync.", action: "Run /memory unlock /m/.git/index.lock." },
        }
      },
    })
    bridge.attach("session-1")

    const snapshot = (await host.handlers.get(MEMORY_STATUS_RPC_METHOD)?.({})) as MemoryRpcSnapshot

    expect(repos).toEqual([context.identityPaths.repo])
    expect(snapshot.sync).toEqual({
      state: "failing",
      failure: {
        kind: "stranded_lock",
        reason: "A git lock blocks sync.",
        action: "Run /memory unlock /m/.git/index.lock.",
        sinceISO: "2026-10-22T10:00:00.000Z",
        attempts: 2,
        paths: ["/m/.git/index.lock"],
      },
    })
    bridge.dispose()
  })

  const cases: ReadonlyArray<readonly [string, SyncStatusReader, MemoryRpcSync | undefined]> = [
    ["synced", async () => ({ kind: "synced", at: Date.parse("2026-10-22T10:00:00.000Z"), updatedWhileOffline: 0 }), { state: "synced", lastSyncedAtISO: "2026-10-22T10:00:00.000Z" }],
    ["never synced", async () => ({ kind: "never_synced" }), { state: "never_synced" }],
    ["paused at a refused entry", async () => ({ kind: "paused", seq: 1, code: "signature" }), { state: "paused" }],
    ["unavailable on this device", async () => ({ kind: "sync-unavailable", reason: "Another process holds the engine." }), { state: "unavailable" }],
    ["off because its configuration is invalid", async () => ({ kind: "sync-config-invalid", variable: "OMO_SERVICE_API_URL", reason: "OMO_SERVICE_API_URL is not a valid service URL" }), { state: "unavailable" }],
    ["not syncing on this device", async () => null, undefined],
    ["a reader that throws", async () => Promise.reject(new Error("runner gone")), undefined],
  ]
  test.each(cases)("#given sync %s #when the status is pulled #then the sync field matches", async (_name, syncStatus, expected) => {
    const context = await contextFixture()
    const host = rpcHost()
    const bridge = createMemoryRpcBridge(host.pi, { resolveContext: () => context, activeRun: () => undefined, createGitRepo: () => stubRepo(), syncStatus })
    bridge.attach("session-1")

    const snapshot = (await host.handlers.get(MEMORY_STATUS_RPC_METHOD)?.({})) as MemoryRpcSnapshot

    expect(snapshot.sync).toEqual(expected)
    expect("sync" in snapshot).toBe(expected !== undefined)
    bridge.dispose()
  })
})

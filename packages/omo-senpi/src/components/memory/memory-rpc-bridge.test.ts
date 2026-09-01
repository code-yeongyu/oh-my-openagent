import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rmEfaultTolerant } from "./teardown.test-support"

import { GitMemoryRepo, buildIdentityPaths } from "@oh-my-opencode/memory-core"

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

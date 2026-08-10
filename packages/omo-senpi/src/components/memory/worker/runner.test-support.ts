import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { EntryRenderer } from "@code-yeongyu/senpi"
import {
  GitMemoryRepo,
  ReflectionReservationStore,
  TranscriptJournal,
  buildIdentityPaths,
  type MemoryIdentity,
  type ReservedRun,
} from "@oh-my-opencode/memory-core"
import { OmoMemorySettingsSchema, type OmoConfig } from "@oh-my-opencode/omo-config-core"
import type { SenpiModelPort } from "@oh-my-opencode/senpi-task"

import type { SenpiOmoConfigResult } from "../../config-resolution"
import type {
  ReflectionCompletionApi,
  ReflectionCompletionRecord,
} from "./completion"
import { SenpiSubprocessRunner } from "./runner"
import type { ReflectionSpawnArgs } from "./spawn"

export class CapturedCompletionApi implements ReflectionCompletionApi {
  readonly entries: Array<{ customType: string; data: unknown }> = []
  readonly renderers: Array<{
    customType: string
    renderer: EntryRenderer<ReflectionCompletionRecord>
  }> = []

  appendEntry<T = unknown>(customType: string, data?: T): void {
    this.entries.push({ customType, data })
  }

  registerEntryRenderer(
    customType: string,
    renderer: EntryRenderer<ReflectionCompletionRecord>,
  ): void {
    this.renderers.push({ customType, renderer })
  }
}

export interface RunnerHarness {
  readonly root: string
  readonly identity: MemoryIdentity
  readonly journal: TranscriptJournal
  readonly store: ReflectionReservationStore
  readonly run: ReservedRun
  readonly runner: SenpiSubprocessRunner
  readonly api: CapturedCompletionApi
  readonly notifications: Array<{ message: string; level: string }>
  readonly spawnCalls: ReflectionSpawnArgs[]
  reserveAgain(): Promise<ReservedRun>
}

const childFixture = join(import.meta.dir, "__fixtures__", "reflection-child.ts")

export async function createRunnerHarness(options: {
  readonly childMode: "commit" | "timeout" | "admin"
  readonly categoryAvailable?: boolean
  readonly deadlineMs?: number
  readonly terminationGraceMs?: number
}): Promise<RunnerHarness> {
  const root = await mkdtemp(join(tmpdir(), "memory-reflection-worker-"))
  const identity: MemoryIdentity = {
    id: "agent-test",
    safeSlug: "agent-test",
    paths: buildIdentityPaths(root, "agent-test"),
  }
  const repo = new GitMemoryRepo({ dir: identity.paths.repo, agentId: identity.id })
  await repo.init({
    seedFiles: [{
      relativePath: "system/base.md",
      content: "---\ndescription: Initial memory\n---\nInitial fact.\n",
    }],
  })

  const journal = new TranscriptJournal({
    journalDir: join(identity.paths.transcripts, "conversation-a"),
  })
  await journal.reconcile([
    { kind: "user", messageId: "user-1", text: "Remember the reflected fact" },
    { kind: "assistant", messageId: "assistant-1", textBlocks: ["I will remember it"] },
  ])
  let nextRun = 0
  const store = new ReflectionReservationStore({
    identity,
    config: { stepCount: 1, onCompaction: true },
    getJournal: async (conversationId) => {
      if (conversationId !== "conversation-a") throw new Error(`unknown conversation: ${conversationId}`)
      return journal
    },
    createRunId: () => `run-${++nextRun}`,
  })
  const reserved = await store.evaluate("conversation-a", { kind: "settled", success: true })
  if (!reserved || reserved.status !== "active") throw new Error("expected active reflection reservation")

  const model: SenpiModelPort = { provider: "omo-mock", id: "mock-1" }
  const categoryAvailable = options.categoryAvailable ?? true
  const memory = OmoMemorySettingsSchema.parse({
    reflection: { category: "quick", timeout_minutes: 15, merge: "auto" },
  })
  const config: OmoConfig = {
    memory,
    categories: categoryAvailable
      ? { quick: { model: "omo-mock/mock-1", reasoning: "high" } }
      : {},
  }
  const loaded: SenpiOmoConfigResult = { config, diagnostics: [], layers: [], sources: [] }
  const api = new CapturedCompletionApi()
  const notifications: Array<{ message: string; level: string }> = []
  const spawnCalls: ReflectionSpawnArgs[] = []
  const runner = new SenpiSubprocessRunner({
    identity,
    reservation: store,
    resolveModelRegistry: () => ({
      getAvailable: () => categoryAvailable ? [model] : [],
      find: (provider, modelId) => provider === model.provider && modelId === model.id ? model : undefined,
    }),
    loadConfig: () => loaded,
    cwd: root,
    deadlineMs: options.deadlineMs,
    terminationGraceMs: options.terminationGraceMs,
    liveSession: () => ({
      sessionId: "conversation-a",
      api,
      ui: { notify: (message, level) => notifications.push({ message, level }) },
    }),
    sandbox: (spawnArgs) => {
      spawnCalls.push(spawnArgs)
      return {
        ...spawnArgs,
        command: process.execPath,
        args: [childFixture, options.childMode],
      }
    },
  })

  return {
    root,
    identity,
    journal,
    store,
    run: reserved.run,
    runner,
    api,
    notifications,
    spawnCalls,
    reserveAgain: async () => {
      const snapshot = await journal.captureReflectionSnapshot()
      if (!snapshot) throw new Error("expected another reflection snapshot")
      const next = await store.tryReserve({
        trigger: "manual",
        conversationIds: ["conversation-a"],
        snapshots: [{ conversationId: "conversation-a", snapshot }],
      })
      if (next.status !== "active") throw new Error("expected another active reservation")
      return next.run
    },
  }
}

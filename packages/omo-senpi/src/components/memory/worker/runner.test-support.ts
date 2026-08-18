import { mkdtemp, writeFile } from "node:fs/promises"
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
import type { ResolveAndPreflightMemoryLaunch } from "./memory-launch-preflight"
import type {
  ReflectionCompletionApi,
} from "./completion"
import { SenpiSubprocessRunner } from "./runner"
import type { ReflectionSpawnArgs } from "./spawn"

export class CapturedCompletionApi implements ReflectionCompletionApi {
  readonly entries: Array<{ customType: string; data: unknown }> = []
  readonly renderers: Array<{
    customType: string
    renderer: EntryRenderer<unknown>
  }> = []

  appendEntry<T = unknown>(customType: string, data?: T): void {
    this.entries.push({ customType, data })
  }

  registerEntryRenderer<T>(
    customType: string,
    renderer: EntryRenderer<T>,
  ): void {
    this.renderers.push({ customType, renderer: renderer as EntryRenderer<unknown> })
  }
}

export type HarnessModel = SenpiModelPort & {
  readonly cost?: { readonly input: number; readonly cacheRead?: number; readonly output?: number }
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
  readonly preflightProbeLog: string
  reserveAgain(): Promise<ReservedRun>
}

const childFixture = join(import.meta.dir, "__fixtures__", "reflection-child.ts")

/** Modes whose scenario needs the two-rung category chain rather than the single mock model. */
function isChainMode(childMode: string): boolean {
  return childMode === "model-fallback" || childMode === "model-exhausted" || childMode === "provider-cooldown"
}
const supervisorFixture = join(import.meta.dir, "memory-run-supervisor.ts")

export async function createRunnerHarness(options: {
  readonly childMode: "commit" | "timeout" | "admin" | "model-fallback" | "model-exhausted" | "provider-cooldown"
  readonly categoryAvailable?: boolean
  readonly config?: OmoConfig
  readonly models?: readonly HarnessModel[]
  readonly preflightModels?: readonly HarnessModel[]
  readonly deadlineMs?: number
  readonly terminationGraceMs?: number
  readonly now?: () => Date
  readonly resolveAndPreflightLaunch?: ResolveAndPreflightMemoryLaunch
  readonly resolveSessionModel?: () => { readonly provider: string; readonly id: string; readonly thinking?: string } | undefined
  readonly resolveParentContextTokens?: () => number | undefined
  readonly resolveParentSessionFile?: () => string | undefined
  readonly resolveParentCacheReusable?: () => boolean
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
  const fallbackModels: readonly SenpiModelPort[] = [
    { provider: "extension-only", id: "primary" },
    { provider: "kimi-coding", id: "fallback" },
  ]
  const models = options.models
    ?? (isChainMode(options.childMode) ? fallbackModels : [model])
  const categoryAvailable = options.categoryAvailable ?? true
  const memory = OmoMemorySettingsSchema.parse({
    reflection: { category: "quick", timeout_minutes: 15, merge: "auto" },
  })
  const config: OmoConfig = options.config ?? {
    memory,
    categories: categoryAvailable
      ? {
          quick: isChainMode(options.childMode)
            ? {
                models: [
                  { model: "extension-only/primary", reasoning: "off" },
                  { model: "kimi-coding/fallback", reasoning: "minimal" },
                ],
              }
            : { model: "omo-mock/mock-1", reasoning: "high" },
        }
      : {},
  }
  const loaded: SenpiOmoConfigResult = { config, diagnostics: [], layers: [], sources: [] }
  const senpiLauncher = join(root, "fake-senpi.mjs")
  const preflightProbeLog = join(root, "preflight-probes.log")
  await writeFile(
    senpiLauncher,
    `import { appendFileSync } from "node:fs"\nappendFileSync(${JSON.stringify(preflightProbeLog)}, "probe\\n")\nprocess.stdout.write(${JSON.stringify(`${(options.preflightModels ?? models).map((candidate) => `${candidate.provider}/${candidate.id}`).join("\n")}\n`)})\n`,
    "utf8",
  )
  const api = new CapturedCompletionApi()
  const notifications: Array<{ message: string; level: string }> = []
  const spawnCalls: ReflectionSpawnArgs[] = []
  const runner = new SenpiSubprocessRunner({
    identity,
    reservation: store,
    resolveModelRegistry: () => ({
      getAvailable: () => categoryAvailable ? models : [],
      find: (provider, modelId) => models.find((candidate) =>
        provider === candidate.provider && modelId === candidate.id
      ),
    }),
    loadConfig: () => loaded,
    cwd: root,
    deadlineMs: options.deadlineMs,
    terminationGraceMs: options.terminationGraceMs,
    now: options.now,
    supervisorPath: supervisorFixture,
    senpiCommand: process.execPath,
    senpiPrefixArgs: [senpiLauncher],
    resolveAndPreflightLaunch: options.resolveAndPreflightLaunch,
    ...(options.resolveSessionModel === undefined ? {} : { resolveSessionModel: options.resolveSessionModel }),
    ...(options.resolveParentContextTokens === undefined ? {} : { resolveParentContextTokens: options.resolveParentContextTokens }),
    ...(options.resolveParentSessionFile === undefined ? {} : { resolveParentSessionFile: options.resolveParentSessionFile }),
    ...(options.resolveParentCacheReusable === undefined ? {} : { resolveParentCacheReusable: options.resolveParentCacheReusable }),
    getTranscriptState: (conversationId) => {
      if (conversationId !== "conversation-a") throw new Error(`unknown conversation: ${conversationId}`)
      return journal.getState()
    },
    liveSession: () => ({
      sessionId: "conversation-a",
      api,
      ui: { notify: (message, level) => notifications.push({ message, level }) },
    }),
    sandbox: (spawnArgs) => {
      spawnCalls.push(spawnArgs)
      const mode = options.childMode === "model-fallback"
        ? spawnArgs.args.includes("extension-only/primary") ? "model-not-found" : "commit"
        : options.childMode === "model-exhausted"
          ? spawnArgs.args.includes("extension-only/primary") ? "model-not-found" : "auth-missing"
          : options.childMode === "provider-cooldown"
            ? spawnArgs.args.includes("extension-only/primary") ? "provider-cooldown" : "commit"
            : options.childMode
      return {
        ...spawnArgs,
        command: process.execPath,
        args: [childFixture, mode],
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
    preflightProbeLog,
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

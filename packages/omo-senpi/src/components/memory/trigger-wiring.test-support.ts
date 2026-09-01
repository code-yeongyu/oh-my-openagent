import { afterEach } from "bun:test"
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

export const CONVERSATION = "conversation-a"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

export type Fixture = {
  readonly pi: FakeExtensionAPI
  readonly ledger: MemoryPendingLedger
  readonly store: ReflectionReservationStore
  readonly launches: ReflectionRequest[]
  readonly logs: Array<{ level: string; message: string; details?: unknown }>
  readonly wiring: ReturnType<typeof createReflectionTriggerWiring>
}

export async function fixture(options: {
  readonly stepCount?: number
  readonly onCompaction?: boolean
  readonly steps?: number
  readonly onLaunch?: (request: ReflectionRequest) => void
  readonly withoutLaunchHandler?: boolean
  readonly session?: ReflectionTriggerSession | undefined
  readonly enabled?: boolean
  readonly onCompactionAccepted?: (conversationId: string) => void
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
  const session: ReflectionTriggerSession = {
    conversationId: CONVERSATION,
    ledger,
    engine: store,
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
  }
  const resolvedSession = "session" in options ? options.session : session

  const pi = new FakeExtensionAPI()
  const wiring = createReflectionTriggerWiring({
    resolveSession: () => resolvedSession,
    ...(options.withoutLaunchHandler === true
      ? {}
      : { onLaunch: options.onLaunch ?? ((request: ReflectionRequest) => void launches.push(request)) }),
    ...(options.onCompactionAccepted === undefined ? {} : { onCompactionAccepted: options.onCompactionAccepted }),
    logger: {
      info: (message, details) => logs.push({ level: "info", message, details }),
      warn: (message, details) => logs.push({ level: "warn", message, details }),
      error: (message, details) => logs.push({ level: "error", message, details }),
    },
  })
  wiring.register(pi)
  return { pi, ledger, store, launches, logs, wiring }
}

export async function agentEnd(pi: FakeExtensionAPI, payload: Record<string, unknown> = {}): Promise<void> {
  await pi.dispatch("agent_end", { type: "agent_end", messages: [], ...payload })
}

export async function settle(pi: FakeExtensionAPI): Promise<void> {
  await pi.dispatch("agent_settled", { type: "agent_settled" })
}

export async function successfulSettle(pi: FakeExtensionAPI): Promise<void> {
  await agentEnd(pi)
  await settle(pi)
}

export async function compact(pi: FakeExtensionAPI, accepted: boolean): Promise<void> {
  await pi.dispatch(
    "session_compact",
    accepted
      ? { type: "session_compact", reason: "auto", requestId: "compact-1", accepted: true, fromExtension: false, willRetry: true }
      : { type: "session_compact", reason: "manual", requestId: "compact-1", accepted: false, rejectionCause: "cancelled-by-extension", fromExtension: false, willRetry: false },
  )
}

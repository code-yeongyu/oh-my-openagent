import { afterEach } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  buildIdentityPaths,
  ReflectionReservationStore,
  TranscriptJournal,
  type MemoryIdentity,
  type ReservedRun,
  type TranscriptEntry,
} from "@oh-my-opencode/memory-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import {
  createDreamTriggerWiring,
  DEFAULT_DREAM_TRIGGER_SETTINGS,
  DREAM_VOLUME_GATE_BYTES,
  evaluateDreamGates,
  resolveDreamTriggerSettings,
  type DreamGateProbe,
  type DreamTriggerSession,
  type DreamTriggerSettings,
} from "./dream-trigger"
import { memorySettings } from "./memory.test-support"
import { createShutdownDrain, type ShutdownDrainSteps } from "./shutdown-drain"

export const CONVERSATION = "conversation-a"
export const NOW_MS = Date.parse("2026-08-10T12:00:00.000Z")
export const IDLE_MS = 30 * 60_000

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

export function triggerSettings(overrides: Partial<DreamTriggerSettings> = {}): DreamTriggerSettings {
  return { ...DEFAULT_DREAM_TRIGGER_SETTINGS, ...overrides }
}

interface FakeScheduled {
  readonly handle: number
  readonly delayMs: number
  readonly fire: () => void
  cancelled: boolean
}

/** Deterministic timer seam: scheduled callbacks run only when the test invokes them. */
export class FakeScheduler {
  readonly scheduled: FakeScheduled[] = []
  private nextHandle = 0

  schedule(fire: () => void, delayMs: number): unknown {
    const entry: FakeScheduled = { handle: ++this.nextHandle, delayMs, fire, cancelled: false }
    this.scheduled.push(entry)
    return entry.handle
  }

  cancel(handle: unknown): void {
    const entry = this.scheduled.find((candidate) => candidate.handle === handle)
    if (entry !== undefined) entry.cancelled = true
  }

  latest(): FakeScheduled {
    const entry = this.scheduled.at(-1)
    if (entry === undefined) throw new Error("expected a scheduled timer")
    return entry
  }
}

export interface Fixture {
  readonly pi: FakeExtensionAPI
  readonly scheduler: FakeScheduler
  readonly store: ReflectionReservationStore
  readonly launches: ReservedRun[]
  readonly idleState: { isIdle: boolean; hasPending: boolean }
  readonly eventCtx: unknown
  readonly wiring: ReturnType<typeof createDreamTriggerWiring>
  readonly identity: MemoryIdentity
  readonly session: DreamTriggerSession
}

export async function fixture(options: {
  readonly settings?: Partial<DreamTriggerSettings>
  readonly lastDreamAt?: string
  readonly conversationText?: string | null
  readonly reservationStore?: DreamTriggerSession["store"]
  readonly now?: () => number
} = {}): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "omo-dream-trigger-"))
  roots.push(root)
  const identity: MemoryIdentity = { id: "agent-test", safeSlug: "agent-test", paths: buildIdentityPaths(root, "agent-test") }
  const text = options.conversationText === undefined ? "x".repeat(DREAM_VOLUME_GATE_BYTES + 1) : options.conversationText
  if (text !== null) await writeConversation(identity.paths.transcripts, CONVERSATION, text)
  if (options.lastDreamAt !== undefined) {
    const dreamDir = join(identity.paths.runtime, "dream")
    await mkdir(dreamDir, { recursive: true })
    await writeFile(join(dreamDir, "state.json"), `${JSON.stringify({ last_dream_at: options.lastDreamAt, lastRunId: "run-0" })}\n`)
  }
  let runCounter = 0
  const store = new ReflectionReservationStore({
    identity,
    config: {},
    getJournal: async (conversationId) => {
      throw new Error(`unexpected journal access: ${conversationId}`)
    },
    createRunId: () => `run-${++runCounter}`,
  })
  const launches: ReservedRun[] = []
  const session: DreamTriggerSession = {
    conversationId: CONVERSATION,
    identity: identity.id,
    identityPaths: identity.paths,
    getJournal: async (conversationId) =>
      new TranscriptJournal({ journalDir: join(identity.paths.transcripts, conversationId) }),
    store: options.reservationStore ?? store,
    launch: (run) => launches.push(run),
  }
  const idleState = { isIdle: true, hasPending: false }
  const eventCtx = {
    sessionManager: { getSessionId: () => CONVERSATION },
    isIdle: () => idleState.isIdle,
    hasPendingMessages: () => idleState.hasPending,
  }
  const scheduler = new FakeScheduler()
  const wiring = createDreamTriggerWiring({
    resolveSession: () => session,
    resolveActiveSession: () => session,
    resolveSessionById: (sessionId) => (sessionId === CONVERSATION ? session : undefined),
    resolveSettings: () => triggerSettings(options.settings),
    now: options.now ?? (() => NOW_MS),
    scheduler,
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  })
  const pi = new FakeExtensionAPI()
  wiring.register(pi)
  return { pi, scheduler, store, launches, idleState, eventCtx, wiring, identity, session }
}

export async function writeConversation(transcriptsDir: string, conversationId: string, text: string): Promise<void> {
  const dir = join(transcriptsDir, conversationId)
  await mkdir(dir, { recursive: true })
  const entry: TranscriptEntry = {
    kind: "user",
    text,
    captured_at: "2026-08-10T11:00:00.000Z",
    source_line_id: `${conversationId}:line:0`,
    source_message_id: `${conversationId}:message:0`,
  }
  await writeFile(join(dir, "transcript.jsonl"), `${JSON.stringify(entry)}\n`)
}

export async function settle(fixture: Fixture, eventCtx: unknown = fixture.eventCtx): Promise<void> {
  await fixture.pi.dispatch("agent_settled", { type: "agent_settled" }, eventCtx)
}

/** Fires the latest scheduled timer and awaits the tracked async fire path. */
export async function fireTimer(fixture: Fixture): Promise<void> {
  fixture.scheduler.latest().fire()
  await fixture.wiring.whenIdle()
}

export function gateProbe(input: { readonly lastDreamAtMs?: number | null; readonly unreflectedBytes?: number } = {}): {
  readonly probe: DreamGateProbe
  readonly calls: { lastDreamAt: number; unreflectedBytes: number }
} {
  const calls = { lastDreamAt: 0, unreflectedBytes: 0 }
  return {
    calls,
    probe: {
      nowMs: NOW_MS,
      lastDreamAtMs: async () => {
        calls.lastDreamAt += 1
        return input.lastDreamAtMs === undefined ? null : input.lastDreamAtMs
      },
      unreflectedBytes: async () => {
        calls.unreflectedBytes += 1
        return input.unreflectedBytes === undefined ? DREAM_VOLUME_GATE_BYTES + 1 : input.unreflectedBytes
      },
    },
  }
}

export const noopSteps: ShutdownDrainSteps = {
  flushJournal: async () => {},
  enqueueFinalDelta: async () => {},
  flushSkillsUsage: async () => {},
  launchFacts: async () => {},
}

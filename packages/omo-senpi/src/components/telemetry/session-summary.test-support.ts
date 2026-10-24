import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { EventTelemetryProperties, TelemetryDiagnosticInput } from "@oh-my-opencode/telemetry-core"

import { createSessionSummaryRecorder, type SessionSummaryOptions, type SessionSummaryRecorder } from "./omo-native-session-summary"
import { createSummaryStorage, type ConsentScope, type SummaryStorage } from "./session-summary-storage"
import type { SummaryTurn } from "./session-summary-window"

export type Published = { readonly uuid: string; readonly properties: EventTelemetryProperties }

export function createTempStateDirs(): { readonly make: () => string; readonly cleanup: () => void } {
  const dirs: string[] = []
  return {
    make() {
      const dir = mkdtempSync(join(tmpdir(), "omo-summary-"))
      dirs.push(dir)
      return dir
    },
    cleanup() {
      for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
    },
  }
}

export function summaryTurn(overrides: Partial<SummaryTurn> = {}): SummaryTurn {
  return {
    turnIndex: 0, provider: "openai", modelId: "gpt-5.5", inputTokens: 10, outputTokens: 20, cacheReadTokens: 3,
    cacheWriteTokens: 4, reasoningTokens: 5, totalTokens: 40, cost1e4: 100, usageValid: true, stopReason: "stop",
    toolResultCount: 2, toolErrorCount: 0, ...overrides,
  }
}

export type TestRecorder = {
  readonly published: Published[]
  readonly observed: unknown[]
  readonly diagnostics: TelemetryDiagnosticInput[]
  readonly summary: SessionSummaryRecorder
  readonly storage: SummaryStorage
  readonly dir: string
  readonly advance: (ms: number) => void
  readonly tick: () => void
}

export type TestRecorderInput = {
  readonly dir: string
  readonly pid?: number
  readonly bootId?: string
  readonly otherPidsAlive?: boolean
  /** Other live processes this one can see; any pid not listed (and not its own) is dead. */
  readonly alivePids?: readonly number[]
  /** Replaces the pid probe built from `otherPidsAlive` / `alivePids`. */
  readonly isPidAlive?: (pid: number) => boolean
  /** Start-time probe; by default every live pid still names the process that registered it. */
  readonly startTimes?: (pid: number) => string | null
  readonly sampleRate?: number
  readonly startAt?: number
  readonly ack?: boolean
  readonly droppedEvents?: () => number
  readonly onPublish?: (event: Published, storage: SummaryStorage) => unknown
  readonly isConsented?: () => boolean
  readonly consentScope?: ConsentScope
  readonly isScopeConsented?: (scope: ConsentScope) => boolean
  readonly loadRecovery?: SessionSummaryOptions["loadRecovery"]
}

export function createTestRecorder(input: TestRecorderInput): TestRecorder {
  const published: Published[] = []
  const observed: unknown[] = []
  const diagnostics: TelemetryDiagnosticInput[] = []
  let clock = input.startAt ?? 1_000_000
  let heartbeat: (() => void) | undefined
  const pid = input.pid ?? process.pid
  const now = () => clock
  const storage = createSummaryStorage({
    stateDir: input.dir,
    owner: { pid, bootId: input.bootId ?? `boot-${pid}` },
    isPidAlive: input.isPidAlive ?? ((candidate) => candidate === pid || (input.otherPidsAlive ?? false) || (input.alivePids ?? []).includes(candidate)),
    processStartTime: input.startTimes ?? (() => "test-process-start"),
    now,
  })
  const summary = createSessionSummaryRecorder({
    ...(input.isConsented === undefined ? {} : { isConsented: input.isConsented }),
    consentScope: () => input.consentScope ?? { cwd: "/repo" },
    ...(input.isScopeConsented === undefined ? {} : { isScopeConsented: input.isScopeConsented }),
    storage,
    publish: async (event) => {
      if (input.onPublish !== undefined) observed.push(input.onPublish(event, storage))
      published.push(event)
      return input.ack ?? true
    },
    sessionRole: "root",
    sampleRate: () => input.sampleRate ?? 0.05,
    now,
    diagnostics: (diagnostic) => diagnostics.push(diagnostic),
    scheduleHeartbeat: (tick) => {
      heartbeat = tick
      return () => {
        heartbeat = undefined
      }
    },
    ...(input.droppedEvents === undefined ? {} : { droppedEvents: input.droppedEvents }),
    ...(input.loadRecovery === undefined ? {} : { loadRecovery: input.loadRecovery }),
  })
  return {
    published,
    observed,
    diagnostics,
    summary,
    storage,
    dir: input.dir,
    advance: (ms) => {
      clock += ms
    },
    tick: () => heartbeat?.(),
  }
}

export const rows = (published: readonly Published[]) =>
  published.map(({ properties }) => [properties.summary_seq, properties.ended_by, properties.turns])

export const summaryKeys = (published: readonly Published[]) =>
  published.map(({ properties }) => `${String(properties.summary_epoch)}:${String(properties.summary_seq)}`)

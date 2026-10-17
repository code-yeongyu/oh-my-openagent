import { expect } from "bun:test"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { TelemetryCaptureMessage } from "@oh-my-opencode/telemetry-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createOmoNativeTelemetryComponent, type OmoNativeTelemetryComponentOptions } from "./omo-native-component"
import type { LoadSummaryRecovery } from "./session-summary-lazy-recovery"
import { createSummaryStorage, summaryDir, OWNER_STALE_MS, type ConsentScope } from "./session-summary-storage"
import { addTurn, openWindow } from "./session-summary-window"
import { summaryTurn } from "./session-summary.test-support"
import {
  FIXED_NOW,
  createEnabledEnv,
  createOsProvider,
  createSilentLogger,
  type RecordedTransport,
} from "./telemetry.test-support"

// No process can hold this pid, so the real liveness probe reports its owner dead.
export const DEAD_PID = 0x7fff_fff0
const DEAD_OWNER = { pid: DEAD_PID, bootId: "killed" }

export function inProject(sessionId: string, cwd?: string): Record<string, unknown> {
  return { ...(cwd === undefined ? {} : { cwd }), sessionManager: { getSessionId: () => sessionId } }
}

export function writeInventory(agentDir: string): void {
  mkdirSync(agentDir, { recursive: true })
  writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: { openai: { models: [{ id: "gpt-5.6-sol" }] } } }))
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "openai", defaultModel: "gpt-5.6-sol" }))
}

export function turnEnd(): Record<string, unknown> {
  return {
    type: "turn_end",
    turnIndex: 1,
    message: {
      role: "assistant", content: [], api: "openai-responses", provider: "openai", model: "gpt-5.6-sol",
      usage: {
        input: 11, output: 22, cacheRead: 3, cacheWrite: 4, reasoning: 5, totalTokens: 40,
        cost: { input: 0.1, output: 0.2, cacheRead: 0.03, cacheWrite: 0.04, total: 0.123456 },
      },
      stopReason: "stop", timestamp: 1,
    },
    toolResults: [],
  }
}

export function summaryFiles(stateDir: string): string[] {
  const root = summaryDir(stateDir)
  if (!existsSync(root)) return []
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(root.length + 1))
    .sort()
}

export function readSummaryFile(stateDir: string, name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(summaryDir(stateDir), name), "utf8"))
}

/** A file holds telemetry content when it is a window with an open window, or any pending event. */
export function contentFiles(stateDir: string): string[] {
  return summaryFiles(stateDir).filter((name) => {
    if (name.startsWith("pending/")) return true
    if (name.startsWith("owners/")) return false
    if (!name.endsWith(".json")) return true
    return readSummaryFile(stateDir, name).window !== null
  })
}

export function seedDeadOwnerQueue(stateDir: string, input: { readonly sessionHash: string; readonly scope: ConsentScope; readonly claimed?: boolean; readonly ownerPid?: number }): void {
  const owner = { pid: input.ownerPid ?? DEAD_PID, bootId: "killed" }
  const storage = createSummaryStorage({ stateDir, owner, isPidAlive: () => false })
  const window = openWindow(FIXED_NOW.getTime(), 0)
  addTurn(window, summaryTurn(), FIXED_NOW.getTime())
  const record = {
    consent: "enabled" as const, scope: input.scope, sessionHash: input.sessionHash, sessionRole: "root" as const,
    owner, heartbeatAt: Date.now() - OWNER_STALE_MS - 60_000, epoch: "0123456789abcdef", seq: 3, sampleRate: 0, windowId: randomUUID(), window,
  }
  const key = storage.windowKey(input.sessionHash)
  storage.writeWindow(key, record)
  storage.writePending({
    consent: "enabled", scope: input.scope, uuid: randomUUID(), sessionHash: input.sessionHash, owner,
    createdAt: Date.now(), properties: { summary_seq: 2 },
  })
  if (input.claimed === true) {
    const path = join(summaryDir(stateDir), `${key}.json`)
    renameSync(path, `${path}.claimed-${owner.pid}-killed`)
  }
}

export function killWithoutShutdown(stateDir: string): void {
  for (const name of summaryFiles(stateDir).filter((entry) => !entry.includes("/") && entry.endsWith(".json"))) {
    const path = join(summaryDir(stateDir), name)
    const record: Record<string, unknown> = JSON.parse(readFileSync(path, "utf8"))
    writeFileSync(path, JSON.stringify({ ...record, owner: DEAD_OWNER, heartbeatAt: Date.now() - OWNER_STALE_MS - 60_000 }))
  }
}

export async function registerProcess(input: {
  readonly agentDir: string
  readonly recorder: RecordedTransport
  readonly env?: Record<string, string>
  readonly cwd?: string
  readonly options?: Partial<OmoNativeTelemetryComponentOptions>
}): Promise<FakeExtensionAPI> {
  const pi = new FakeExtensionAPI()
  if (input.cwd !== undefined) pi.cwd = input.cwd
  let purged: Promise<void> = Promise.resolve()
  createOmoNativeTelemetryComponent({
    rawTurnSampleRate: 0,
    env: { ...createEnabledEnv(input.agentDir), ...input.env },
    hashSessionId: (raw) => `hashed:${raw}`,
    now: FIXED_NOW,
    osProvider: createOsProvider("optout-host"),
    stateDir: join(input.agentDir, "omo-senpi", "omo-native"),
    transportFactory: input.recorder.factory,
    onOptOutPurge: (purge) => {
      purged = purge
    },
    ...input.options,
  }).register(pi, { config: pi, logger: createSilentLogger() })
  // An opted-out start purges in the background; the process is registered once that purge settled.
  await purged
  return pi
}

// The collector deduplicates session_summary rows on (session hash, summary_epoch, summary_seq): two rows
// with the same pair would collapse into one and lose a window's totals.
export function expectNoRepeatedSummaryKey(recorder: RecordedTransport, sessionHash: string, rows: number): void {
  const keys = recorder.messages
    .filter(({ event, properties }) => event === "session_summary" && properties?.$session_id === sessionHash)
    .map(({ properties }) => `${String(properties?.summary_epoch)}:${String(properties?.summary_seq)}`)
  expect(keys).toHaveLength(rows)
  expect(keys.every((key) => !key.startsWith("undefined:"))).toBe(true)
  expect(new Set(keys).size).toBe(keys.length)
}

export type WatchedTransport = RecordedTransport & {
  /** Resolves once `count` session_summary rows for the session were captured; rejects after `timeoutMs`. */
  readonly summariesSent: (sessionHash: string, count: number, timeoutMs?: number) => Promise<void>
}

// A checkpoint is sent after the turn handler returned (the send step loads with the recovery sidecar), so a
// test waits for the captured row itself instead of for the dispatch.
export function createWatchedTransport(): WatchedTransport {
  const messages: TelemetryCaptureMessage[] = []
  const waiters = new Set<() => void>()
  const recorded: RecordedTransport = {
    messages,
    factory: () => ({
      capture(message) {
        messages.push(message)
        for (const wake of waiters) wake()
      },
      flush: async () => undefined,
      shutdown: async () => undefined,
    }),
  }
  return {
    ...recorded,
    summariesSent: (sessionHash, count, timeoutMs = 2_000) => new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters.delete(check)
        reject(new Error(`expected ${count} session_summary rows for ${sessionHash}, saw ${sentSeqs(recorded, sessionHash).length}`))
      }, timeoutMs)
      function check(): void {
        if (sentSeqs(recorded, sessionHash).length < count) return
        clearTimeout(timer)
        waiters.delete(check)
        resolve()
      }
      waiters.add(check)
      check()
    }),
  }
}

// The send step (which retires a pending file on acknowledgment) runs after the turn handler returned. Tests load
// the real sidecar through this wrapper and await the very send promises it started.
export function trackedSidecar(): { readonly load: LoadSummaryRecovery; readonly sendsSettled: () => Promise<void> } {
  const sends: Promise<void>[] = []
  const load: LoadSummaryRecovery = () => import("./session-summary-recovery").then((sidecar) => ({
    ...sidecar,
    sendSummaryRecord: (...args: Parameters<typeof sidecar.sendSummaryRecord>) => {
      const send = sidecar.sendSummaryRecord(...args)
      sends.push(send)
      return send
    },
  }))
  return {
    load,
    sendsSettled: async () => {
      await Promise.all(sends)
    },
  }
}

export function sentSeqs(recorder: RecordedTransport, sessionHash: string): unknown[] {
  return recorder.messages
    .filter(({ event, properties }) => event === "session_summary" && properties?.$session_id === sessionHash)
    .map(({ properties }) => properties?.summary_seq)
}

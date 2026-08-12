import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, rm } from "node:fs/promises"
import { basename, join } from "node:path"

import {
  getPidLiveness,
  getProcessStartIdentity,
  type FactsQueueEntry,
} from "@oh-my-opencode/memory-core"

import { readRunJson, writeRunJsonAtomic } from "./worker/run-artifacts"
import type { FactsFinalRecord, FactsLaunchResult, FactsRunLedger } from "./facts-runner-types"

const DEFAULT_DEADLINE_MS = 15 * 60_000
const DEFAULT_GRACE_MS = 5_000

export async function reserveFactsRunDir(options: {
  readonly factsDir: string
  readonly entries: readonly FactsQueueEntry[]
  readonly batchId: string
  readonly launchedAt: number
  readonly deadlineMs?: number
  readonly terminationGraceMs?: number
}): Promise<string | undefined> {
  const runsDir = join(options.factsDir, "runs")
  await mkdir(runsDir, { recursive: true, mode: 0o700 })
  const digest = createHash("sha256").update(JSON.stringify(queueKeys(options.entries))).digest("hex").slice(0, 12)
  for (let attempt = 1; attempt < 10_000; attempt += 1) {
    const runDir = join(runsDir, `facts-${digest}-${attempt}`)
    try {
      await mkdir(runDir, { mode: 0o700 })
      const deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS
      const terminationGraceMs = options.terminationGraceMs ?? DEFAULT_GRACE_MS
      try {
        await writeRunJsonAtomic(join(runDir, "ledger.json"), {
          version: 1,
          runId: basename(runDir),
          kind: "facts",
          startedAt: new Date(options.launchedAt).toISOString(),
          hardDeadlineAt: options.launchedAt + deadlineMs,
          terminationGraceMs,
          deadlineAt: options.launchedAt + deadlineMs + terminationGraceMs,
          batchId: options.batchId,
          queued: queueKeys(options.entries),
        } satisfies FactsRunLedger)
      } catch (error) {
        await rm(runDir, { recursive: true, force: true })
        throw error
      }
      return runDir
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error
      if (!existsSync(join(runDir, "final.json")) && !existsSync(join(runDir, "abandoned.json"))) return undefined
    }
  }
  throw new Error("facts run sequence exhausted")
}

export async function writeFactsFinal(options: {
  readonly runDir: string
  readonly runId: string
  readonly outcome: "committed" | "no_facts" | "failed" | "parent_dirty"
  readonly now: () => Date
  readonly detail?: string
  readonly sha?: string
}): Promise<void> {
  await writeRunJsonAtomic(join(options.runDir, "final.json"), {
    version: 1,
    runId: options.runId,
    outcome: options.outcome,
    finishedAt: options.now().toISOString(),
    ...(options.detail === undefined ? {} : { detail: options.detail }),
    ...(options.sha === undefined ? {} : { sha: options.sha }),
  })
}

export async function runLiveness(ledger: FactsRunLedger): Promise<"alive" | "dead" | "unknown"> {
  const identities = [
    [ledger.pid, ledger.processStart],
    [ledger.childPid, ledger.childProcessStart],
  ] as const
  let unknown = false
  for (const [pid, expectedStart] of identities) {
    if (pid === undefined) {
      unknown = true
      continue
    }
    const liveness = getPidLiveness(pid)
    if (liveness === "dead") continue
    if (liveness === "unknown" || expectedStart === null || expectedStart === undefined) {
      unknown = true
      continue
    }
    const actualStart = await getProcessStartIdentity(pid)
    if (actualStart === null) unknown = true
    else if (actualStart === expectedStart) return "alive"
  }
  return unknown ? "unknown" : "dead"
}

export function queueKeys(entries: readonly FactsQueueEntry[]) {
  return entries.map((entry) => ({
    conversationId: entry.conversationId,
    end_message_id: entry.range.end_message_id,
  }))
}

export function finalResult(record: FactsFinalRecord): FactsLaunchResult {
  if (record.outcome === "committed" && record.sha !== undefined) {
    return { status: "committed", runId: record.runId, sha: record.sha }
  }
  if (record.outcome === "no_facts" || record.outcome === "parent_dirty") {
    return { status: record.outcome, runId: record.runId }
  }
  return { status: "failed", runId: record.runId }
}

export function delay(_attempt: number, milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error ? String(error.code) : undefined
}

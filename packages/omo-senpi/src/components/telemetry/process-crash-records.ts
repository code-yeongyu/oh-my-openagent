import { createHash } from "node:crypto"
import { closeSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { join } from "node:path"

/**
 * The crash records the engine (and the task parent of a process-mode child) leave on disk, read
 * back so each can be reported exactly once.
 *
 * - `<agentDir>/rpc-host-daemon/<endpoint>/crashes.jsonl`: written by the RPC host supervisor when
 *   its child dies. Records written before the engine named them carry no `kind`/`detection`.
 * - `<agentDir>/process-crashes/crashes.jsonl`: dead lifetime markers of unsupervised processes
 *   and process-mode task children that died under their parent.
 *
 * Reporting is claim-then-send: a record is claimed by exclusively creating a file named after its
 * fingerprint, so any number of concurrent reporters (every session in one RPC host, two terminals)
 * send it once. A send that fails after the claim is lost, never repeated.
 */

export type ProcessCrashRecord = {
  readonly at: string
  readonly uptimeMs: number
  readonly signal?: string
  readonly code?: number
  readonly kind?: string
  readonly detection?: string
  readonly bunVersion?: string
  readonly engineVersion?: string
  readonly productVersion?: string
}

export type ClaimedCrashRecord = {
  readonly record: ProcessCrashRecord
  readonly source: "rpc-host" | "process"
}

export type ClaimCrashRecordsInput = {
  readonly agentDir: string
  readonly stateDir: string
  readonly now: Date
  readonly maxRecords?: number
  readonly maxAgeMs?: number
}

/** Records older than this are history, not news; they stay on disk but are never sent. */
export const CRASH_REPORT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000
/** A crash loop must not turn one start into a burst of events; the rest wait for later starts. */
export const CRASH_REPORTS_PER_START = 20
const STALE_CLAIM_MS = 24 * 60 * 60 * 1000

export function crashClaimDir(stateDir: string): string {
  return join(stateDir, "crash-reports")
}

export function claimUnreportedCrashRecords(input: ClaimCrashRecordsInput): readonly ClaimedCrashRecord[] {
  const claimDir = crashClaimDir(input.stateDir)
  mkdirSync(claimDir, { recursive: true, mode: 0o700 })
  const maxRecords = input.maxRecords ?? CRASH_REPORTS_PER_START
  const oldest = input.now.getTime() - (input.maxAgeMs ?? CRASH_REPORT_MAX_AGE_MS)
  const live = new Set<string>()
  const claimed: ClaimedCrashRecord[] = []
  for (const source of crashRecordSources(input.agentDir)) {
    for (const line of readLines(source.file)) {
      const record = parseCrashRecord(line)
      if (record === undefined) continue
      const fingerprint = createHash("sha256").update(`${source.id}\n${line}`).digest("hex").slice(0, 32)
      live.add(fingerprint)
      if (claimed.length >= maxRecords || Date.parse(record.at) < oldest) continue
      if (claim(join(claimDir, fingerprint))) claimed.push({ record, source: source.kind })
    }
  }
  pruneStaleClaims(claimDir, live, input.now.getTime())
  return claimed
}

export function parseCrashRecord(line: string): ProcessCrashRecord | undefined {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return undefined
  }
  if (!isRecord(value)) return undefined
  const { at, uptimeMs } = value
  if (typeof at !== "string" || Number.isNaN(Date.parse(at))) return undefined
  if (typeof uptimeMs !== "number" || !Number.isFinite(uptimeMs) || uptimeMs < 0) return undefined
  return {
    at,
    uptimeMs,
    ...optionalString(value, "signal"),
    ...(Number.isInteger(value.code) ? { code: value.code as number } : {}),
    ...optionalString(value, "kind"),
    ...optionalString(value, "detection"),
    ...optionalString(value, "bunVersion"),
    ...renamed(optionalString(value, "senpiVersion").senpiVersion, "engineVersion"),
    ...optionalString(value, "productVersion"),
  }
}

type CrashRecordSource = { readonly id: string; readonly file: string; readonly kind: "rpc-host" | "process" }

function crashRecordSources(agentDir: string): readonly CrashRecordSource[] {
  const sources: CrashRecordSource[] = [
    { id: "process-crashes", file: join(agentDir, "process-crashes", "crashes.jsonl"), kind: "process" },
  ]
  let endpoints: string[] = []
  try {
    endpoints = readdirSync(join(agentDir, "rpc-host-daemon"))
  } catch {
    return sources
  }
  for (const endpoint of endpoints.sort()) {
    sources.push({
      id: `rpc-host-daemon/${endpoint}`,
      file: join(agentDir, "rpc-host-daemon", endpoint, "crashes.jsonl"),
      kind: "rpc-host",
    })
  }
  return sources
}

function readLines(file: string): readonly string[] {
  try {
    return readFileSync(file, "utf8").split("\n").map((line) => line.trim()).filter((line) => line.length > 0)
  } catch {
    return []
  }
}

/** `wx` is an atomic exclusive create: exactly one reporter ever succeeds for a fingerprint. */
function claim(path: string): boolean {
  try {
    closeSync(openSync(path, "wx", 0o600))
    return true
  } catch {
    return false
  }
}

/**
 * A claim outlives its record by a day, so a reporter that read the file just before the engine pruned
 * that record still finds the claim and cannot send it twice.
 */
function pruneStaleClaims(claimDir: string, live: ReadonlySet<string>, now: number): void {
  for (const name of safeReaddir(claimDir)) {
    if (live.has(name)) continue
    const path = join(claimDir, name)
    try {
      if (now - statSync(path).mtimeMs > STALE_CLAIM_MS) rmSync(path, { force: true })
    } catch {}
  }
}

function safeReaddir(dir: string): readonly string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

function renamed<Key extends string>(value: string | undefined, key: Key): { [K in Key]?: string } {
  return (value === undefined ? {} : { [key]: value }) as { [K in Key]?: string }
}

function optionalString<Key extends string>(value: Record<string, unknown>, key: Key): { [K in Key]?: string } {
  const property = value[key]
  return (typeof property === "string" ? { [key]: property } : {}) as { [K in Key]?: string }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

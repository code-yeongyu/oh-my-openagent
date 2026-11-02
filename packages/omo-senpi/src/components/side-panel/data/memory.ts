import { open, readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

import {
  REFLECTION_PARK_PROBE_INTERVAL_MS,
  PENDING_NUDGES_VERSION,
  containsSecretLikeMaterial,
  isValidHint,
  readReflectionParkFile,
  sanitizeSessionFilename,
  type ReflectionParkState,
} from "@oh-my-opencode/memory-core"

import { kibitzerWakesFile } from "../../memory/kibitzer/observe-paths"
import { KIBITZER_WAKES_TAIL_BYTES } from "../constants"
import { asArray, asRecord, finiteNumber, nonEmptyString, optional } from "../guards"
import type {
  PanelMemory,
  PanelMemoryIdentity,
  PanelMemoryKibitzer,
  PanelMemoryReflection,
  PanelMemorySource,
} from "../types"

/**
 * What the memory subsystem is holding for this session, as the column needs to draw it.
 *
 * Everything here is durable state: the park file the reflection scheduler writes, the facts
 * batches waiting to be applied, and the per-session recall pair. The kibitzer's own liveness is
 * deliberately absent - it lives in the sidecar process as `KibitzerSidecarState` and nothing
 * persists it, so a column claiming "awake" would be guessing.
 *
 * The reads are async and therefore ride the panel's async refresh, behind a floor in the caller:
 * a park transition takes three failed reflection runs and the facts queue drains per reflection,
 * so nothing here is worth a directory listing per tool call.
 */
export function createPanelMemoryReader(
  source: PanelMemorySource = nodeMemorySource,
  now: () => number = Date.now,
): (identity: PanelMemoryIdentity | undefined, sessionId: string | undefined) => Promise<PanelMemory | undefined> {
  return async (identity, sessionId) => {
    // Memory can be switched off, and the identity can fail to resolve. Both mean a silent block
    // rather than an empty heading - and neither should cost a filesystem call.
    if (identity === undefined) return undefined
    const [park, queued, recall, kibitzer] = await Promise.all([
      source.park(identity.reflectionDir),
      source.list(identity.factsQueueDir),
      readRecall(source, identity, sessionId, now()),
      readKibitzer(source, identity, sessionId),
    ])
    return {
      identity: identity.id,
      factsQueued: queued.filter(isQueuedBatch).length,
      ...recall,
      ...optional("reflection", reflectionFrom(park)),
      ...optional("kibitzer", kibitzer),
    }
  }
}

/** The queue directory also holds its own bookkeeping; only the batch files are backlog. */
const QUEUE_BOOKKEEPING: readonly string[] = ["claims.json", "consumed.json", "failures.json"]

function isQueuedBatch(name: string): boolean {
  return name.endsWith(".json") && !QUEUE_BOOKKEEPING.includes(name)
}

function reflectionFrom(park: ReflectionParkState | undefined): PanelMemoryReflection | undefined {
  if (park === undefined) return undefined
  // An empty park state is what a healthy identity looks like, and "nothing is wrong" is not a row.
  if (park.streak === 0 && park.parkedAt === undefined) return undefined
  const failure = park.lastFailure
  return {
    streak: park.streak,
    ...optional("parkedAt", park.parkedAt),
    ...optional("nextProbeAt", nextProbeAt(park)),
    ...optional("reason", failure?.reason),
    ...optional("detail", failure?.detail),
  }
}

/**
 * Mirrors `reflectionParkNextProbeAt` (`components/memory/worker/park-alert.ts`), which is not
 * imported: that module pulls senpi's entry-renderer surface and the reflection completion
 * runtime behind it, for one line of arithmetic over a constant memory-core already exports.
 * The interval runs from the last half-open probe when there was one, exactly as the host gates it.
 */
function nextProbeAt(park: ReflectionParkState): string | undefined {
  if (park.parkedAt === undefined) return undefined
  return new Date(Date.parse(park.lastProbeAt ?? park.parkedAt) + REFLECTION_PARK_PROBE_INTERVAL_MS).toISOString()
}

async function readRecall(
  source: PanelMemorySource,
  identity: PanelMemoryIdentity,
  sessionId: string | undefined,
  now: number,
): Promise<{ recallSurfaced: number; recallPending: number }> {
  if (sessionId === undefined) return { recallSurfaced: 0, recallPending: 0 }
  const file = `${sanitizeSessionFilename(sessionId)}.json`
  const [ledger, pending] = await Promise.all([
    source.readJson(join(identity.recallLedgerDir, file)),
    source.readJson(join(identity.recallPendingDir, file)),
  ])
  return { recallSurfaced: countSurfaced(ledger), recallPending: countPending(pending, sessionId, now) }
}

function countSurfaced(value: unknown): number {
  const surfaced = asRecord(asRecord(value)?.["surfaced"])
  return surfaced === undefined ? 0 : Object.keys(surfaced).length
}

/**
 * `sanitizeSessionFilename` maps distinct session ids onto one filename, so the embedded id is
 * verified before the payload is counted - the same check `PendingNudges.take()` makes before it
 * trusts a file. Nothing here consumes: `take()` deletes, and a status column that ate the
 * session's nudges would be a bug wearing a rendering choice.
 */
function countPending(value: unknown, sessionId: string, now: number): number {
  const record = asRecord(value)
  if (record === undefined || record["version"] !== PENDING_NUDGES_VERSION || record["sessionId"] !== sessionId) return 0
  const writtenAt = typeof record["writtenAt"] === "string" ? Date.parse(record["writtenAt"]) : Number.NaN
  if (!Number.isFinite(writtenAt) || now - writtenAt > 24 * 60 * 60_000) return 0
  const nudges = asArray(record["nudges"])
  for (const value of nudges) {
    const nudge = asRecord(value)
    const path = nonEmptyString(nudge?.["path"])
    const hint = nonEmptyString(nudge?.["hint"])
    if (path === undefined || hint === undefined || !isValidHint(hint) || containsSecretLikeMaterial(hint)) return 0
  }
  return nudges.length
}

/**
 * The kibitzer's sidecar log: `recall/sidecars/<encoded-session>/wakes.ndjson`, one closed record
 * per settled wake. This is the only durable trace the sidecar leaves - its own state machine
 * lives in its process - so the column reports what it did, never whether it is awake right now.
 *
 * Lines are parsed fail-closed one by one, the way the host parses its own nudge file: the writer
 * appends while this reads, so meeting a half-written last line is ordinary, not a corruption.
 */
async function readKibitzer(
  source: PanelMemorySource,
  identity: PanelMemoryIdentity,
  sessionId: string | undefined,
): Promise<PanelMemoryKibitzer | undefined> {
  if (sessionId === undefined) return undefined
  const tail = await source.readTail(kibitzerWakesFile(identity.recallDir, sessionId), KIBITZER_WAKES_TAIL_BYTES)
  if (tail === undefined) return undefined
  let wakes = 0
  let nudged = 0
  let tokens = 0
  let last: Record<PropertyKey, unknown> | undefined
  for (const line of tail.text.split("\n")) {
    if (line.trim() === "") continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    const record = asRecord(parsed)
    if (record === undefined) continue
    wakes += 1
    nudged += asArray(record["nudged"]).length
    tokens += usageTokens(record["usage"])
    last = record
  }
  if (wakes === 0) return undefined
  return {
    wakes,
    nudged,
    tokens,
    partial: tail.truncated,
    lastFailed: last?.["diagnostic"] === true,
    ...optional("lastWakeAt", nonEmptyString(last?.["at"])),
    ...optional("lastStatus", nonEmptyString(last?.["status"])),
  }
}

function usageTokens(value: unknown): number {
  const usage = asRecord(value)
  if (usage === undefined) return 0
  let total = 0
  for (const key of ["input", "output", "cacheRead", "cacheWrite"]) total += finiteNumber(usage[key]) ?? 0
  return total
}

const nodeMemorySource: PanelMemorySource = {
  async park(reflectionDir) {
    try {
      return await readReflectionParkFile(reflectionDir)
    } catch {
      // A hand-edited or truncated park.json must not blank the identity and the backlog with it.
      return undefined
    }
  },
  async list(dir) {
    try {
      return await readdir(dir)
    } catch {
      // The runtime tree is created lazily, so an absent directory is the ordinary first-run case.
      return []
    }
  },
  async readJson(path) {
    try {
      return JSON.parse(await readFile(path, "utf8"))
    } catch {
      return undefined
    }
  },
  async readTail(path, maxBytes) {
    let handle: Awaited<ReturnType<typeof open>> | undefined
    try {
      handle = await open(path, "r")
      const info = await handle.stat()
      const truncated = info.size > maxBytes
      const length = truncated ? maxBytes : info.size
      const buffer = Buffer.alloc(length)
      await handle.read(buffer, 0, length, info.size - length)
      const text = buffer.toString("utf8")
      // A tail begins mid-record; the partial head is dropped here so no parser ever meets it.
      return { text: truncated ? text.slice(text.indexOf("\n") + 1) : text, truncated }
    } catch {
      return undefined
    } finally {
      await handle?.close()
    }
  },
}

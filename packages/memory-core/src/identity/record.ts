// `identity.json` (#10070): what the identity directory itself knows about how sessions reached it.
// Written at every bind, it is the evidence `/memory-merge` maps old identities from: which mode
// derived the id, from which source, and every directory spelling a session bound it from. A record
// that cannot be read is replaced, never allowed to fail a bind.

import { join } from "node:path"

import { mkdir, readFile } from "../fs/resilient"
import { createLockRecord, withLock } from "../locks"
import { writeJsonAtomic } from "../reflection/reservation-files"
import type { AutoIdentityMode } from "./resolve"

export const IDENTITY_RECORD_FILENAME = "identity.json"

export type IdentityKind = "auto" | "explicit"

export interface IdentityRecord {
  readonly version: 1
  readonly id: string
  readonly kind: IdentityKind
  readonly mode: AutoIdentityMode
  readonly source: string
  readonly spellings: readonly string[]
  readonly firstBoundAt: number
  readonly lastBoundAt: number
  /** Set by `/memory-merge --apply`: the identity this one was merged into, and its head at that merge. */
  readonly mergedInto?: string
  readonly mergedHead?: string
}

export interface IdentityBind {
  readonly id: string
  readonly kind: IdentityKind
  readonly mode: AutoIdentityMode
  readonly source: string
  readonly spelling: string
}

export async function readIdentityRecord(identityRoot: string): Promise<IdentityRecord | undefined> {
  let raw: string
  try {
    raw = await readFile(join(identityRoot, IDENTITY_RECORD_FILENAME), "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
  try {
    return parseIdentityRecord(JSON.parse(raw))
  } catch {
    return undefined
  }
}

const RECORD_LOCK_FILENAME = "identity.json.lock"
const RECORD_LOCK_WAIT_MS = 10_000

/**
 * Every update of `identity.json` is a read-modify-write: a bind from one folder and a merge mark (or a
 * bind from another worktree) landing together would otherwise drop a spelling or the merge markers.
 */
async function withRecordLock<T>(identityRoot: string, operation: () => Promise<T>): Promise<T> {
  await mkdir(identityRoot, { recursive: true })
  return withLock(join(identityRoot, RECORD_LOCK_FILENAME), await createLockRecord("identity record"), operation, { waitTimeoutMs: RECORD_LOCK_WAIT_MS })
}

export function recordIdentityBind(identityRoot: string, bind: IdentityBind, now: number): Promise<IdentityRecord> {
  return withRecordLock(identityRoot, () => writeIdentityBind(identityRoot, bind, now))
}

async function writeIdentityBind(identityRoot: string, bind: IdentityBind, now: number): Promise<IdentityRecord> {
  const previous = await readIdentityRecord(identityRoot).catch(() => undefined)
  const kept = previous?.id === bind.id ? previous : undefined
  const record: IdentityRecord = {
    version: 1,
    id: bind.id,
    kind: bind.kind,
    mode: bind.mode,
    source: bind.source,
    spellings: kept === undefined || kept.spellings.includes(bind.spelling) ? [...(kept?.spellings ?? [bind.spelling])] : [...kept.spellings, bind.spelling],
    firstBoundAt: kept?.firstBoundAt ?? now,
    lastBoundAt: now,
    ...(kept?.mergedInto === undefined ? {} : { mergedInto: kept.mergedInto }),
    ...(kept?.mergedHead === undefined ? {} : { mergedHead: kept.mergedHead }),
  }
  await writeJsonAtomic(join(identityRoot, IDENTITY_RECORD_FILENAME), record)
  return record
}

export function markIdentityMerged(identityRoot: string, id: string, mergedInto: string, mergedHead: string, now: number): Promise<IdentityRecord> {
  return withRecordLock(identityRoot, () => writeIdentityMerged(identityRoot, id, mergedInto, mergedHead, now))
}

async function writeIdentityMerged(identityRoot: string, id: string, mergedInto: string, mergedHead: string, now: number): Promise<IdentityRecord> {
  const previous = await readIdentityRecord(identityRoot).catch(() => undefined)
  const base: IdentityRecord = previous?.id === id
    ? previous
    : { version: 1, id, kind: "auto", mode: "path", source: "", spellings: [], firstBoundAt: now, lastBoundAt: now }
  const record: IdentityRecord = { ...base, mergedInto, mergedHead }
  await writeJsonAtomic(join(identityRoot, IDENTITY_RECORD_FILENAME), record)
  return record
}

function parseIdentityRecord(value: unknown): IdentityRecord | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const record = value as Record<string, unknown>
  const spellings = record.spellings
  if (record.version !== 1 || typeof record.id !== "string" || typeof record.source !== "string") return undefined
  if (record.kind !== "auto" && record.kind !== "explicit") return undefined
  if (record.mode !== "path" && record.mode !== "git") return undefined
  if (!Array.isArray(spellings) || !spellings.every((spelling) => typeof spelling === "string")) return undefined
  if (typeof record.firstBoundAt !== "number" || typeof record.lastBoundAt !== "number") return undefined
  return {
    version: 1,
    id: record.id,
    kind: record.kind,
    mode: record.mode,
    source: record.source,
    spellings,
    firstBoundAt: record.firstBoundAt,
    lastBoundAt: record.lastBoundAt,
    ...(typeof record.mergedInto === "string" ? { mergedInto: record.mergedInto } : {}),
    ...(typeof record.mergedHead === "string" ? { mergedHead: record.mergedHead } : {}),
  }
}

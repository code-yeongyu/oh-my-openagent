// `identity.json` (#10070): what the identity directory itself knows about how sessions reached it.
// Written at every bind, it is the evidence `/memory-merge` maps old identities from: which mode
// derived the id, from which source, and every directory spelling a session bound it from. A record
// that cannot be read is replaced, never allowed to fail a bind.

import { join } from "node:path"

import { readFile } from "../fs/resilient"
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

export async function recordIdentityBind(identityRoot: string, bind: IdentityBind): Promise<IdentityRecord> {
  const previous = await readIdentityRecord(identityRoot).catch(() => undefined)
  const kept = previous?.id === bind.id ? previous : undefined
  const record: IdentityRecord = {
    version: 1,
    id: bind.id,
    kind: bind.kind,
    mode: bind.mode,
    source: bind.source,
    spellings: kept === undefined || kept.spellings.includes(bind.spelling) ? [...(kept?.spellings ?? [bind.spelling])] : [...kept.spellings, bind.spelling],
  }
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
  return {
    version: 1,
    id: record.id,
    kind: record.kind,
    mode: record.mode,
    source: record.source,
    spellings,
  }
}

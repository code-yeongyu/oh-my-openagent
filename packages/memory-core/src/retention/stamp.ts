// The resume points of an interrupted pass (design 6, N3): `runtime/retention.json` holds ONLY the
// store walk's cursor and, in its own `cap` field, the size cap's resume point; it is written only
// when one of them stopped early and deleted when neither did. The cap's resume point is read only by
// the cap, so it never makes the store walk skip a store (#12538 review r4 M). The completion stamp
// lives in the memory repo's git config (`omo.retentionAt`), written by the caller. A cap resume point
// whose pass could not even measure runtime/ inside the budget is marked `capStalled`: it waits for the
// next interval instead of the next bind (#12538 review r5 L1).

import { randomUUID } from "node:crypto"
import { join } from "node:path"

import { readFile, rename, rm, writeFile } from "../fs/resilient"
import type { RetentionCursor } from "./budget"
import type { RuntimeCapCursor } from "./cap"

export const RETENTION_STAMP_CONFIG_KEY = "omo.retentionAt"
const CURSOR_FILE = "retention.json"

export function retentionCursorPath(runtimeDir: string): string {
  return join(runtimeDir, CURSOR_FILE)
}

export interface RetentionResumePoints {
  /** Where the store walk resumes. */
  readonly cursor?: RetentionCursor
  /** Where the size cap resumes its tier walk. */
  readonly cap?: RuntimeCapCursor
  /** Set with `cap` when the cap's last pass could not measure runtime/ inside the budget. */
  readonly capStalled?: true
}

interface StoredCursor {
  readonly store?: unknown
  readonly lastName?: unknown
  readonly tier?: unknown
  readonly clock?: unknown
}

export async function readRetentionResumePoints(runtimeDir: string): Promise<RetentionResumePoints> {
  let parsed: { readonly cursor?: StoredCursor; readonly cap?: StoredCursor; readonly capStalled?: unknown }
  try {
    parsed = JSON.parse(await readFile(retentionCursorPath(runtimeDir), "utf8")) as typeof parsed
  } catch {
    return {}
  }
  // A file written before the cap had its own field holds the cap's resume point as the cursor.
  if (parsed.cursor?.store === "cap") return capResumePoint(parsed.cursor)
  const resumed = capResumePoint(parsed.cap)
  const cap =
    resumed.cap !== undefined && parsed.capStalled === true ? { ...resumed, capStalled: true as const } : resumed
  const cursor = parsed.cursor
  if (typeof cursor?.store !== "string") return cap
  return {
    cursor: { store: cursor.store, ...(typeof cursor.lastName === "string" ? { lastName: cursor.lastName } : {}) },
    ...cap,
  }
}

function capResumePoint(cursor: StoredCursor | undefined): RetentionResumePoints {
  if (cursor?.store !== "cap" || typeof cursor.tier !== "string" || typeof cursor.lastName !== "string") return {}
  if (typeof cursor.clock !== "number" || !Number.isFinite(cursor.clock)) return {}
  return { cap: { store: "cap", tier: cursor.tier, clock: cursor.clock, lastName: cursor.lastName } }
}

/**
 * Whether an interrupted pass left work the next bind must resume whatever the completion stamp says:
 * a store-walk cursor, or a cap resume point whose pass was not stalled at its measurement.
 */
export async function retentionResumePending(runtimeDir: string): Promise<boolean> {
  const points = await readRetentionResumePoints(runtimeDir)
  return points.cursor !== undefined || (points.cap !== undefined && points.capStalled !== true)
}

export async function writeRetentionResumePoints(runtimeDir: string, points: RetentionResumePoints): Promise<void> {
  const target = retentionCursorPath(runtimeDir)
  const temporary = `${target}.tmp-${randomUUID()}`
  try {
    await writeFile(temporary, `${JSON.stringify({ version: 1, ...points })}\n`, { encoding: "utf8", mode: 0o600 })
    await rename(temporary, target)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

export async function clearRetentionCursor(runtimeDir: string): Promise<void> {
  await rm(retentionCursorPath(runtimeDir), { force: true })
}

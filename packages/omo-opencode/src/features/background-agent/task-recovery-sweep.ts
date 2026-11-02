import { createHash } from "node:crypto"
import { readdir, readFile, stat, unlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import { TaskOwnerSchema, TaskRecoveryError, type TaskRecoveryStore } from "./task-recovery-store"
import { probeTaskOwner } from "./task-worker-ownership"

/*
 * Safety net for owner records whose child session went away without this
 * process seeing `session.deleted`: a crash, a deletion handled by another
 * worker, or one made while no OMO process ran. A resumable child needs its
 * record indefinitely, so age alone never removes one. A record goes only
 * when its owner answers dead AND opencode positively reports the child
 * session missing; a live or unknown owner, an existing child, any other
 * error, or a record in a format newer than this reader keeps it. Lock and
 * temp files live for seconds, so ones older than the minimum age are crash
 * leftovers, and an abandoned lock would block recovery of its child forever.
 *
 * Each run examines at most `budget` aged entries, continuing after the
 * cursor where the previous run stopped, so kept records cannot starve the
 * rest of the directory. The cursor file's mtime lets processes sharing the
 * directory sweep it once per interval between them.
 */

export const DEFAULT_RECOVERY_SWEEP_MIN_AGE_MS = 24 * 60 * 60 * 1000
export const RECOVERY_SWEEP_START_DELAY_MS = 30_000
export const RECOVERY_SWEEP_INTERVAL_MS = 60 * 60 * 1000
export const RECOVERY_SWEEP_BUDGET = 100
const CURSOR_FILE = ".sweep-cursor"
const ENTRY = /^([0-9a-f]{64})\.json(?:\.(lock|[0-9a-f-]{36}))?$/

const SweepRecordSchema = z.object({
  version: z.literal(1), sessionId: z.string().min(1), cwd: z.string().min(1),
  generation: z.string().uuid(), owner: TaskOwnerSchema,
}).passthrough()

export type ChildPresence = "exists" | "missing" | "unknown"
export type SweepRemoval = "abandoned-lock" | "abandoned-temp" | "invalid-record" | "child-gone"

export interface TaskRecoverySweepInput {
  readonly store: TaskRecoveryStore
  readonly minAgeMs: number
  readonly childPresence: (sessionId: string) => Promise<ChildPresence>
  readonly budget?: number
  readonly intervalMs?: number
  readonly now?: () => number
  readonly dryRun?: boolean
  readonly probeOwner?: typeof probeTaskOwner
  readonly shouldContinue?: () => boolean
}

export interface TaskRecoverySweepResult {
  readonly skipped: boolean
  readonly examined: number
  readonly removed: ReadonlyArray<{ readonly file: string; readonly reason: SweepRemoval }>
}

type Verdict = { readonly reason: SweepRemoval; readonly sessionId?: string; readonly generation?: string }

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

async function generationOf(file: string): Promise<string | undefined> {
  try {
    const record = SweepRecordSchema.safeParse(JSON.parse(await readFile(file, "utf8")))
    return record.success ? record.data.generation : undefined
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return undefined
  }
}

async function judge(input: TaskRecoverySweepInput, file: string, hash: string, suffix: string | undefined): Promise<Verdict | undefined> {
  if (suffix === "lock") return { reason: "abandoned-lock" }
  if (suffix !== undefined) return { reason: "abandoned-temp" }
  let raw: string
  try { raw = await readFile(file, "utf8") } catch (error) {
    if (!(error instanceof Error)) throw error
    return undefined
  }
  let value: unknown
  try { value = JSON.parse(raw) } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    return { reason: "invalid-record" }
  }
  if (typeof value === "object" && value !== null && "version" in value && value.version !== 1) return undefined
  const record = SweepRecordSchema.safeParse(value)
  if (!record.success || createHash("sha256").update(record.data.sessionId).digest("hex") !== hash) {
    return { reason: "invalid-record" }
  }
  if (await (input.probeOwner ?? probeTaskOwner)(record.data) !== "dead") return undefined
  if (await input.childPresence(record.data.sessionId) !== "missing") return undefined
  return { reason: "child-gone", sessionId: record.data.sessionId, generation: record.data.generation }
}

async function remove(input: TaskRecoverySweepInput, file: string, mtimeMs: number, verdict: Verdict): Promise<boolean> {
  const { sessionId, generation } = verdict
  if (sessionId !== undefined) {
    try {
      return await input.store.locked(sessionId, async () => {
        if (await generationOf(file) !== generation) return false
        input.store.remove(sessionId)
        return true
      })
    } catch (error) {
      if (error instanceof TaskRecoveryError) return false
      throw error
    }
  }
  try {
    if ((await stat(file)).mtimeMs !== mtimeMs) return false
    await unlink(file)
    return true
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }
}

export async function sweepTaskRecoveryRecords(input: TaskRecoverySweepInput): Promise<TaskRecoverySweepResult> {
  const now = input.now ?? Date.now
  const budget = input.budget ?? RECOVERY_SWEEP_BUDGET
  const cursorPath = join(input.store.root, CURSOR_FILE)
  let cursor = ""
  try {
    const marker = await stat(cursorPath)
    if (input.intervalMs !== undefined && now() - marker.mtimeMs < input.intervalMs) return { skipped: true, examined: 0, removed: [] }
    cursor = await readFile(cursorPath, "utf8")
  } catch (error) {
    if (!isMissing(error)) throw error
  }
  let names: string[]
  try {
    names = (await readdir(input.store.root)).filter((name) => ENTRY.test(name)).sort()
  } catch (error) {
    if (isMissing(error)) return { skipped: false, examined: 0, removed: [] }
    throw error
  }
  if (!input.dryRun) await writeFile(cursorPath, cursor, { mode: 0o600 })
  const start = names.findIndex((name) => name > cursor)
  const ordered = start <= 0 ? names : [...names.slice(start), ...names.slice(0, start)]

  const removed: Array<{ file: string; reason: SweepRemoval }> = []
  let examined = 0
  let next = ""
  let complete = true
  for (const name of ordered) {
    if (examined >= budget || input.shouldContinue?.() === false) { complete = false; break }
    const [, hash, suffix] = ENTRY.exec(name) ?? []
    if (hash === undefined) continue
    const file = join(input.store.root, name)
    let mtimeMs: number
    try { mtimeMs = (await stat(file)).mtimeMs } catch (error) {
      if (isMissing(error)) continue
      throw error
    }
    if (now() - mtimeMs < input.minAgeMs) continue
    examined += 1
    next = name
    const verdict = await judge(input, file, hash, suffix)
    if (verdict === undefined) continue
    if (input.dryRun || await remove(input, file, mtimeMs, verdict)) removed.push({ file: name, reason: verdict.reason })
  }
  if (!input.dryRun) await writeFile(cursorPath, complete ? "" : next, { mode: 0o600 })
  return { skipped: false, examined, removed }
}

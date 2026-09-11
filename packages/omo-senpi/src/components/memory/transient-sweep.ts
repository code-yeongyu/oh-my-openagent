// Age-bounded reclaim for transient memory identity runs (issue #7765).
//
// Two areas, one discriminator (`repo/`):
//   - `<memory>/transient-runs/<token>`: a run root whose owner died before it could clean up, or
//     that grew a `repo/` and was deliberately left by run end. Reclaimed once it is older than
//     TRANSIENT_RUN_MAX_AGE_MS and its owning pid is gone; an identity inside that holds memory is
//     promoted into the durable agents root instead of removed.
//   - `<memory>/agents/<id>`: identities with runtime scratch and no `repo/` - the pile this
//     issue is about, written by versions before transient routing existed and by interactive
//     sessions that never persisted anything. Reclaimed once older than TRANSIENT_IDENTITY_MAX_AGE_MS.
//
// An identity that owns a `repo/` is structurally exempt in BOTH areas, so no sweep can ever
// delete real memory. The sweep creates nothing: a missing area is a no-op, which keeps component
// registration free of filesystem writes on a machine that never ran a one-shot session.

import { existsSync, mkdir, readdir, rename, stat } from "@oh-my-opencode/memory-core/fs"
import { dirname, join } from "node:path"

import { AGENTS_DIRNAME } from "@oh-my-opencode/memory-core"

import {
  TRANSIENT_DIRNAME,
  isDurableIdentityRoot,
  readRunTokenPid,
  removeMemoryTree,
  type TransientWarn,
} from "./transient-identity"

export const TRANSIENT_RUN_MAX_AGE_MS = 24 * 60 * 60 * 1000
export const TRANSIENT_IDENTITY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Age probing is bounded: a transient tree is shallow, and a sweep must never walk real memory.
 * Six levels reach a run root's transcript leaves (`agents/<id>/runtime/transcripts/<session>/*`).
 */
const MAX_AGE_DEPTH = 6
const MAX_AGE_ENTRIES = 512

export interface TransientSweepResult {
  readonly removedRuns: number
  readonly removedIdentities: number
  readonly promoted: number
  readonly stranded: number
  readonly kept: number
}

export interface TransientSweepInput {
  readonly memoryRoot: string
  readonly now?: () => number
  readonly maxRunAgeMs?: number
  readonly maxIdentityAgeMs?: number
  readonly isProcessAlive?: (pid: number) => boolean
  readonly warn?: TransientWarn
}

export type TransientSweep = (input: TransientSweepInput) => Promise<TransientSweepResult>

type Totals = {
  removedRuns: number
  removedIdentities: number
  promoted: number
  stranded: number
  kept: number
}

export async function sweepTransientMemoryRuns(input: TransientSweepInput): Promise<TransientSweepResult> {
  const totals: Totals = { removedRuns: 0, removedIdentities: 0, promoted: 0, stranded: 0, kept: 0 }
  const now = input.now ?? Date.now
  const isProcessAlive = input.isProcessAlive ?? defaultIsProcessAlive
  await sweepRunRoots(input, totals, now, isProcessAlive)
  await sweepStrayIdentities(input, totals, now)
  return totals
}

async function sweepRunRoots(
  input: TransientSweepInput,
  totals: Totals,
  now: () => number,
  isProcessAlive: (pid: number) => boolean,
): Promise<void> {
  const area = join(input.memoryRoot, TRANSIENT_DIRNAME)
  const maxAgeMs = input.maxRunAgeMs ?? TRANSIENT_RUN_MAX_AGE_MS
  for (const token of await listDirNames(area)) {
    const runRoot = join(area, token)
    const pid = readRunTokenPid(token)
    if (pid !== undefined && isProcessAlive(pid)) {
      totals.kept += 1
      continue
    }
    const newest = await newestMtimeMs(runRoot, MAX_AGE_DEPTH)
    if (newest === undefined || now() - newest < maxAgeMs) {
      totals.kept += 1
      continue
    }
    if (await rescueRunMemory(input, totals, runRoot)) {
      totals.kept += 1
      continue
    }
    if (await removeMemoryTree(runRoot, input.warn)) totals.removedRuns += 1
    else totals.kept += 1
  }
}

/** Promotes every identity in an abandoned run that turned out to hold memory. Returns true when one could not be rescued. */
async function rescueRunMemory(input: TransientSweepInput, totals: Totals, runRoot: string): Promise<boolean> {
  const identitiesRoot = join(runRoot, AGENTS_DIRNAME)
  let stranded = false
  for (const identity of await listDirNames(identitiesRoot)) {
    const from = join(identitiesRoot, identity)
    if (!isDurableIdentityRoot(from)) continue
    const promotion = await promoteIdentityRoot({
      from,
      to: join(input.memoryRoot, AGENTS_DIRNAME, identity),
      ...(input.warn === undefined ? {} : { warn: input.warn }),
    })
    if (promotion === "promoted") totals.promoted += 1
    else {
      totals.stranded += 1
      stranded = true
    }
  }
  return stranded
}

/**
 * Moves a transient identity that turned out to hold memory into the durable agents root. A
 * target that already exists is never merged or overwritten: the transient tree is left on disk
 * (and, holding a `repo/`, is exempt from removal) and the caller is warned.
 */
async function promoteIdentityRoot(input: {
  readonly from: string
  readonly to: string
  readonly warn?: TransientWarn
}): Promise<"promoted" | "stranded"> {
  if (existsSync(input.to)) {
    input.warn?.("omo-senpi memory transient run holds memory a durable identity already owns", {
      from: input.from,
      to: input.to,
    })
    return "stranded"
  }
  try {
    await mkdir(dirname(input.to), { recursive: true })
    await rename(input.from, input.to)
    return "promoted"
  } catch (error) {
    input.warn?.("omo-senpi memory transient run promotion failed", {
      from: input.from,
      to: input.to,
      error: error instanceof Error ? error.message : String(error),
    })
    return "stranded"
  }
}

async function sweepStrayIdentities(input: TransientSweepInput, totals: Totals, now: () => number): Promise<void> {
  const agentsRoot = join(input.memoryRoot, AGENTS_DIRNAME)
  const maxAgeMs = input.maxIdentityAgeMs ?? TRANSIENT_IDENTITY_MAX_AGE_MS
  for (const identity of await listDirNames(agentsRoot)) {
    const root = join(agentsRoot, identity)
    if (isDurableIdentityRoot(root)) {
      totals.kept += 1
      continue
    }
    const newest = await newestMtimeMs(root, MAX_AGE_DEPTH)
    if (newest === undefined || now() - newest < maxAgeMs) {
      totals.kept += 1
      continue
    }
    if (await removeMemoryTree(root, input.warn)) totals.removedIdentities += 1
    else totals.kept += 1
  }
}

async function listDirNames(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => entry.name)
  } catch {
    return []
  }
}

/**
 * Newest mtime in a bounded walk. A directory's own mtime only tracks its direct entries, so a
 * run whose transcript grows in a leaf would otherwise look untouched since it started.
 */
async function newestMtimeMs(root: string, depth: number): Promise<number | undefined> {
  let newest = await mtimeMs(root)
  let budget = MAX_AGE_ENTRIES
  const pending: Array<{ readonly path: string; readonly depth: number }> = [{ path: root, depth }]
  while (pending.length > 0 && budget > 0) {
    const current = pending.pop()
    if (current === undefined) break
    let entries
    try {
      entries = await readdir(current.path, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (budget <= 0) break
      budget -= 1
      const child = join(current.path, entry.name)
      const stamp = await mtimeMs(child)
      if (stamp !== undefined && (newest === undefined || stamp > newest)) newest = stamp
      if (entry.isDirectory() && current.depth > 1) pending.push({ path: child, depth: current.depth - 1 })
    }
  }
  return newest
}

async function mtimeMs(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).mtimeMs
  } catch {
    return undefined
  }
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

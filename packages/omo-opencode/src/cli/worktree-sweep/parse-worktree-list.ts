import { normalize } from "node:path"

import type { WorktreeRecord } from "./types"

interface MutableRecord {
  path?: string
  head?: string
  branch?: string
  detached: boolean
  locked: boolean
  lockReason?: string
  prunable: boolean
}

function emptyRecord(): MutableRecord {
  return { detached: false, locked: false, prunable: false }
}

function finalize(record: MutableRecord): WorktreeRecord | undefined {
  if (record.path === undefined || record.path.length === 0) return undefined
  return {
    // git emits forward separators even on Windows while Node-side callers
    // build platform-native paths; normalize at the boundary so one record
    // path matches every consumer comparison.
    path: normalize(record.path),
    ...(record.head === undefined ? {} : { head: record.head }),
    ...(record.branch === undefined ? {} : { branch: record.branch }),
    detached: record.detached,
    locked: record.locked,
    ...(record.lockReason === undefined ? {} : { lockReason: record.lockReason }),
    prunable: record.prunable,
  }
}

function applyLine(record: MutableRecord, line: string): void {
  if (line.startsWith("worktree ")) {
    record.path = line.slice("worktree ".length)
    return
  }
  if (line.startsWith("HEAD ")) {
    record.head = line.slice("HEAD ".length)
    return
  }
  if (line.startsWith("branch ")) {
    record.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "")
    return
  }
  if (line === "detached") {
    record.detached = true
    return
  }
  if (line === "locked" || line.startsWith("locked ")) {
    record.locked = true
    const reason = line.slice("locked".length).trim()
    if (reason.length > 0) record.lockReason = reason
    return
  }
  if (line === "prunable" || line.startsWith("prunable ")) {
    record.prunable = true
  }
}

/**
 * Parses `git worktree list --porcelain` output. Records are separated by blank
 * lines; the first record is always the main worktree.
 */
export function parseWorktreeList(porcelain: string): WorktreeRecord[] {
  const records: WorktreeRecord[] = []
  let current = emptyRecord()

  for (const rawLine of porcelain.split("\n")) {
    const line = rawLine.replace(/\r$/, "")
    if (line.length === 0) {
      const finalized = finalize(current)
      if (finalized) records.push(finalized)
      current = emptyRecord()
      continue
    }
    applyLine(current, line)
  }

  const trailing = finalize(current)
  if (trailing) records.push(trailing)

  return records
}

/** Drops the main worktree (first record), which is never a sweep candidate. */
export function linkedWorktrees(records: readonly WorktreeRecord[]): WorktreeRecord[] {
  return records.slice(1)
}

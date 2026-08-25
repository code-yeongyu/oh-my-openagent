import { existsSync } from "node:fs"
import { stat } from "node:fs/promises"
import os from "node:os"
import { normalize } from "node:path"

import { classifyWorktree, DEFAULT_EXCLUDE_PREFIXES, isExcludedPath, worktreeRef } from "./classify"
import {
  detectDefaultBranch,
  isDirty,
  isMerged,
  listWorktreesPorcelain,
  pruneWorktrees,
  removeWorktree,
  resolveRepoRoot,
} from "./git"
import { linkedWorktrees, parseWorktreeList } from "./parse-worktree-list"
import type {
  WorktreeClassification,
  WorktreeRecord,
  WorktreeSweepOptions,
  WorktreeSweepRepoReport,
  WorktreeSweepResult,
} from "./types"

const DAY_MS = 24 * 60 * 60 * 1000

async function isOlderThan(worktreePath: string, days: number, now: number): Promise<boolean> {
  if (days <= 0) return false
  try {
    const stats = await stat(worktreePath)
    return now - stats.mtimeMs > days * DAY_MS
  } catch {
    return false
  }
}

async function classifyRecord(
  repo: string,
  record: WorktreeRecord,
  defaultBranch: string,
  options: {
    readonly olderThanDays: number
    readonly excludePrefixes: readonly string[]
    readonly home: string
    readonly now: number
  },
): Promise<WorktreeClassification> {
  const pathExists = existsSync(record.path)
  const external = isExcludedPath(record.path, options.excludePrefixes, options.home)

  // Short-circuit: protected or vanished trees need no git interrogation.
  if (record.locked || !pathExists || external) {
    return classifyWorktree({
      record,
      pathExists,
      merged: false,
      agedOut: false,
      dirty: false,
      external,
    })
  }

  const merged = await isMerged(repo, worktreeRef(record), defaultBranch)
  const agedOut = merged
    ? false
    : await isOlderThan(record.path, options.olderThanDays, options.now)
  const dirty = merged || agedOut ? await isDirty(record.path) : false

  return classifyWorktree({ record, pathExists, merged, agedOut, dirty, external })
}

async function sweepRepo(
  repo: string,
  options: {
    readonly apply: boolean
    readonly olderThanDays: number
    readonly excludePrefixes: readonly string[]
    readonly home: string
    readonly now: number
  },
): Promise<WorktreeSweepRepoReport> {
  // git reports forward-separator roots even on Windows; normalize so the
  // report's repo identity matches platform-native consumer paths.
  const root = normalize((await resolveRepoRoot(repo)) ?? repo)
  const defaultBranch = await detectDefaultBranch(root)
  if (defaultBranch === undefined) {
    throw new Error(`Could not determine the default branch for ${root}`)
  }

  const records = linkedWorktrees(parseWorktreeList(await listWorktreesPorcelain(root)))
  const classifications: WorktreeClassification[] = []
  for (const record of records) {
    classifications.push(await classifyRecord(root, record, defaultBranch, options))
  }

  const removed: string[] = []
  const failed: { path: string; error: string }[] = []

  if (options.apply) {
    for (const classification of classifications) {
      if (classification.decision !== "SWEEP") continue
      // `git worktree remove` without --force: git refuses dirty/locked trees.
      const result = await removeWorktree(root, classification.path)
      if (result.code === 0) removed.push(classification.path)
      else {
        failed.push({
          path: classification.path,
          error: result.stderr.trim() || `git worktree remove exited with ${result.code}`,
        })
      }
    }
    await pruneWorktrees(root)
  }

  return { repo: root, defaultBranch, classifications, removed, failed }
}

export async function sweepWorktrees(options: WorktreeSweepOptions = {}): Promise<WorktreeSweepResult> {
  const apply = options.apply === true
  const olderThanDays = options.olderThanDays ?? 0
  const excludePrefixes = options.excludePrefixes ?? DEFAULT_EXCLUDE_PREFIXES
  const home = os.homedir()
  const now = Date.now()
  const repos = options.repos && options.repos.length > 0 ? options.repos : [options.cwd ?? process.cwd()]

  const reports: WorktreeSweepRepoReport[] = []
  for (const repo of repos) {
    reports.push(await sweepRepo(repo, { apply, olderThanDays, excludePrefixes, home, now }))
  }

  const all = reports.flatMap((report) => report.classifications)

  return {
    apply,
    olderThanDays,
    repos: reports,
    sweepCount: all.filter((item) => item.decision === "SWEEP").length,
    keepCount: all.filter((item) => item.decision === "KEEP").length,
    pruneCount: all.filter((item) => item.decision === "PRUNE").length,
  }
}

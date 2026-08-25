import path from "node:path"

import type { ClassificationInput, WorktreeClassification, WorktreeRecord } from "./types"

/**
 * Externally-owned worktree roots. These are managed by other applications, so
 * sweeping them would delete state we do not own.
 */
export const DEFAULT_EXCLUDE_PREFIXES: readonly string[] = [
  "~/.codex/worktrees",
  "~/.codex-gui-cli-remote/worktrees",
]

export function expandHome(value: string, home: string): string {
  if (value === "~") return home
  if (value.startsWith("~/")) return path.join(home, value.slice(2))
  return value
}

export function isExcludedPath(
  worktreePath: string,
  prefixes: readonly string[],
  home: string,
): boolean {
  const target = path.resolve(expandHome(worktreePath, home))
  return prefixes.some((prefix) => {
    const resolved = path.resolve(expandHome(prefix, home))
    return target === resolved || target.startsWith(`${resolved}${path.sep}`)
  })
}

/** Branch name when attached, otherwise the detached HEAD sha. */
export function worktreeRef(record: WorktreeRecord): string {
  return record.branch ?? record.head ?? ""
}

/**
 * Single source of truth for sweep decisions. Mirrors the validated `git-wt-cl`
 * prototype: protection wins over eligibility, and eligibility requires both a
 * merged (or aged-out) ref and a clean tree.
 */
export function classifyWorktree(input: ClassificationInput): WorktreeClassification {
  const { record } = input
  const ref = worktreeRef(record)

  if (record.locked) return { path: record.path, ref, decision: "KEEP", reason: "locked" }
  if (!input.pathExists) return { path: record.path, ref, decision: "PRUNE" }
  if (input.external) return { path: record.path, ref, decision: "KEEP", reason: "external" }
  if (!input.merged && !input.agedOut) {
    return { path: record.path, ref, decision: "KEEP", reason: "unmerged" }
  }
  if (input.dirty) return { path: record.path, ref, decision: "KEEP", reason: "dirty" }

  return { path: record.path, ref, decision: "SWEEP" }
}

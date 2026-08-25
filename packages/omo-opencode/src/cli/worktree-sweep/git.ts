import { spawn } from "@oh-my-opencode/utils/runtime"

export interface GitResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

export async function runGit(cwd: string, args: readonly string[]): Promise<GitResult> {
  const child = spawn({ cmd: ["git", "-C", cwd, ...args], stdout: "pipe", stderr: "pipe" })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { code, stdout, stderr }
}

export async function listWorktreesPorcelain(repo: string): Promise<string> {
  const result = await runGit(repo, ["worktree", "list", "--porcelain"])
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `git worktree list failed in ${repo}`)
  }
  return result.stdout
}

/**
 * Default branch detection: `origin/HEAD` symbolic ref first, then a local
 * `main`, then `master`. Mirrors the prototype's fallback chain.
 */
export async function detectDefaultBranch(repo: string): Promise<string | undefined> {
  const symbolic = await runGit(repo, [
    "symbolic-ref",
    "--quiet",
    "--short",
    "refs/remotes/origin/HEAD",
  ])
  if (symbolic.code === 0) {
    const value = symbolic.stdout.trim()
    if (value.length > 0) return value.replace(/^[^/]*\//, "")
  }

  const local = await runGit(repo, [
    "branch",
    "--list",
    "main",
    "master",
    "--format=%(refname:short)",
  ])
  if (local.code === 0) {
    for (const candidate of ["main", "master"]) {
      if (
        local.stdout
          .split("\n")
          .map((line) => line.trim())
          .includes(candidate)
      ) {
        return candidate
      }
    }
  }

  return undefined
}

/** `git merge-base --is-ancestor <ref> <default>` — the merged oracle. */
export async function isMerged(repo: string, ref: string, defaultBranch: string): Promise<boolean> {
  if (ref.length === 0) return false
  const result = await runGit(repo, ["merge-base", "--is-ancestor", ref, defaultBranch])
  return result.code === 0
}

export async function isDirty(worktreePath: string): Promise<boolean> {
  const result = await runGit(worktreePath, ["status", "--porcelain"])
  if (result.code !== 0) return true
  return result.stdout.trim().length > 0
}

/** Never uses `--force`: git itself refuses dirty and locked worktrees. */
export async function removeWorktree(repo: string, worktreePath: string): Promise<GitResult> {
  return runGit(repo, ["worktree", "remove", worktreePath])
}

export async function pruneWorktrees(repo: string): Promise<GitResult> {
  return runGit(repo, ["worktree", "prune"])
}

export async function resolveRepoRoot(cwd: string): Promise<string | undefined> {
  const result = await runGit(cwd, ["rev-parse", "--show-toplevel"])
  if (result.code !== 0) return undefined
  const value = result.stdout.trim()
  return value.length > 0 ? value : undefined
}

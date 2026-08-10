import { existsSync } from "node:fs"
import { mkdir, readFile, rm } from "node:fs/promises"
import { basename, isAbsolute, join, resolve } from "node:path"
import { GitMemoryRepo, createNodeGitExec, type GitExec } from "../git"
import { validateCompletion } from "./completion-validation"

const GIT_TIMEOUT_MS = 30_000

import type { ReflectionOutcome } from "./machine"
export type { ReflectionOutcome }

export interface ReflectionWorktree {
  readonly parent: GitMemoryRepo
  readonly dir: string
  readonly branch: string
  readonly baseSha: string
  readonly gitFilePath: string
  readonly gitFileSnapshot: string
  readonly commonConfigPath: string
  readonly commonConfigSnapshot: string | null
  readonly exec: GitExec
}

export interface ReflectionCleanupReceipt {
  readonly worktreeRemoved: boolean
  readonly branchRemoved: boolean
}

export interface ReflectionFinalizeResult {
  readonly status: ReflectionOutcome
  readonly detail?: string
  readonly cleanup: ReflectionCleanupReceipt
}

type WriterLock = <T>(operation: () => Promise<T>) => Promise<T>

export type ReflectionFinalizeOptions =
  | { readonly mode: "auto"; readonly summary: string; readonly withWriterLock: WriterLock }
  | { readonly mode: "explicit"; readonly withWriterLock: WriterLock }

export async function createReflectionWorktree(
  repo: GitMemoryRepo,
  runId: string,
  worktreesDir: string,
  exec: GitExec = createNodeGitExec(),
): Promise<ReflectionWorktree> {
  if (!isAbsolute(worktreesDir)) throw new TypeError("worktreesDir must be absolute")
  const baseSha = await repo.head()
  if (!baseSha) throw new Error("Cannot create a reflection worktree without a parent HEAD")

  const id = sanitizeRunId(runId)
  const suffix = `${Date.now()}-${id}`
  const branch = `memory/reflection-${suffix}`
  const dir = join(resolve(worktreesDir), suffix)
  await mkdir(worktreesDir, { recursive: true })
  await repo.worktreeAdd(dir, branch, baseSha)

  try {
    const gitFilePath = join(dir, ".git")
    const gitFileSnapshot = await readFile(gitFilePath, "utf8")
    const commonDirResult = await git(exec, repo.dir, ["rev-parse", "--git-common-dir"])
    const rawCommonDir = commonDirResult.stdout.trim()
    const commonDir = isAbsolute(rawCommonDir) ? rawCommonDir : resolve(repo.dir, rawCommonDir)
    const commonConfigPath = join(commonDir, "config")
    const commonConfigSnapshot = await readOptional(commonConfigPath)
    return {
      parent: repo,
      dir,
      branch,
      baseSha,
      gitFilePath,
      gitFileSnapshot,
      commonConfigPath,
      commonConfigSnapshot,
      exec,
    }
  } catch (error) {
    await removeWorktreeAndBranch(repo, dir, branch, exec)
    throw error
  }
}

export async function finalizeReflectionWorktree(
  worktree: ReflectionWorktree,
  options: ReflectionFinalizeOptions,
): Promise<ReflectionFinalizeResult> {
  let status: ReflectionOutcome = "failed"
  let detail: string | undefined

  try {
    const validation = await validateCompletion(worktree, worktree.baseSha, worktree.exec)
    if (validation.status !== "valid") {
      status = validation.status
      detail = "detail" in validation ? validation.detail : undefined
    } else {
      const integrated = await options.withWriterLock(async () => {
        if ((await worktree.parent.status()).trim()) return { status: "parent_dirty" as const }
        if (options.mode === "explicit") {
          const reachable = await run(worktree.exec, worktree.parent.dir, [
            "merge-base", "--is-ancestor", validation.tipSha, "HEAD",
          ])
          return reachable.code === 0
            ? { status: "merged" as const }
            : { status: "failed" as const, detail: "Reflection branch tip is not reachable from parent HEAD" }
        }
        return autoMerge(worktree, options.summary)
      })
      status = integrated.status
      detail = integrated.detail
    }
  } catch (error) {
    status = "failed"
    detail = errorMessage(error)
  }

  const cleanup = await removeWorktreeAndBranch(worktree.parent, worktree.dir, worktree.branch, worktree.exec)
  if (!cleanup.worktreeRemoved || !cleanup.branchRemoved) {
    status = "failed"
    detail = [detail, "Reflection cleanup did not fully complete"].filter(Boolean).join("; ")
  }
  return { status, ...(detail ? { detail } : {}), cleanup }
}

async function autoMerge(worktree: ReflectionWorktree, summary: string) {
  const merge = await run(worktree.exec, worktree.parent.dir, [
    "merge", "--no-ff", worktree.branch, "-m", `merge(reflection): ${summary}`,
  ])
  if (merge.code === 0) return { status: "merged" as const }

  const mergeHead = await run(worktree.exec, worktree.parent.dir, ["rev-parse", "-q", "--verify", "MERGE_HEAD"])
  const unmerged = await run(worktree.exec, worktree.parent.dir, ["diff", "--name-only", "--diff-filter=U"])
  if (mergeHead.code === 0) await run(worktree.exec, worktree.parent.dir, ["merge", "--abort"])
  if (mergeHead.code === 0 || unmerged.stdout.trim()) {
    return { status: "merge_conflict" as const, detail: merge.stderr.trim() }
  }
  return { status: "failed" as const, detail: merge.stderr.trim() || "Reflection merge failed" }
}

async function removeWorktreeAndBranch(
  repo: GitMemoryRepo,
  dir: string,
  branch: string,
  exec: GitExec,
): Promise<ReflectionCleanupReceipt> {
  await repo.worktreeRemove(dir, true).catch(() => undefined)
  await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  await run(exec, repo.dir, ["worktree", "prune"])
  await run(exec, repo.dir, ["branch", "-D", branch])
  const listed = await run(exec, repo.dir, ["worktree", "list", "--porcelain"])
  const branchRef = await run(exec, repo.dir, ["show-ref", "--verify", `refs/heads/${branch}`])
  return {
    worktreeRemoved: !existsSync(dir) && !listed.stdout.split(/\r?\n/).includes(`worktree ${resolve(dir)}`),
    branchRemoved: branchRef.code !== 0,
  }
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8")
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
    throw error
  }
}

async function git(exec: GitExec, cwd: string, argv: readonly string[]) {
  const result = await run(exec, cwd, argv)
  if (result.code !== 0) throw new Error(result.stderr.trim() || `git ${argv.join(" ")} failed`)
  return result
}

function run(exec: GitExec, cwd: string, argv: readonly string[]) {
  return exec.run(argv, { cwd, timeoutMs: GIT_TIMEOUT_MS, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } })
}

function sanitizeRunId(runId: string): string {
  const id = basename(runId.trim()).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
  if (!id || id === "." || id === "..") throw new TypeError("runId must contain a safe identifier")
  return id.slice(0, 80)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

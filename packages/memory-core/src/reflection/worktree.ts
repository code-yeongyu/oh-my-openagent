import { existsSync } from "../fs/resilient"
import { mkdir, readFile, rm } from "../fs/resilient"
import { basename, isAbsolute, join, resolve } from "node:path"
import { GitMemoryRepo, createNodeGitExec, type GitExec } from "../git"
import { validateCompletion } from "./completion-validation"
import { cleanupReflectionWorktree, integrateValidatedReflection } from "./worktree-integration"

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

export interface ReflectionWorktreeIdentity {
  readonly dir: string
  readonly branch: string
}

export interface ReflectionFinalizeResult {
  readonly status: ReflectionOutcome
  readonly detail?: string
  readonly cleanup: ReflectionCleanupReceipt
}

type WriterLock = <T>(operation: () => Promise<T>) => Promise<T>

export type ReflectionFinalizeOptions =
  | {
      readonly mode: "auto"
      readonly summary: string
      readonly runId?: string
      readonly allowedPaths?: readonly string[]
      readonly withWriterLock: WriterLock
    }
  | { readonly mode: "explicit"; readonly withWriterLock: WriterLock }

export async function createReflectionWorktree(
  repo: GitMemoryRepo,
  runId: string,
  worktreesDir: string,
  exec: GitExec = createNodeGitExec(),
  beforeCreate?: (identity: ReflectionWorktreeIdentity) => void | Promise<void>,
): Promise<ReflectionWorktree> {
  if (!isAbsolute(worktreesDir)) throw new TypeError("worktreesDir must be absolute")
  const baseSha = await repo.head()
  if (!baseSha) throw new Error("Cannot create a reflection worktree without a parent HEAD")

  const id = sanitizeRunId(runId)
  const suffix = `${Date.now()}-${id}`
  const branch = `memory/reflection-${suffix}`
  const dir = join(resolve(worktreesDir), suffix)
  await beforeCreate?.({ dir, branch })

  try {
    await mkdir(worktreesDir, { recursive: true })
    await repo.worktreeAdd(dir, branch, baseSha)
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

export async function discardReflectionWorktree(
  repo: GitMemoryRepo,
  dir: string,
  branch: string,
  exec: GitExec = createNodeGitExec(),
): Promise<ReflectionCleanupReceipt> {
  return removeWorktreeAndBranch(repo, dir, branch, exec)
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
    } else if (options.mode === "auto" && options.allowedPaths !== undefined
      && validation.changedPaths.some((path) => !options.allowedPaths?.includes(path))) {
      detail = `Dream document maintenance changed paths outside its target: ${validation.changedPaths.join(", ")}`
    } else {
      const integrated = await integrateValidatedReflection(worktree, {
        mode: options.mode === "auto" ? "auto" : "integration",
        runId: options.mode === "auto" ? options.runId ?? worktree.branch : worktree.branch,
        summary: options.mode === "auto" ? options.summary : "external integration",
        validated: validation,
        withWriterLock: options.withWriterLock,
      })
      status = integrated.outcome
      detail = integrated.detail
    }
  } catch (error) {
    detail = errorMessage(error)
  }

  const cleanup = await cleanupReflectionWorktree(worktree)
  if (!cleanup.worktreeRemoved || !cleanup.branchRemoved) {
    status = "failed"
    detail = [detail, "Reflection cleanup did not fully complete"].filter(Boolean).join("; ")
  }
  return { status, ...(detail ? { detail } : {}), cleanup }
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

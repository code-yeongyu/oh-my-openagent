import { existsSync } from "../fs/resilient"
import { rm } from "../fs/resilient"
import { resolve } from "node:path"
import type { GitExec } from "../git"
import { STABLE_LOG_OUTPUT } from "../git/stable-log-output"
import type { ReflectionCleanupReceipt, ReflectionWorktree } from "./worktree"
import {
  DEFAULT_INDEX_LOCK_RETRY,
  gitOrThrow as git,
  isAncestor,
  optionalRevision,
  retryOnIndexLock,
  runGit as run,
  type IndexLockRetry,
} from "./worktree-integration-git"
import { healStrandedMerge } from "./worktree-integration-heal"
import { mergeValidatedTip } from "./worktree-integration-merge"

export type { IndexLockRetry } from "./worktree-integration-git"

export interface ValidatedReflectionTip {
  readonly tipSha: string
  readonly changedPaths: readonly string[]
}

export type ReflectionIntegrationMode = "auto" | "integration"

export type ReflectionIntegrationProbe =
  | {
      readonly status: "integrated"
      readonly evidence: "receipt" | "ancestry"
      readonly integrationSha: string
    }
  | { readonly status: "not_integrated" }

export type LegacyAutoRunReceiptProbe =
  | { readonly status: "integrated"; readonly evidence: "receipt"; readonly integrationSha: string }
  | { readonly status: "not_integrated" }

export interface ReflectionIntegrationResult {
  readonly outcome: "merged" | "parent_dirty" | "merge_conflict" | "failed"
  readonly integrationSha?: string
  readonly detail?: string
}

export type WriterLock = <T>(operation: () => Promise<T>) => Promise<T>

export interface ProbeReflectionIntegrationInput {
  readonly mode: ReflectionIntegrationMode
  readonly runId: string
  readonly validatedTipSha: string
}

export interface IntegrateValidatedReflectionInput {
  readonly mode: ReflectionIntegrationMode
  readonly runId: string
  readonly summary: string
  readonly validated: ValidatedReflectionTip
  readonly withWriterLock: WriterLock
  /** How long a held index.lock is waited out; tests inject the sleep. */
  readonly indexLockRetry?: IndexLockRetry
}

/** Legacy-only recovery for auto runs that predate durable validated-tip checkpoints. */
export async function probeLegacyAutoRunReceipt(
  worktree: ReflectionWorktree,
  runId: string,
): Promise<LegacyAutoRunReceiptProbe> {
  const integrationSha = await findExactRunReceipt(worktree, runId)
  return integrationSha === null
    ? { status: "not_integrated" }
    : { status: "integrated", evidence: "receipt", integrationSha }
}

export async function probeReflectionIntegration(
  worktree: ReflectionWorktree,
  input: ProbeReflectionIntegrationInput,
): Promise<ReflectionIntegrationProbe> {
  if (input.mode === "auto") {
    const receipt = await findExactRunReceipt(worktree, input.runId, input.validatedTipSha)
    if (receipt !== null) {
      return { status: "integrated", evidence: "receipt", integrationSha: receipt }
    }
  }

  if (await isAncestor(worktree.exec, worktree.parent.dir, input.validatedTipSha, "HEAD")) {
    const head = await git(worktree.exec, worktree.parent.dir, ["rev-parse", "--verify", "HEAD"])
    return { status: "integrated", evidence: "ancestry", integrationSha: head.stdout.trim() }
  }
  return { status: "not_integrated" }
}

export async function integrateValidatedReflection(
  worktree: ReflectionWorktree,
  input: IntegrateValidatedReflectionInput,
): Promise<ReflectionIntegrationResult> {
  const retry = input.indexLockRetry ?? DEFAULT_INDEX_LOCK_RETRY
  return input.withWriterLock(async () => {
    await healStrandedMerge(worktree, retry)
    const existing = await probeReflectionIntegration(worktree, {
      mode: input.mode,
      runId: input.runId,
      validatedTipSha: input.validated.tipSha,
    })
    if (existing.status === "integrated") {
      return { outcome: "merged", integrationSha: existing.integrationSha }
    }
    if (input.mode === "integration") {
      return { outcome: "failed", detail: "Reflection branch tip is not reachable from parent HEAD" }
    }

    const mergeHead = await optionalRevision(worktree.exec, worktree.parent.dir, "MERGE_HEAD")
    if (mergeHead === input.validated.tipSha) {
      const aborted = await retryOnIndexLock(retry, () => run(worktree.exec, worktree.parent.dir, ["merge", "--abort"]))
      if (aborted.code !== 0) {
        return { outcome: "failed", detail: aborted.stderr.trim() || "Owned reflection merge could not be aborted" }
      }
    } else if (mergeHead !== null) {
      return { outcome: "parent_dirty", detail: "Parent repository contains another interrupted merge" }
    }

    if ((await worktree.parent.status()).trim()) {
      return { outcome: "parent_dirty" }
    }

    return mergeValidatedTip(worktree, {
      runId: input.runId,
      summary: input.summary,
      tipSha: input.validated.tipSha,
      retry,
    })
  })
}

export async function cleanupReflectionWorktree(
  worktree: ReflectionWorktree,
): Promise<ReflectionCleanupReceipt> {
  await worktree.parent.worktreeRemove(worktree.dir, true).catch(() => undefined)
  await rm(worktree.dir, { recursive: true, force: true }).catch(() => undefined)
  await run(worktree.exec, worktree.parent.dir, ["worktree", "prune"])
  await run(worktree.exec, worktree.parent.dir, ["branch", "-D", worktree.branch])
  const listed = await run(worktree.exec, worktree.parent.dir, ["worktree", "list", "--porcelain"])
  const branchRef = await run(worktree.exec, worktree.parent.dir, ["show-ref", "--verify", `refs/heads/${worktree.branch}`])
  return {
    worktreeRemoved: !existsSync(worktree.dir)
      && !listed.stdout.split(/\r?\n/).includes(`worktree ${resolve(worktree.dir)}`),
    branchRemoved: branchRef.code !== 0,
  }
}

async function findExactRunReceipt(
  worktree: ReflectionWorktree,
  runId: string,
  validatedTipSha?: string,
): Promise<string | null> {
  const commits = await run(worktree.exec, worktree.parent.dir, ["rev-list", `${worktree.baseSha}..HEAD`])
  if (commits.code !== 0) return null
  for (const commit of commits.stdout.split(/\r?\n/).filter(Boolean)) {
    if (!await hasExactRunReceipt(worktree.exec, worktree.parent.dir, commit, runId)) continue
    if (validatedTipSha === undefined
      || await isAncestor(worktree.exec, worktree.parent.dir, validatedTipSha, commit)) return commit
  }
  return null
}

async function hasExactRunReceipt(exec: GitExec, cwd: string, commit: string, runId: string): Promise<boolean> {
  const trailers = await run(exec, cwd, [...STABLE_LOG_OUTPUT, "show", "-s", "--format=%(trailers:key=Omo-Run,valueonly)", commit])
  return trailers.code === 0 && trailers.stdout.split(/\r?\n/).some((value) => value === runId)
}


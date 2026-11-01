import { existsSync } from "../fs/resilient"
import { rm } from "../fs/resilient"
import { resolve } from "node:path"
import type { GitExec, GitExecResult } from "../git"
import { NO_AUTO_MAINTENANCE } from "../git/no-auto-maintenance"
import { STABLE_LOG_OUTPUT } from "../git/stable-log-output"
import { boundDetail, describeMergeConflict, listLines } from "./merge-conflict-detail"
import type { ReflectionCleanupReceipt, ReflectionWorktree } from "./worktree"
import { rebaseValidatedTip } from "./worktree-rebase-recovery"

const GIT_TIMEOUT_MS = 30_000
const MAX_REBASE_ATTEMPTS = 2

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
  /** The rebased tip that was merged, when the input tip conflicted and was replayed onto the parent. */
  readonly validated?: ValidatedReflectionTip
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
  /** Persists a rebased tip before it is merged, so a resumed run probes the tip that actually lands. */
  readonly onRebased?: (validated: ValidatedReflectionTip) => Promise<void>
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
  return input.withWriterLock(async () => {
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
      const aborted = await run(worktree.exec, worktree.parent.dir, ["merge", "--abort"])
      if (aborted.code !== 0) {
        return { outcome: "failed", detail: boundDetail(aborted.stderr) || "Owned reflection merge could not be aborted" }
      }
    } else if (mergeHead !== null) {
      return { outcome: "parent_dirty", detail: "Parent repository contains another interrupted merge" }
    }

    if ((await worktree.parent.status()).trim()) {
      return { outcome: "parent_dirty" }
    }

    let validated = input.validated
    for (let attempt = 0; ; attempt += 1) {
      const merge = await run(worktree.exec, worktree.parent.dir, [
        ...NO_AUTO_MAINTENANCE, "merge", "--no-ff", validated.tipSha,
        "-m", `merge(reflection): ${input.summary}`,
        "-m", `Omo-Run: ${input.runId}`,
      ])
      if (merge.code === 0) {
        const head = await git(worktree.exec, worktree.parent.dir, ["rev-parse", "--verify", "HEAD"])
        return {
          outcome: "merged",
          integrationSha: head.stdout.trim(),
          ...(validated === input.validated ? {} : { validated }),
        }
      }
      const settled = await settleFailedMerge(worktree, validated.tipSha, merge)
      if (settled.outcome !== "merge_conflict" || attempt >= MAX_REBASE_ATTEMPTS) return settled
      const rebased = await rebaseValidatedTip(worktree, validated, settled.detail ?? "")
      if (rebased.status === "refused") return rebased.result
      await input.onRebased?.(rebased.validated)
      validated = rebased.validated
    }
  })
}

/** Aborts an owned conflicted merge and proves the parent is clean again before anything else runs. */
async function settleFailedMerge(
  worktree: ReflectionWorktree,
  tipSha: string,
  merge: GitExecResult,
): Promise<ReflectionIntegrationResult> {
  const landedMergeHead = await optionalRevision(worktree.exec, worktree.parent.dir, "MERGE_HEAD")
  const unmerged = listLines((await run(worktree.exec, worktree.parent.dir, ["diff", "--name-only", "--diff-filter=U"])).stdout)
  if (landedMergeHead !== tipSha && unmerged.length === 0) {
    return { outcome: "failed", detail: boundDetail(merge.stderr) || "Reflection merge failed" }
  }
  const detail = describeMergeConflict(unmerged, merge.stdout, merge.stderr)
  if (landedMergeHead === tipSha) {
    const aborted = await run(worktree.exec, worktree.parent.dir, ["merge", "--abort"])
    if (aborted.code !== 0) {
      return { outcome: "failed", detail: boundDetail(aborted.stderr) || `Reflection merge conflict could not be aborted; ${detail}` }
    }
  }
  const residue = await optionalRevision(worktree.exec, worktree.parent.dir, "MERGE_HEAD")
  const status = (await worktree.parent.status()).trim()
  if (residue !== null || status) {
    return { outcome: "parent_dirty", detail: `Parent repository is not clean after aborting the reflection merge; ${detail}` }
  }
  return { outcome: "merge_conflict", detail }
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

async function isAncestor(exec: GitExec, cwd: string, ancestor: string, descendant: string): Promise<boolean> {
  return (await run(exec, cwd, ["merge-base", "--is-ancestor", ancestor, descendant])).code === 0
}

async function optionalRevision(exec: GitExec, cwd: string, revision: string): Promise<string | null> {
  const result = await run(exec, cwd, ["rev-parse", "-q", "--verify", revision])
  return result.code === 0 ? result.stdout.trim() || null : null
}

async function git(exec: GitExec, cwd: string, argv: readonly string[]): Promise<GitExecResult> {
  const result = await run(exec, cwd, argv)
  if (result.code !== 0) throw new Error(result.stderr.trim() || `git ${argv.join(" ")} failed`)
  return result
}

function run(exec: GitExec, cwd: string, argv: readonly string[]): Promise<GitExecResult> {
  return exec.run(argv, {
    cwd,
    timeoutMs: GIT_TIMEOUT_MS,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  })
}

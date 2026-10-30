import { isAbsolute, relative, resolve, sep } from "node:path"
import { AGREEMENTS_PATH } from "../agreements/types"
import { readFile } from "../fs/resilient"
import { createNodeGitExec, type GitExec } from "../git"
import { FRONTMATTER_RE } from "../memfs/frontmatter-scalar"
import { describeFrontmatterViolation } from "../memfs/frontmatter-validation"
import { isMemoryContentPath } from "../memfs/paths"
import { redactSecretLikeMaterial } from "../sync/redact"
import { commitCount, readDroppedTrailers, squashWithoutPaths, type DroppedEntry } from "./completion-repair"
import { findSecretLikeFailures } from "./completion-secret-scan"
import type { ReflectionWorktree } from "./worktree"

const GIT_TIMEOUT_MS = 30_000

export type { DroppedEntry }
export { describeDroppedEntries, readDroppedTrailers } from "./completion-repair"

/** `dropped` lists entries the gate removed so the valid ones could land; absent when nothing was dropped. */
export type CompletionValidation =
  | { status: "valid"; tipSha: string; changedPaths: readonly string[]; dropped?: readonly DroppedEntry[] }
  | { status: "no_changes"; tipSha: string; changedPaths: readonly []; dropped?: readonly DroppedEntry[] }
  | { status: "dirty_uncommitted"; detail: string }
  | { status: "failed"; detail: string }

export type DreamTokenBudgetValidation =
  | { status: "valid"; totalTokens: number; targetTokens: number }
  | { status: "budget_not_met"; totalTokens: number; targetTokens: number; detail: string }

export function validateDreamTokenBudget(input: {
  readonly origin: "manual" | "idle" | "shutdown" | "pressure"
  readonly totalTokens: number
  readonly targetTokens: number
}): DreamTokenBudgetValidation {
  if (input.origin !== "pressure" || input.totalTokens < input.targetTokens) {
    return { status: "valid", totalTokens: input.totalTokens, targetTokens: input.targetTokens }
  }
  return {
    status: "budget_not_met",
    totalTokens: input.totalTokens,
    targetTokens: input.targetTokens,
    detail: `Committed system/ estimate is ${input.totalTokens} tokens; pressure dream target is below ${input.targetTokens} tokens`,
  }
}

export async function validateCompletion(
  worktree: ReflectionWorktree,
  recordedBase: string,
  exec: GitExec = createNodeGitExec(),
): Promise<CompletionValidation> {
  try {
    const gitFile = await readFile(worktree.gitFilePath, "utf8")
    const commonConfig = await readOptional(worktree.commonConfigPath)
    if (gitFile !== worktree.gitFileSnapshot || commonConfig !== worktree.commonConfigSnapshot) {
      return { status: "failed", detail: "Git administration files were modified" }
    }

    const status = await git(exec, worktree.dir, ["status", "--porcelain"])
    if (status.stdout.trim()) return { status: "dirty_uncommitted", detail: status.stdout }

    const tip = await git(exec, worktree.dir, ["rev-parse", "--verify", "HEAD"])
    const tipSha = tip.stdout.trim()
    if (!tipSha) return { status: "failed", detail: "Reflection branch has no HEAD commit" }

    const based = await run(exec, worktree.dir, ["merge-base", "--is-ancestor", recordedBase, tipSha])
    if (based.code !== 0) {
      return { status: "failed", detail: "Reflection branch is not based on the recorded launch SHA" }
    }
    if (tipSha === recordedBase) return { status: "no_changes", tipSha, changedPaths: [] }

    return await screenEntries(exec, worktree, recordedBase, tipSha)
  } catch (error) {
    return { status: "failed", detail: errorMessage(error) }
  }
}

const MAX_REPAIR_ROUNDS = 3

/**
 * One entry that fails validation must not discard the run's valid entries.
 *
 * This REWRITES the run's branch when an entry is dropped (reset --soft to the base, then one commit without
 * the dropped paths), also when a caller only probes eligibility, and also on a later failure: a run that then
 * fails is discarded, so the rewrite is never merged. The squashed commit carries one
 * `Omo-Completion-Dropped` trailer per dropped entry, so validating the same tip again reports them. Each round collects
 * every per-entry failure (secret-like content or name, invalid frontmatter); when there are any,
 * the branch is rewritten without those entries and screened again. Structural refusals (a path
 * escaping the repository, no changed paths) still fail the whole run.
 */
async function screenEntries(
  exec: GitExec,
  worktree: ReflectionWorktree,
  recordedBase: string,
  startTip: string,
): Promise<CompletionValidation> {
  const dir = worktree.dir
  const dropped = new Map<string, string>()
  const droppedList = (): { dropped?: DroppedEntry[] } =>
    dropped.size === 0 ? {} : { dropped: [...dropped].map(([path, reason]) => ({ path, reason })) }
  let tipSha = startTip
  for (let round = 0; ; round += 1) {
    if (tipSha === recordedBase) return { status: "no_changes", tipSha, changedPaths: [], ...droppedList() }
    const changedPaths = await listReflectionChangedPaths(exec, dir, recordedBase, tipSha)
    for (const path of changedPaths) {
      if (!isConfinedRepoPath(worktree.parent.dir, path) || path.split("/").includes(".git")) {
        return { status: "failed", detail: `Changed path escapes the memory repository: ${path}` }
      }
    }
    // Rename detection is off here on purpose: `git mv system/agreements.md elsewhere` must read as a deletion.
    const ledger = await git(exec, dir, ["diff", "--no-renames", "--name-only", "-z", `${recordedBase}..${tipSha}`, "--", AGREEMENTS_PATH])
    if (ledger.stdout.split("\0").some(Boolean)) {
      return { status: "failed", detail: `Reflection may not modify ${AGREEMENTS_PATH}; agreements change only through the facts lane and /agreements` }
    }
    const secrets = await findSecretLikeFailures((argv, stdin) => run(exec, dir, argv, stdin), recordedBase, tipSha)
    const frontmatter = await findFrontmatterFailures(exec, dir, recordedBase, tipSha, changedPaths)
    if (secrets.length === 0 && frontmatter.size === 0 && changedPaths.length === 0) {
      return { status: "failed", detail: "Reflection commits contain no changed paths" }
    }
    if (secrets.length === 0 && frontmatter.size === 0) {
      if (dropped.size === 0) {
        for (const entry of await readDroppedTrailers(exec, dir, recordedBase, tipSha)) dropped.set(entry.path, entry.reason)
      }
      return { status: "valid", tipSha, changedPaths, ...droppedList() }
    }
    if (round >= MAX_REPAIR_ROUNDS) {
      return { status: "failed", detail: secrets[0]?.detail ?? [...frontmatter.values()][0] ?? "completion validation failed" }
    }
    // A secret in an earlier commit may be gone from the tip, so a multi-commit branch is first
    // squashed with only the tip-level frontmatter failures removed; the squashed commit is then
    // scanned and whatever still fails is a real entry to drop.
    const multiCommit = (await commitCount(exec, dir, recordedBase, tipSha)) > 1
    const now = new Map<string, string>(frontmatter)
    if (!multiCommit) for (const { path, detail } of secrets) now.set(path, detail)
    for (const [path, reason] of now) if (!dropped.has(path)) dropped.set(path, reason)
    tipSha = await squashWithoutPaths(exec, dir, recordedBase, tipSha, new Set(now.keys()), droppedList().dropped ?? [])
  }
}

export async function listReflectionChangedPaths(
  exec: GitExec,
  dir: string,
  baseSha: string,
  tipSha: string,
): Promise<string[]> {
  const changed = await git(exec, dir, ["diff", "--name-only", "-z", `${baseSha}..${tipSha}`, "--"])
  return changed.stdout.split("\0").filter(Boolean)
}

/**
 * A reflection may not introduce or alter frontmatter that a strict YAML
 * consumer rejects. Legacy files whose frontmatter block is byte-identical to
 * the base are the normalizer's job, not the reflection's, so a body-only edit
 * of one still passes.
 */
async function findFrontmatterFailures(
  exec: GitExec,
  dir: string,
  baseSha: string,
  tipSha: string,
  changedPaths: readonly string[],
): Promise<Map<string, string>> {
  const failures = new Map<string, string>()
  for (const path of changedPaths) {
    if (!isMemoryContentPath(path)) continue
    const tipContent = await showOptional(exec, dir, tipSha, path)
    if (tipContent === null) continue
    const violation = describeFrontmatterViolation(tipContent)
    if (violation === null) continue
    const baseContent = await showOptional(exec, dir, baseSha, path)
    if (baseContent !== null && frontmatterBlock(baseContent) === frontmatterBlock(tipContent)) continue
    failures.set(path, `invalid frontmatter: ${redactSecretLikeMaterial(violation)}`)
  }
  return failures
}

export function frontmatterBlock(content: string): string | null {
  const match = FRONTMATTER_RE.exec(content.replace(/\r\n?/g, "\n"))
  return match?.[1] ?? null
}

/**
 * Reads one blob, or null when the path is absent at that revision. `git show rev:path` would fall back to reading a
 * missing glob-named path (`k*.md`, `k[x].md`) as a pathspec and exit 0 with empty output; `cat-file blob` takes
 * only an object name, so a missing path is always a failure, never a pattern.
 */
async function showOptional(exec: GitExec, dir: string, revision: string, path: string): Promise<string | null> {
  const result = await run(exec, dir, ["cat-file", "blob", `${revision}:${path}`])
  return result.code === 0 ? result.stdout : null
}

function isConfinedRepoPath(root: string, path: string): boolean {
  if (!path || isAbsolute(path) || path.includes("\0")) return false
  const destination = resolve(root, path)
  const rel = relative(resolve(root), destination)
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
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

function run(exec: GitExec, cwd: string, argv: readonly string[], stdin?: string) {
  return exec.run(argv, {
    cwd,
    timeoutMs: GIT_TIMEOUT_MS,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    ...(stdin === undefined ? {} : { stdin }),
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

import { isAbsolute, relative, resolve, sep } from "node:path"
import { readFile } from "../fs/resilient"
import { createNodeGitExec, type GitExec } from "../git"
import type { ReflectionWorktree } from "./worktree"

const GIT_TIMEOUT_MS = 30_000

export type CompletionValidation =
  | { status: "valid"; tipSha: string; changedPaths: readonly string[] }
  | { status: "no_changes"; tipSha: string; changedPaths: readonly [] }
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

    const changed = await git(exec, worktree.dir, ["diff", "--name-only", "-z", `${recordedBase}..${tipSha}`, "--"])
    const changedPaths = changed.stdout.split("\0").filter(Boolean)
    if (changedPaths.length === 0) {
      return { status: "failed", detail: "Reflection commits contain no changed paths" }
    }
    for (const path of changedPaths) {
      if (!isConfinedRepoPath(worktree.parent.dir, path) || path.split("/").includes(".git")) {
        return { status: "failed", detail: `Changed path escapes the memory repository: ${path}` }
      }
    }
    return { status: "valid", tipSha, changedPaths }
  } catch (error) {
    return { status: "failed", detail: errorMessage(error) }
  }
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

function run(exec: GitExec, cwd: string, argv: readonly string[]) {
  return exec.run(argv, { cwd, timeoutMs: GIT_TIMEOUT_MS, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

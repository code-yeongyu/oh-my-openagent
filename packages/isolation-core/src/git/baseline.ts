import { lstat, readdir } from "node:fs/promises"
import { join, relative, sep } from "node:path"
import { exists, GitCommandTimeoutError, runGit, type GitOptions } from "./command"

export const ISOLATION_BASELINE_MAX_CONTENT_BYTES = 1024 * 1024 * 1024
const BASELINE_GIT_TIMEOUT_MS = 10_000
const BASELINE_READ_CONFIG = ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false"] as const
const BASELINE_READ_ENV = { GIT_OPTIONAL_LOCKS: "0" } as const
export class IsolationBaselineTooLargeError extends Error {
  constructor(readonly repoRoot: string, readonly contentBytes: number | undefined, readonly budgetBytes = ISOLATION_BASELINE_MAX_CONTENT_BYTES) {
    super(`Working tree at ${repoRoot} exceeds the ${budgetBytes}-byte isolation snapshot budget. Commit or gitignore bulk content before isolation.`)
    this.name = "IsolationBaselineTooLargeError"
  }
}
export interface RepoBaseline {
  repoRoot: string
  headCommit: string
  staged: string
  unstaged: string
  untrackedFiles: string[]
  untrackedPatch: string
}
export interface WorktreeBaseline {
  root: RepoBaseline
  nested: { relativePath: string; baseline: RepoBaseline }[]
}
export interface BaselineReadRetryDetails {
  readonly args: readonly string[]
  readonly cwd: string
  readonly timeoutMs: number
}
export interface BaselineCaptureOptions {
  readonly onReadRetry?: (details: BaselineReadRetryDetails) => void
  readonly runGit?: typeof runGit
}

const logBaselineReadRetry = (details: BaselineReadRetryDetails): void => {
  console.warn("[isolation-core] retrying timed-out read-only Git command", details)
}
async function runBaselineRead(
  args: string[],
  gitOptions: GitOptions,
  captureOptions: BaselineCaptureOptions = {},
): ReturnType<typeof runGit> {
  const executeGit = captureOptions.runGit ?? runGit
  const hardenedArgs = [...BASELINE_READ_CONFIG, ...args]
  const hardenedOptions = {
    ...gitOptions,
    env: { ...gitOptions.env, ...BASELINE_READ_ENV },
    timeoutMs: gitOptions.timeoutMs ?? BASELINE_GIT_TIMEOUT_MS,
  }
  const attempt = () => executeGit(hardenedArgs, hardenedOptions)
  try {
    return await attempt()
  } catch (error) {
    if (!(error instanceof GitCommandTimeoutError)) throw error
    const onReadRetry = captureOptions.onReadRetry ?? logBaselineReadRetry
    onReadRetry({ args, cwd: gitOptions.cwd, timeoutMs: error.timeoutMs })
    return attempt()
  }
}

export async function discoverNestedRepos(repoRoot: string): Promise<string[]> {
  const status = (await runBaselineRead(["submodule", "status"], { cwd: repoRoot })).stdout.toString()
  const submodules = new Set(status.split("\n").filter(Boolean).map(line => line.slice(42).replace(/ \([^\n]*\)$/, "")))
  const result: string[] = []
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === ".git" || entry.name === "node_modules") continue
      const full = join(dir, entry.name)
      const rel = relative(repoRoot, full).split(sep).join("/")
      if (submodules.has(rel)) continue
      if (await exists(join(full, ".git"))) result.push(rel)
      else await walk(full)
    }
  }
  await walk(repoRoot)
  return result.sort()
}

export async function captureRepoBaseline(
  repoRoot: string,
  budgetBytes = ISOLATION_BASELINE_MAX_CONTENT_BYTES,
  options: BaselineCaptureOptions = {},
): Promise<RepoBaseline> {
  let remaining = budgetBytes
  const capture = async (args: string[], allowedExitCodes?: number[]): Promise<string> => {
    const { stdout } = await runBaselineRead(args, {
      cwd: repoRoot, allowedExitCodes, maxOutputBytes: remaining,
      outputLimitError: () => new IsolationBaselineTooLargeError(repoRoot, undefined, budgetBytes),
    }, options)
    remaining -= stdout.byteLength
    return stdout.toString()
  }
  const head = await runBaselineRead(
    ["rev-parse", "--verify", "--quiet", "HEAD"],
    { cwd: repoRoot, allowedExitCodes: [0, 1] },
    options,
  )
  const headCommit = head.stdout.toString().trim()
  const diffArgs = ["diff", "--binary", "--no-ext-diff", "--no-textconv", "--ignore-submodules=all"]
  const staged = await capture([...diffArgs, "--cached"])
  const unstaged = await capture(diffArgs)
  const listed = await capture(["ls-files", "--others", "--exclude-standard", "-z"])
  const untrackedFiles: string[] = []
  let contentBytes = budgetBytes - remaining
  for (const file of listed.split("\0").filter(Boolean)) {
    const stat = await lstat(join(repoRoot, file))
    // Git reports an embedded repository as a directory, not its contents.
    if (stat.isDirectory()) continue
    contentBytes += stat.size
    if (contentBytes > budgetBytes) throw new IsolationBaselineTooLargeError(repoRoot, contentBytes, budgetBytes)
    untrackedFiles.push(file)
  }
  const patches: string[] = []
  for (const file of untrackedFiles) {
    patches.push(await capture(["diff", "--no-index", "--binary", "--no-ext-diff", "--no-textconv", "--", process.platform === "win32" ? "NUL" : "/dev/null", file], [0, 1]))
  }
  return { repoRoot, headCommit, staged, unstaged, untrackedFiles, untrackedPatch: patches.join("") }
}

export async function captureBaseline(repoRoot: string, budgetBytes = ISOLATION_BASELINE_MAX_CONTENT_BYTES): Promise<WorktreeBaseline> {
  const root = await captureRepoBaseline(repoRoot, budgetBytes)
  const nested: WorktreeBaseline["nested"] = []
  for (const relativePath of await discoverNestedRepos(repoRoot)) {
    nested.push({ relativePath, baseline: await captureRepoBaseline(join(repoRoot, relativePath), budgetBytes) })
  }
  return { root, nested }
}

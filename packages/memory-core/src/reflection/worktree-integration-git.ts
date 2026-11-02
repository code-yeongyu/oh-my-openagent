import type { GitExec, GitExecResult } from "../git"

const GIT_TIMEOUT_MS = 30_000

export function runGit(exec: GitExec, cwd: string, argv: readonly string[]): Promise<GitExecResult> {
  return exec.run(argv, {
    cwd,
    timeoutMs: GIT_TIMEOUT_MS,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  })
}

export async function gitOrThrow(exec: GitExec, cwd: string, argv: readonly string[]): Promise<GitExecResult> {
  const result = await runGit(exec, cwd, argv)
  if (result.code !== 0) throw new Error(result.stderr.trim() || `git ${argv.join(" ")} failed`)
  return result
}

export async function isAncestor(exec: GitExec, cwd: string, ancestor: string, descendant: string): Promise<boolean> {
  return (await runGit(exec, cwd, ["merge-base", "--is-ancestor", ancestor, descendant])).code === 0
}

export async function optionalRevision(exec: GitExec, cwd: string, revision: string): Promise<string | null> {
  const result = await runGit(exec, cwd, ["rev-parse", "-q", "--verify", revision])
  return result.code === 0 ? result.stdout.trim() || null : null
}

export interface IndexLockRetry {
  readonly attempts: number
  readonly delayMs: number
  readonly sleep: (ms: number) => Promise<void>
}

export const DEFAULT_INDEX_LOCK_RETRY: IndexLockRetry = {
  attempts: 5,
  delayMs: 250,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

// git reports a held index lock as "Unable to create '<git-dir>/index.lock': File exists." when it
// takes the lock and as "Unable to write index." when a refresh cannot; both mean "retry later".
const INDEX_LOCK_FAILURE = /index\.lock'?: File exists|Unable to write index/

export function isIndexLockFailure(stderr: string): boolean {
  return INDEX_LOCK_FAILURE.test(stderr)
}

export async function retryOnIndexLock(
  retry: IndexLockRetry,
  attempt: () => Promise<GitExecResult>,
): Promise<GitExecResult> {
  let result = await attempt()
  for (let tried = 1; tried < retry.attempts && result.code !== 0 && isIndexLockFailure(result.stderr); tried += 1) {
    await retry.sleep(retry.delayMs * tried)
    result = await attempt()
  }
  return result
}

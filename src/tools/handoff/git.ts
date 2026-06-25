import type { GitHead } from "../../features/handoff"
import { GIT_COMMAND_TIMEOUT_MS, MAX_GIT_OUTPUT_BYTES } from "./constants"

/**
 * Run a single git sub-command and return the trimmed stdout, or `null` on
 * any failure (non-zero exit, spawn error, timeout, empty output).
 *
 * Keeping this small and side-effect-free lets the caller compose multiple
 * `git` calls without scattering try/catch noise throughout the file.
 */
async function runGit(directory: string, args: string[]): Promise<string | null> {
  //#given - a directory that *might* be a git working tree
  try {
    const proc = Bun.spawn(["git", ...args], {
      cwd: directory,
      stdout: "pipe",
      stderr: "pipe",
    })

    //#when - racing stdout read against a hard timeout
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => {
        try {
          proc.kill()
        } catch {
          // best-effort kill; ignore failures
        }
        reject(new Error(`git ${args[0]} timed out`))
      }, GIT_COMMAND_TIMEOUT_MS)
    })

    const read = (async () => {
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])
      if (exitCode !== 0) {
        // Surface stderr only in the throw so we don't leak it via console.
        throw new Error(stderr.trim() || `git ${args[0]} exit ${exitCode}`)
      }
      return stdout
    })()

    const stdout = await Promise.race([read, timeout])
    //#then - only return the value if it fits in the safety budget
    if (stdout.length > MAX_GIT_OUTPUT_BYTES) return null
    const trimmed = stdout.trim()
    return trimmed.length > 0 ? trimmed : null
  } catch {
    //#then - any failure (no git, not a repo, timeout) collapses to null
    return null
  }
}

/**
 * Resolve the current git HEAD for `directory`.
 *
 * Returns a `GitHead` (`{ sha, branch?, detached? }`) when `directory` is
 * inside a working git repo, or `null` otherwise. Never throws.
 *
 * - `sha` always populated (HEAD's commit sha)
 * - `branch` populated when HEAD points at a local branch
 * - `detached: true` when HEAD points directly at a commit
 */
export async function getGitHead(directory: string): Promise<GitHead | null> {
  if (!directory) return null

  //#given - get the commit sha
  const sha = await runGit(directory, ["rev-parse", "HEAD"])
  if (!sha) return null

  //#when - figure out the branch name (may be empty in detached state)
  const branch = await runGit(directory, ["branch", "--show-current"])

  //#then - detached iff `branch` is empty
  const detached = branch === null || branch === ""

  const head: GitHead = { sha, detached }
  if (branch) {
    head.branch = branch
  }
  return head
}

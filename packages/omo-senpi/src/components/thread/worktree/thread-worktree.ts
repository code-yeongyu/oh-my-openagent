import { execFile } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import { mkdir, stat } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import type { ThreadDataError } from "../contracts"
import { discardWorktree } from "./discard-worktree"
import { errnoReason, folderFailure, gitFailureReason } from "./failures"

export type WorktreeRequest = { readonly branch?: string; readonly base?: string }
export type ThreadWorktree = {
  readonly path: string
  readonly branch: string
  /** The commit the branch starts at. */
  readonly base: string
  readonly repository: string
  /** Another device's short-lived worktree session that would not close (`remote-worktree.ts`); absent when it closed. */
  readonly setup_session_left_open?: string
}
export type WorktreeOutcome = { readonly kind: "ok"; readonly worktree: ThreadWorktree } | ThreadDataError

export type GitResult = { readonly exit: number | "spawn_failed" | "timeout"; readonly stdout: string; readonly stderr: string }
export type GitRun = (args: readonly string[], cwd: string) => Promise<GitResult>

const GIT_TIMEOUT_MS = 60_000

export const runGit: GitRun = (args, cwd) =>
  new Promise((resolve) => {
    execFile("git", [...args], { cwd, timeout: GIT_TIMEOUT_MS, windowsHide: true }, (error, stdout, stderr) => {
      if (error === null) return resolve({ exit: 0, stdout, stderr })
      const failed = error as NodeJS.ErrnoException & { killed?: boolean; code?: unknown }
      if (failed.code === "ENOENT") return resolve({ exit: "spawn_failed", stdout, stderr: failed.message })
      if (failed.killed === true) return resolve({ exit: "timeout", stdout, stderr })
      resolve({ exit: typeof failed.code === "number" ? failed.code : 1, stdout, stderr: stderr || failed.message })
    })
  })

export async function checkFolder(path: string): Promise<ThreadDataError | undefined> {
  try {
    if ((await stat(path)).isDirectory()) return undefined
    return folderFailure("not_a_directory", `${path} is not a folder.`, { path })
  } catch (error) {
    const reason = errnoReason(error) ?? "folder_missing"
    return folderFailure(reason, `Folder ${path} cannot be used (${reason}).`, { path })
  }
}

const generatedBranch = (now: Date): string =>
  `omo/thread-${now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)}-${randomBytes(2).toString("hex")}`

/**
 * Creates the git worktree a new thread starts in: a new `branch` at `base` (default HEAD) of the repository holding
 * `repository`, in `<root>/<repo name>-<hash of its path>/<branch>`, a folder OmO owns (the rule the desktop keeps for
 * the worktrees it may later remove, desktop #2449). Every failure is typed (`failures.ts`); nothing is left behind
 * by a refused create: each check runs before `git worktree add`, and a failed add is undone (`discard-worktree.ts`).
 */
export async function createThreadWorktree(options: {
  readonly repository: string
  readonly request: WorktreeRequest
  readonly root: string
  readonly git?: GitRun
  readonly now?: () => Date
}): Promise<WorktreeOutcome> {
  const git = options.git ?? runGit
  const folder = await checkFolder(options.repository)
  if (folder !== undefined) return folder
  const failedGit = (result: GitResult, details: Readonly<Record<string, unknown>>): ThreadDataError => {
    if (result.exit === "spawn_failed") return folderFailure("git_unavailable", "git is not installed here.", details)
    if (result.exit === "timeout") return folderFailure("git_timeout", "git did not answer in time.", details)
    const reason = gitFailureReason(result.stderr)
    return folderFailure(reason, `git refused the worktree (${reason}).`, { ...details, stderr: result.stderr.trim() })
  }
  const top = await git(["rev-parse", "--show-toplevel"], options.repository)
  if (top.exit !== 0) return failedGit(top, { path: options.repository })
  const repository = top.stdout.trim()
  const branch = options.request.branch ?? generatedBranch((options.now ?? (() => new Date()))())
  const base = options.request.base ?? "HEAD"
  if (branch.startsWith("-") || (await git(["check-ref-format", "--branch", branch], repository)).exit !== 0)
    return folderFailure("invalid_branch", `${branch} is not a valid branch name.`, { branch })
  const commit = base.startsWith("-")
    ? undefined
    : await git(["rev-parse", "--verify", "--quiet", `${base}^{commit}`], repository)
  if (commit === undefined || commit.exit !== 0)
    return folderFailure("base_not_found", `${base} names no commit in ${repository}.`, { base, repository })
  if ((await git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], repository)).exit === 0)
    return folderFailure("branch_exists", `Branch ${branch} already exists in ${repository}.`, { branch, repository })
  const repoKey = `${basename(repository)}-${createHash("sha256").update(repository).digest("hex").slice(0, 8)}`
  const path = join(options.root, repoKey, branch.replaceAll("/", "-"))
  if (await stat(path).then(() => true, () => false))
    return folderFailure("worktree_path_exists", `${path} already exists.`, { path, branch })
  let createdFolder: string | undefined
  try {
    createdFolder = await mkdir(dirname(path), { recursive: true })
  } catch (error) {
    const reason = errnoReason(error) ?? "permission_denied"
    return folderFailure(reason, `The worktrees folder ${dirname(path)} cannot be created (${reason}).`, { path })
  }
  const added = await git(["worktree", "add", "-b", branch, path, commit.stdout.trim()], repository)
  if (added.exit !== 0) {
    // A git killed mid-add (its timeout) can leave the branch, a partial checkout and the folder: undo what this call made.
    const left = await discardWorktree({
      repository,
      path,
      branch,
      root: options.root,
      git,
      removeUnregisteredFolder: true,
      ...(createdFolder === undefined ? {} : { createdFolder: dirname(path) }),
    })
    return left ?? failedGit(added, { path, branch, repository })
  }
  return { kind: "ok", worktree: { path, branch, base: commit.stdout.trim(), repository } }
}

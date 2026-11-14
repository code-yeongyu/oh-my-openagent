import type { ThreadDataError } from "../contracts"
import { threadToolFailure, type ThreadErrorCode } from "../errors"

/**
 * Every way placing a new thread's folder can fail (cwd checks and worktree creation, on either device). Each reason
 * maps to one existing failure code and one next action the calling agent can take; `details.reason` names it.
 */
export type FolderFailureReason =
  | "folder_missing"
  | "not_a_directory"
  | "relative_path"
  | "not_a_git_repo"
  | "invalid_branch"
  | "base_not_found"
  | "branch_exists"
  | "branch_checked_out"
  | "worktree_path_exists"
  | "no_space"
  | "permission_denied"
  | "git_unavailable"
  | "git_timeout"
  | "git_failed"
  | "worktree_left_behind"

const TABLE: Readonly<Record<FolderFailureReason, { readonly code: ThreadErrorCode; readonly next: string }>> = {
  folder_missing: { code: "invalid_arguments", next: "Pass an existing folder as cwd; nothing was created." },
  not_a_directory: { code: "invalid_arguments", next: "Pass a folder, not a file, as cwd; nothing was created." },
  relative_path: {
    code: "invalid_arguments",
    next: "Pass an absolute folder; on another device use a path of that device (thread_list with all_scope shows its folders).",
  },
  not_a_git_repo: {
    code: "invalid_arguments",
    next: "Pass a folder inside a git repository as cwd, or drop worktree to start the thread in that folder.",
  },
  invalid_branch: { code: "invalid_arguments", next: "Pass a valid git branch name as worktree.branch." },
  base_not_found: {
    code: "invalid_arguments",
    next: "Pass an existing commit, branch or tag as worktree.base, or drop it to start at HEAD.",
  },
  branch_exists: {
    code: "name_conflict",
    next: "Pass a new branch name as worktree.branch, or drop it to get a generated one.",
  },
  branch_checked_out: {
    code: "name_conflict",
    next: "That branch is checked out in another worktree; pass a new branch name as worktree.branch.",
  },
  worktree_path_exists: {
    code: "name_conflict",
    next: "A folder already exists where the worktree would go; pass another worktree.branch.",
  },
  no_space: {
    code: "host_unavailable",
    next: "Free disk space on that device, then retry; nothing was created.",
  },
  permission_denied: {
    code: "scope_denied",
    next: "The device user cannot write there; fix the folder's permissions or pick another cwd, then retry.",
  },
  git_unavailable: { code: "unsupported", next: "Install git on that device, or drop worktree." },
  git_timeout: { code: "host_unavailable", next: "git did not answer in time on that device; retry once it is idle." },
  git_failed: { code: "invalid_arguments", next: "Read details.stderr, fix the repository state, then retry." },
  worktree_left_behind: {
    code: "partial_commit",
    next: "Remove what details.left names: git worktree remove --force <details.path> and git branch -D <details.branch> in details.repository; then retry.",
  },
}

export function folderFailure(
  reason: FolderFailureReason,
  message: string,
  details: Readonly<Record<string, unknown>> = {},
): ThreadDataError {
  const { code, next } = TABLE[reason]
  return { kind: "error", error: threadToolFailure(code, message, next, { reason, ...details }) }
}

export function gitFailureReason(stderr: string): FolderFailureReason {
  if (/no space left on device/i.test(stderr)) return "no_space"
  if (/permission denied|operation not permitted|read-only file system/i.test(stderr)) return "permission_denied"
  if (/already checked out|is already used by worktree|already used by worktree/i.test(stderr))
    return "branch_checked_out"
  if (/a branch named .* already exists/i.test(stderr)) return "branch_exists"
  if (/already exists/i.test(stderr)) return "worktree_path_exists"
  if (/not a git repository/i.test(stderr)) return "not_a_git_repo"
  if (/invalid reference|not a valid object name|unknown revision/i.test(stderr)) return "base_not_found"
  return "git_failed"
}

export function errnoReason(error: unknown): FolderFailureReason | undefined {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined
  if (code === "ENOENT") return "folder_missing"
  if (code === "ENOTDIR") return "not_a_directory"
  if (code === "ENOSPC" || code === "EDQUOT") return "no_space"
  if (code === "EACCES" || code === "EPERM" || code === "EROFS") return "permission_denied"
  return undefined
}

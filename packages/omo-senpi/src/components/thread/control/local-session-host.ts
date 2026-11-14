import { join } from "node:path"
import { resolveAgentHome } from "../../agent-home/resolve-agent-home"
import { workspaceEntries } from "../addressing"
import type { ThreadSummary, ThreadWorkspaceNote } from "../contracts"
import type { ThreadHost } from "../tools/ports"
import { folderFailure } from "../worktree/failures"
import { discardWorktree } from "../worktree/discard-worktree"
import { checkFolder, createThreadWorktree, runGit } from "../worktree/thread-worktree"
import { openedThread, type HostedThread, type SessionHost } from "./session-host"

/**
 * A thread this device opened in a folder outside the caller's workspace is `scope_denied` to the caller (its
 * creator included) unless `all_scope` is set, judged as `resolveTarget` judges it; the result says so. A thread on
 * another device belongs to the account, so it never carries the note.
 */
export function workspaceNote(thread: HostedThread, callerWorkspaceRoot: string): ThreadWorkspaceNote {
  // No caller workspace: scoped addressing answers caller_context_missing for every thread, not scope_denied.
  if (thread.device !== undefined || callerWorkspaceRoot === "") return {}
  const { thread_id, name, status, cwd, created_at, updated_at } = thread
  const entry = { thread_id, name, status, cwd, created_at, updated_at }
  if (workspaceEntries([entry], callerWorkspaceRoot).length > 0) return {}
  return {
    workspace_scope: "outside",
    scope_next_action: `Thread ${thread_id} is in ${cwd}, outside this session's workspace: pass all_scope: true when you address it, and to see it in thread_list.`,
  }
}

export const defaultWorktreeRoot = (): string => join(resolveAgentHome({ env: process.env }), "worktrees")

/**
 * This device's operator endpoint as a SessionHost: `visible` is the address book this call assembled, `open` the host's
 * `open_session`, after the folder it names is checked and, when asked, the worktree is created in it.
 */
export function createLocalSessionHost(
  host: ThreadHost,
  visible: readonly ThreadSummary[],
  worktreeRoot: () => string = defaultWorktreeRoot,
): SessionHost {
  return {
    visible: async () => visible,
    open: async ({ worktree, ...request }) => {
      if (request.cwd !== undefined) {
        const refused = await checkFolder(request.cwd)
        if (refused !== undefined) return refused
      }
      if (worktree === undefined) return { kind: "ok", thread: openedThread(await host.openSession(request)) }
      if (request.cwd === undefined)
        return folderFailure("relative_path", "A worktree needs the repository folder; pass cwd.")
      const made = await createThreadWorktree({ repository: request.cwd, request: worktree, root: worktreeRoot() })
      if (made.kind === "error") return made
      const { path, branch, repository } = made.worktree
      let opened: Awaited<ReturnType<ThreadHost["openSession"]>>
      try {
        opened = await host.openSession({ ...request, cwd: path })
      } catch (error) {
        // The open failed: undo the worktree this call made, so a retry does not leave another one; the open's own
        // failure stands unless the worktree could not be removed, which is then the answer, naming what remains.
        const left = await discardWorktree({ repository, path, branch, root: worktreeRoot(), git: runGit })
        if (left === undefined) throw error
        return { ...left, error: { ...left.error, details: { ...left.error.details, cause: String(error) } } }
      }
      return { kind: "ok", thread: { ...openedThread(opened), worktree: made.worktree } }
    },
  }
}

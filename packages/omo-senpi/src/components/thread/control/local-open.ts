import type { ThreadHost } from "../tools/ports"
import { folderFailure } from "../worktree/failures"
import { modelRefusal } from "./open-reply"
import { discardWorktree } from "../worktree/discard-worktree"
import { checkFolder, createThreadWorktree, runGit } from "../worktree/thread-worktree"
import { openedThread, type SessionOpenOutcome, type SessionOpenRequest } from "./session-host"

/**
 * The open of a thread on this device: the folder it names is checked and, when asked, the worktree is created in it.
 * It ships in the thread client sidecar (`#omo-thread-client-runtime`) with the rest of the create-time code, so
 * `omo.js` carries none of the worktree implementation (`local-session-host.ts` loads it on the first open).
 */
export async function openLocally(
  host: ThreadHost,
  { worktree, ...request }: SessionOpenRequest,
  worktreeRoot: () => string,
): Promise<SessionOpenOutcome> {
  if (request.cwd !== undefined) {
    const refused = await checkFolder(request.cwd)
    if (refused !== undefined) return refused
  }
  const model = request.provider === undefined ? undefined : `${request.provider}/${request.modelId ?? ""}`
  // A model the engine cannot run refuses the open (`model_unavailable`); that is the caller's argument to fix.
  const unrunnable = (error: unknown) => modelRefusal(error instanceof Error ? error.message : String(error), model)
  if (worktree === undefined) {
    try {
      return { kind: "ok", thread: openedThread(await host.openSession(request)) }
    } catch (error) {
      const refused = unrunnable(error)
      if (refused === undefined) throw error
      return refused
    }
  }
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
    if (left === undefined) {
      const refused = unrunnable(error)
      if (refused === undefined) throw error
      return refused
    }
    return { ...left, error: { ...left.error, details: { ...left.error.details, cause: String(error) } } }
  }
  return { kind: "ok", thread: { ...openedThread(opened), worktree: made.worktree } }
}

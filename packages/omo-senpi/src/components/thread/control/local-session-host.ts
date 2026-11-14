import { join } from "node:path"
import { resolveAgentHome } from "../../agent-home/resolve-agent-home"
import type { ThreadSummary } from "../contracts"
import { summary } from "../tools/internals"
import type { ThreadHost } from "../tools/ports"
import { folderFailure } from "../worktree/failures"
import { checkFolder, createThreadWorktree } from "../worktree/thread-worktree"
import type { SessionHost } from "./session-host"

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
      if (worktree === undefined) return { kind: "ok", thread: summary(await host.openSession(request)) }
      if (request.cwd === undefined)
        return folderFailure("relative_path", "A worktree needs the repository folder; pass cwd.")
      const made = await createThreadWorktree({ repository: request.cwd, request: worktree, root: worktreeRoot() })
      if (made.kind === "error") return made
      const opened = await host.openSession({ ...request, cwd: made.worktree.path })
      return { kind: "ok", thread: { ...summary(opened), worktree: made.worktree } }
    },
  }
}

import { join } from "node:path"
import { resolveAgentHome } from "../../agent-home/resolve-agent-home"
import type { ThreadSummary } from "../contracts"
import type { ThreadHost } from "../tools/ports"
import type { SessionHost } from "./session-host"

export const defaultWorktreeRoot = (): string => join(resolveAgentHome({ env: process.env }), "worktrees")

/**
 * This device's operator endpoint as a SessionHost: `visible` is the address book this call assembled, `open` the host's
 * `open_session` (`local-open.ts`, from the thread client sidecar, so `omo.js` carries no folder or worktree code).
 */
export function createLocalSessionHost(
  host: ThreadHost,
  visible: readonly ThreadSummary[],
  worktreeRoot: () => string = defaultWorktreeRoot,
): SessionHost {
  return {
    visible: async () => visible,
    open: async (request) =>
      await (await import("#omo-thread-client-runtime")).openLocally(host, request, worktreeRoot),
  }
}

import type { ComponentContext, SenpiExtensionAPI } from "../../extension/types"
import { defaultWorktreeRoot } from "./control/local-session-host"
import { registerInitialSkills } from "./initial-skills"
import { THREAD_WORKTREE_RPC } from "./worktree/worktree-rpc-name"

/**
 * The receiving half of thread_create in every session: the initial skills a creator asked for, and the worktree
 * request another device's thread_create sends this device's omo. Only the request's name is registered here; its
 * handler (`worktree/worktree-rpc.ts`) loads from the thread client sidecar on the first request.
 */
export function registerCreateReceivers(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
  registerInitialSkills(pi, ctx)
  pi.rpc?.handle?.(THREAD_WORKTREE_RPC, async (data) =>
    (await import("#omo-thread-client-runtime")).answerWorktreeRequest(data, defaultWorktreeRoot()),
  )
}

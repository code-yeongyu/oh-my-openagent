import type { ComponentContext, SenpiExtensionAPI } from "../../extension/types"
import { defaultWorktreeRoot } from "./control/local-session-host"
import { registerInitialSkills } from "./initial-skills"
import { registerThreadWorktreeRpc } from "./worktree/worktree-rpc"

/**
 * The receiving half of thread_create in every session: the initial skills a creator asked for, and the worktree
 * request another device's thread_create sends this device's omo (`worktree/worktree-rpc.ts`).
 */
export function registerCreateReceivers(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
  registerInitialSkills(pi, ctx)
  registerThreadWorktreeRpc(pi, defaultWorktreeRoot)
}

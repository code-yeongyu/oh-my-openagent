import type { SenpiExtensionAPI } from "../../../extension/types"
import { folderFailure } from "./failures"
import { createThreadWorktree, type WorktreeOutcome } from "./thread-worktree"

/** The `extension_request` another device's thread_create sends this device's omo to create a worktree here. */
export const THREAD_WORKTREE_RPC = "omo.thread.worktree"

const optionalString = (value: unknown): string | undefined | false =>
  value === undefined ? undefined : typeof value === "string" && value.length > 0 ? value : false

export async function answerWorktreeRequest(data: unknown, root: string): Promise<WorktreeOutcome> {
  const record = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {}
  const cwd = optionalString(record["cwd"])
  const branch = optionalString(record["branch"])
  const base = optionalString(record["base"])
  if (typeof cwd !== "string" || branch === false || base === false)
    return folderFailure("relative_path", "The worktree request names no repository folder.")
  return await createThreadWorktree({
    repository: cwd,
    request: { ...(branch === undefined ? {} : { branch }), ...(base === undefined ? {} : { base }) },
    root,
  })
}

export function registerThreadWorktreeRpc(pi: SenpiExtensionAPI, root: () => string): void {
  pi.rpc?.handle?.(THREAD_WORKTREE_RPC, (data) => answerWorktreeRequest(data, root()))
}

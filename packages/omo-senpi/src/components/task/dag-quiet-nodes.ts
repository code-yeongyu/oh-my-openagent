import { DAG_NODE_QUIET_AFTER_MS } from "@oh-my-opencode/senpi-task/dag"

export const AWAITING_REVIVAL_ACTIVITY = "waiting for its child to be revived"

export type NodeChildRecord = { readonly status: string; readonly residency_state: string }

// A non-terminal node whose unfinished child is suspended (`persisted_only` / `rpc_detached`) is not
// working and has not failed: it waits for this host's lifecycle to revive the child (#15150).
export function awaitsChildRevival(
  node: { readonly state: string; readonly taskId?: string },
  childRecord: ((taskId: string) => NodeChildRecord | undefined) | undefined,
): boolean {
  if (node.taskId === undefined || (node.state !== "running" && node.state !== "scheduled")) return false
  const child = childRecord?.(node.taskId)
  return (
    (child?.status === "pending" || child?.status === "running") &&
    (child.residency_state === "persisted_only" || child.residency_state === "rpc_detached")
  )
}

export function awaitingRevivalNotice(
  nodes: readonly { readonly id: string; readonly state: string; readonly taskId?: string }[],
  childRecord: ((taskId: string) => NodeChildRecord | undefined) | undefined,
): string {
  const waiting = nodes.filter((node) => awaitsChildRevival(node, childRecord)).map((node) => node.id)
  return waiting.length === 0 ? "" : ` Not working yet, ${AWAITING_REVIVAL_ACTIVITY}: ${waiting.join(", ")}.`
}

export type QuietNodeInput = {
  readonly id: string
  readonly state: string
  readonly lastActivityAt?: string
}

// A running node reports its child's last transcript write. Long silence does NOT mean failure - a
// single long tool call looks the same - so this states the observation and never renders a verdict.
// Without it the model reads one undifferentiated "running" and cannot tell a working child from a
// finished-but-unreaped one (#8674).
export function quietNodesNotice(nodes: readonly QuietNodeInput[], now: number): string {
  const quiet = nodes.flatMap((node) => {
    if (node.state !== "running" || node.lastActivityAt === undefined) return []
    const silentMs = now - Date.parse(node.lastActivityAt)
    if (!Number.isFinite(silentMs) || silentMs < DAG_NODE_QUIET_AFTER_MS) return []
    return [`${node.id} (${Math.floor(silentMs / 60_000)}m)`]
  })
  return quiet.length === 0 ? "" : ` Quiet children, no transcript activity: ${quiet.join(", ")}.`
}

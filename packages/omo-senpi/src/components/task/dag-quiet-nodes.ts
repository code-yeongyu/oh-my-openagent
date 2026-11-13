import { DAG_NODE_QUIET_AFTER_MS } from "@oh-my-opencode/senpi-task/dag"

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

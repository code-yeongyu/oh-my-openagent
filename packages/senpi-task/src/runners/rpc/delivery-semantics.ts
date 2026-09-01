/**
 * Queueing semantics for messages delivered into a running RPC child.
 *
 * senpi's AgentSession.prompt() REJECTS a message that arrives on a streaming
 * session without an explicit streamingBehavior. On a slow host (Windows) the
 * parent's delivery routinely lands mid-run, so an omitted field turned a normal
 * steer into a child abort before any task record was flushed (issue #6976).
 * Every delivery therefore declares "steer", and a host that still refuses the
 * queued form is retried as "followUp" instead of failing the child.
 */
export type RpcStreamingBehavior = "steer" | "followUp"

/**
 * Recognizes a rejection that means "this message needs queueing semantics" or
 * "this queue is one-at-a-time", i.e. the child is alive and simply busy. Only
 * these justify the followUp retry; any other error is a real failure and is
 * rethrown so callers still observe genuine prompt failures.
 */
export function isBusyChildRejection(error: unknown): boolean {
  const detail = rejectionDetail(error)
  if (detail === undefined) return false
  const normalized = detail.toLowerCase()
  return (
    normalized.includes("already processing") ||
    normalized.includes("streamingbehavior") ||
    normalized.includes("one-at-a-time")
  )
}

function rejectionDetail(error: unknown): string | undefined {
  if (error === null || typeof error !== "object") return undefined
  const detail = (error as { readonly detail?: unknown }).detail
  if (typeof detail === "string") return detail
  const message = (error as { readonly message?: unknown }).message
  return typeof message === "string" ? message : undefined
}

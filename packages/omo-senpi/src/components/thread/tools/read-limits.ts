import { THREAD_READ_MAX_LIMIT, type ThreadReadInput, type ThreadToolResult } from "../contracts"
import { failure } from "./internals"
import type { ThreadHostView, ThreadToolSurfaceOptions } from "./ports"
import { readThread } from "./read-ops"

// A receipt read (delivery_id) has no messages, so a limit on it is refused rather than dropped.
export function receiptLimitRefusal(value: {
  readonly thread: string
  readonly delivery_id: string
  readonly limit?: number
}): ThreadToolResult | undefined {
  if (value.limit === undefined) return undefined
  return failure(
    "invalid_arguments",
    "limit sets how many messages a read returns, and delivery_id reads one delivery's receipt, which has no messages. Nothing was done.",
    `Read the receipt without limit: tool.thread_read(${JSON.stringify({ thread: value.thread, delivery_id: value.delivery_id })}).`,
  )
}

/**
 * `thread_read`: the live transcript through the thread's control, wherever it is held; else its JSONL when its endpoint
 * here is dead. A `limit` above THREAD_READ_MAX_LIMIT is read as that many, and the answer's `reduced.limit` says so.
 */
export async function readThreadWithLimits(
  options: ThreadToolSurfaceOptions,
  current: ThreadHostView,
  value: ThreadReadInput,
  callerId: string,
  signal?: AbortSignal,
): Promise<ThreadToolResult> {
  if (value.limit !== undefined && value.cursor !== undefined)
    return failure(
      "invalid_arguments",
      "limit sets the window of a first read, and a cursor continues an earlier window. Nothing was done.",
      `Follow the cursor without limit: tool.thread_read(${JSON.stringify({ thread: value.thread, cursor: value.cursor })}).`,
    )
  const clamped = value.limit !== undefined && value.limit > THREAD_READ_MAX_LIMIT
  const result = await readThread(
    options,
    current,
    clamped ? { ...value, limit: THREAD_READ_MAX_LIMIT } : value,
    callerId,
    signal,
  )
  if (result.kind !== "ok" || !("items" in result)) return result
  return {
    ...result,
    ...(clamped ? { reduced: { limit: { requested: value.limit as number, used: THREAD_READ_MAX_LIMIT } } } : {}),
    ...(value.wait_ms === 0 ? { wait: { outcome: "not_waited", status: "wait_ms_zero", waited_ms: 0 } } : {}),
  }
}

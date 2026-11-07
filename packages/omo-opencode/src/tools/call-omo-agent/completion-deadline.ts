import * as timers from "node:timers"

export const COMPLETION_TIMEOUT_MS = 5 * 60 * 1000

export async function withCompletionDeadline<T>(
  parentAbort: AbortSignal,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (parentAbort.aborted) throw new Error("Task aborted.")

  const controller = new AbortController()
  let rejectCancellation!: (error: Error) => void
  const cancellation = new Promise<never>((_, reject) => { rejectCancellation = reject })
  const cancel = (message: string) => {
    const error = new Error(message)
    controller.abort(error)
    rejectCancellation(error)
  }
  const onParentAbort = () => cancel("Task aborted.")
  parentAbort.addEventListener("abort", onParentAbort, { once: true })
  const timer = timers.setTimeout(() => cancel("Agent task timed out after 5 minutes."), COMPLETION_TIMEOUT_MS)

  try {
    const value = await Promise.race([operation(controller.signal), cancellation])
    controller.signal.throwIfAborted()
    return value
  } finally {
    timers.clearTimeout(timer)
    parentAbort.removeEventListener("abort", onParentAbort)
  }
}

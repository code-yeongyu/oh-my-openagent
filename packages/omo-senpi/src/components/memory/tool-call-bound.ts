import type { MemoryWriteStage } from "@oh-my-opencode/memory-core"

/**
 * Whole-call budget for one memory write. Every git step already has its own deadline (the commit's is 120 s), so this
 * only fires when something below git never settles, e.g. filesystem calls parked on a wedged mount.
 */
export const MEMORY_CALL_TIMEOUT_MS = 180_000

export type MemoryCallStage = "prepare" | MemoryWriteStage | "report"

const STAGE_TEXT: Record<MemoryCallStage, string> = {
  prepare: "preparing the memory repository",
  lock: "waiting for the memory writer lock",
  check: "checking the memory repository state",
  apply: "editing the memory file",
  commit: "committing to git",
  report: "reporting the write",
}

/** `stopped` turns true, before the caller hears of it, once the call has answered with a timeout or a cancellation. */
export interface MemoryCallState {
  readonly stopped: boolean
}

const LATE_WRITE_NOTE =
  "If the write finishes later it still commits, so check the memory repository's git log before retrying."

export type BoundedCall<T> =
  | { readonly kind: "settled"; readonly value: T }
  | { readonly kind: "failed"; readonly error: unknown }
  | { readonly kind: "stopped"; readonly message: string }

/**
 * Starts `start` unless `signal` already aborted, then waits until it settles, `signal` aborts, or `timeoutMs` passes.
 * Work that is stopped keeps running in the background (a write cannot be undone halfway); its result is dropped, and
 * it reads `state.stopped` to skip anything that would present it as a normal outcome.
 */
export async function boundMemoryCall<T>(
  start: (state: MemoryCallState) => Promise<T>,
  options: {
    readonly command: string
    readonly stage: () => MemoryCallStage
    readonly timeoutMs: number
    readonly signal?: AbortSignal
  },
): Promise<BoundedCall<T>> {
  const { command, stage, timeoutMs, signal } = options
  if (signal?.aborted === true) return { kind: "stopped", message: cancelledMessage(command, stage()) }
  const state = { stopped: false }
  const work = start(state)
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const stopped = new Promise<BoundedCall<T>>((resolve) => {
    const stop = (message: string) => {
      state.stopped = true
      resolve({ kind: "stopped", message })
    }
    timer = setTimeout(
      () =>
        stop(
          `memory: ${command} did not finish within ${formatSeconds(timeoutMs)} (stopped while ${STAGE_TEXT[stage()]}). ${LATE_WRITE_NOTE}`,
        ),
      timeoutMs,
    )
    onAbort = () => stop(cancelledMessage(command, stage()))
    signal?.addEventListener("abort", onAbort, { once: true })
  })
  try {
    const outcome = await Promise.race([
      work.then(
        (value): BoundedCall<T> => ({ kind: "settled", value }),
        (error: unknown): BoundedCall<T> => ({ kind: "failed", error }),
      ),
      stopped,
    ])
    if (outcome.kind === "stopped") work.catch(() => {})
    return outcome
  } finally {
    clearTimeout(timer)
    if (onAbort !== undefined) signal?.removeEventListener("abort", onAbort)
  }
}

function cancelledMessage(command: string, stage: MemoryCallStage): string {
  return `memory: ${command} was cancelled while ${STAGE_TEXT[stage]}. ${LATE_WRITE_NOTE}`
}

function formatSeconds(ms: number): string {
  return `${Math.round(ms / 100) / 10}s`
}

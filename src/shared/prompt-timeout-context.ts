export interface PromptTimeoutArgs {
  signal?: AbortSignal
}

export interface PromptRetryOptions {
  timeoutMs?: number
}

export const PROMPT_TIMEOUT_MS = 120000

export function createPromptTimeoutContext(args: PromptTimeoutArgs, timeoutMs: number): {
  signal: AbortSignal
  wasTimedOut: () => boolean
  cleanup: () => void
} {
  const timeoutController = new AbortController()
  let timeoutID: ReturnType<typeof setTimeout> | null = null
  let timedOut = false

  const abortOnUpstreamSignal = (): void => {
    timeoutController.abort(args.signal?.reason)
  }

  if (args.signal) {
    if (args.signal.aborted) {
      timeoutController.abort(args.signal.reason)
    } else {
      args.signal.addEventListener("abort", abortOnUpstreamSignal, { once: true })
    }
  }

  timeoutID = setTimeout(() => {
    timedOut = true
    timeoutController.abort(new Error(`prompt timed out after ${timeoutMs}ms`))
  }, timeoutMs)

  return {
    signal: timeoutController.signal,
    wasTimedOut: () => timedOut,
    cleanup: () => {
      if (timeoutID !== null) {
        clearTimeout(timeoutID)
      }
      if (args.signal) {
        args.signal.removeEventListener("abort", abortOnUpstreamSignal)
      }
    },
  }
}

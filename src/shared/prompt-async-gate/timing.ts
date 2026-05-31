export const DEFAULT_PROMPT_ASYNC_POST_DISPATCH_HOLD_MS = 2_000
export const DEFAULT_PROMPT_SEMANTIC_DEDUPE_HOLD_MS = 15_000
export const DEFAULT_PROMPT_DISPATCH_TIMEOUT_MS = 30_000
export const DEFAULT_PROMPT_GATE_MESSAGES_FETCH_TIMEOUT_MS = 5_000
export const DEFAULT_PROMPT_QUEUE_RETRY_MS = 250

declare function setTimeout(callback: () => void, delay?: number): unknown
declare function clearTimeout(timeout: unknown): void

let promptGateMessagesFetchTimeoutMsForTesting: number | undefined

export function _setPromptGateMessagesFetchTimeoutMsForTesting(value: number | undefined): void {
  promptGateMessagesFetchTimeoutMsForTesting = value
}

export function getPromptGateMessagesFetchTimeoutMs(): number {
  return promptGateMessagesFetchTimeoutMsForTesting ?? DEFAULT_PROMPT_GATE_MESSAGES_FETCH_TIMEOUT_MS
}

export function resetPromptGateTimingForTesting(): void {
  promptGateMessagesFetchTimeoutMsForTesting = undefined
}

export async function withDispatchTimeout<T>(
  operation: Promise<T>,
  dispatchTimeoutMs: number,
  operationName: string,
): Promise<T> {
  if (dispatchTimeoutMs <= 0) {
    return operation
  }

  let timeoutID: unknown
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutID = setTimeout(() => {
      reject(new Error(`${operationName} timed out after ${dispatchTimeoutMs}ms`))
    }, dispatchTimeoutMs)
  })

  try {
    return await Promise.race([operation, timeoutPromise])
  } finally {
    if (timeoutID !== undefined) {
      clearTimeout(timeoutID)
    }
  }
}

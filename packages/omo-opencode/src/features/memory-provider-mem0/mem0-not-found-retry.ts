import type { Mem0RateLimiter } from "./rate-limiter"
import { isNotFoundError } from "./response-helpers"

export async function retryMem0NotFound<T>(
  rateLimiter: Pick<Mem0RateLimiter, "executeWithRetry">,
  operation: () => Promise<T>,
  opName: string,
): Promise<T> {
  const backoffsMs = [1000, 3000, 7000, 15000]
  let lastError: unknown

  for (let attempt = 0; attempt <= backoffsMs.length; attempt++) {
    try {
      return await rateLimiter.executeWithRetry(operation, opName)
    } catch (error) {
      lastError = error
      if (!isNotFoundError(error)) {
        throw error
      }

      if (attempt < backoffsMs.length) {
        await new Promise<void>(resolve => setTimeout(resolve, backoffsMs[attempt]))
      }
    }
  }

  throw lastError
}

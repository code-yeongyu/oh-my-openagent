export type RetryOptions = {
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
  jitterFactor: number
}

const DEFAULT_RETRY: RetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  jitterFactor: 0.3,
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const config = { ...DEFAULT_RETRY, ...options }
  let lastError: Error | null = null

  for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))

      if (attempt === config.maxAttempts - 1) break

      const delay = calculateBackoff(attempt, config)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  throw lastError!
}

function calculateBackoff(attempt: number, config: RetryOptions): number {
  const exponential = config.baseDelayMs * Math.pow(2, attempt)
  const capped = Math.min(exponential, config.maxDelayMs)
  const jitter = capped * config.jitterFactor * (Math.random() - 0.5) * 2
  return Math.max(0, capped + jitter)
}

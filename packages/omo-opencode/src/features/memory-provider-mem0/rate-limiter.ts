export interface RateLimitInfo {
  limit: number
  remaining: number
  resetAt?: Date
}

export class Mem0RateLimitError extends Error {
  constructor(
    public readonly retryAfterMs: number,
    public readonly endpoint: string,
  ) {
    super(`Mem0 rate limit exceeded on ${endpoint}. Retry after ${retryAfterMs}ms`)
    this.name = "Mem0RateLimitError"
  }
}

export interface RateLimiterConfig {
  maxRetries: number
  initialBackoffMs: number
  maxBackoffMs: number
  jitterFactor: number
}

export const DEFAULT_RATE_LIMITER_CONFIG: RateLimiterConfig = {
  maxRetries: 3,
  initialBackoffMs: 1000,
  maxBackoffMs: 32_000,
  jitterFactor: 0.3,
}

export class Mem0RateLimiter {
  private readonly config: RateLimiterConfig

  constructor(config: Partial<RateLimiterConfig> = {}) {
    this.config = { ...DEFAULT_RATE_LIMITER_CONFIG, ...config }
  }

  async executeWithRetry<T>(operation: () => Promise<T>, endpoint: string): Promise<T> {
    let attempt = 0

    while (attempt <= this.config.maxRetries) {
      try {
        return await operation()
      } catch (error) {
        if (!this.isRateLimitError(error)) {
          throw error
        }

        attempt++
        if (attempt > this.config.maxRetries) {
          throw new Mem0RateLimitError(this.extractRetryAfterMs(error), endpoint)
        }

        const waitMs = this.calculateBackoff(attempt, error)
        await this.sleep(waitMs)
      }
    }

    throw new Mem0RateLimitError(0, endpoint)
  }

  private isRateLimitError(error: unknown): boolean {
    const statusCode = this.readNumericProperty(error, "statusCode")
      ?? this.readNumericProperty(error, "status")
      ?? this.readNestedNumericProperty(error, ["response", "status"])

    if (statusCode === 429) {
      return true
    }

    if (error instanceof Error) {
      const message = error.message.toLowerCase()
      return message.includes("429") || message.includes("rate limit") || message.includes("too many requests")
    }

    return false
  }

  private extractRetryAfterMs(error: unknown): number {
    const retryAfterHeader = this.readHeader(error, "retry-after")
    if (retryAfterHeader) {
      const parsed = this.parseRetryAfterHeader(retryAfterHeader)
      if (parsed !== undefined) {
        return parsed
      }
    }

    if (error instanceof Error) {
      const match = error.message.match(/retry.?after[:\s]+(\d+)/i)
      if (match) {
        return Number.parseInt(match[1] ?? "0", 10) * 1000
      }
    }

    return 0
  }

  private calculateBackoff(attempt: number, error: unknown): number {
    const retryAfterMs = this.extractRetryAfterMs(error)
    if (retryAfterMs > 0) {
      return retryAfterMs
    }

    const rateLimitInfo = this.extractRateLimitInfo(error)
    if (rateLimitInfo?.resetAt) {
      const resetDelayMs = rateLimitInfo.resetAt.getTime() - Date.now()
      if (resetDelayMs > 0) {
        return resetDelayMs
      }
    }

    const exponential = Math.min(this.config.initialBackoffMs * 2 ** (attempt - 1), this.config.maxBackoffMs)
    const jitter = exponential * this.config.jitterFactor * (Math.random() * 2 - 1)
    return Math.max(0, Math.round(exponential + jitter))
  }

  private extractRateLimitInfo(error: unknown): RateLimitInfo | undefined {
    const limit = this.parseHeaderNumber(this.readHeader(error, "x-ratelimit-limit"))
    const remaining = this.parseHeaderNumber(this.readHeader(error, "x-ratelimit-remaining"))

    if (limit === undefined || remaining === undefined) {
      return undefined
    }

    const resetSeconds = this.parseHeaderNumber(this.readHeader(error, "x-ratelimit-reset"))
    const resetAt = resetSeconds === undefined ? undefined : new Date(resetSeconds * 1000)

    return {
      limit,
      remaining,
      resetAt,
    }
  }

  private readHeader(error: unknown, name: string): string | undefined {
    const direct = this.lookupHeaderValue(this.readRecord(error), name)
    if (direct) {
      return direct
    }

    const response = this.readNestedRecord(error, ["response"])
    if (response) {
      const value = this.lookupHeaderValue(response, name)
      if (value) {
        return value
      }

      const headers = this.readNestedRecord(response, ["headers"])
      return this.lookupHeaderValue(headers, name)
    }

    return undefined
  }

  private lookupHeaderValue(headers: Record<string, unknown> | undefined, name: string): string | undefined {
    if (!headers) {
      return undefined
    }

    const direct = headers[name]
    if (typeof direct === "string") {
      return direct
    }

    const lowerKey = Object.keys(headers).find(key => key.toLowerCase() === name.toLowerCase())
    if (!lowerKey) {
      return undefined
    }

    const matchedValue = headers[lowerKey]
    return typeof matchedValue === "string" ? matchedValue : undefined
  }

  private parseRetryAfterHeader(value: string): number | undefined {
    const seconds = Number.parseInt(value, 10)
    if (Number.isFinite(seconds)) {
      return Math.max(0, seconds * 1000)
    }

    const parsedDate = Date.parse(value)
    if (Number.isNaN(parsedDate)) {
      return undefined
    }

    return Math.max(0, parsedDate - Date.now())
  }

  private parseHeaderNumber(value: string | undefined): number | undefined {
    if (!value) {
      return undefined
    }

    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  private readNumericProperty(source: unknown, key: string): number | undefined {
    const record = this.readRecord(source)
    const value = record?.[key]
    return typeof value === "number" ? value : undefined
  }

  private readNestedNumericProperty(source: unknown, path: string[]): number | undefined {
    const record = this.readNestedRecord(source, path)
    return typeof record === "number" ? record : undefined
  }

  private readNestedRecord(source: unknown, path: string[]): Record<string, unknown> | undefined {
    let current: unknown = source

    for (const key of path) {
      const record = this.readRecord(current)
      if (!record) {
        return undefined
      }

      current = record[key]
    }

    return this.readRecord(current)
  }

  private readRecord(value: unknown): Record<string, unknown> | undefined {
    if (typeof value !== "object" || value === null) {
      return undefined
    }

    return value as Record<string, unknown>
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

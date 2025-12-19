import type { RetryConfig, RetryResult } from "./types";
import { log } from "../../shared";

const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffFactor: 2,
  jitterFactor: 0.1,
  retryableErrors: [
    "timeout",
    "ETIMEDOUT",
    "ECONNRESET",
    "ECONNREFUSED",
    "rate_limit",
    "rate limit",
    "429",
    "503",
    "service_unavailable",
    "temporarily unavailable",
  ],
};

const NON_RETRYABLE_ERRORS = [
  "auth_error",
  "authentication",
  "unauthorized",
  "401",
  "403",
  "invalid_input",
  "validation",
  "permission_denied",
  "not_found",
  "404",
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateDelay(attempt: number, config: RetryConfig): number {
  const baseDelay = config.initialDelayMs * Math.pow(config.backoffFactor, attempt - 1);
  const cappedDelay = Math.min(baseDelay, config.maxDelayMs);
  
  const jitter = cappedDelay * config.jitterFactor * (Math.random() * 2 - 1);
  
  return Math.max(0, Math.round(cappedDelay + jitter));
}

function isRetryableError(error: Error | string, config: RetryConfig): boolean {
  const errorString = typeof error === "string" ? error.toLowerCase() : error.message.toLowerCase();

  for (const pattern of NON_RETRYABLE_ERRORS) {
    if (errorString.includes(pattern.toLowerCase())) {
      return false;
    }
  }

  for (const pattern of config.retryableErrors) {
    if (errorString.includes(pattern.toLowerCase())) {
      return true;
    }
  }

  return false;
}

export class RetryMiddleware {
  private config: RetryConfig;

  constructor(config?: Partial<RetryConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async executeWithRetry<T>(
    fn: () => Promise<T>,
    operationName?: string
  ): Promise<RetryResult<T>> {
    let lastError: Error | undefined;
    let totalDelayMs = 0;
    const name = operationName || "operation";

    for (let attempt = 1; attempt <= this.config.maxRetries + 1; attempt++) {
      try {
        const result = await fn();
        
        if (attempt > 1) {
          log(`[RetryMiddleware] ${name} succeeded on attempt ${attempt}`);
        }
        
        return {
          success: true,
          result,
          attempts: attempt,
          totalDelayMs,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt > this.config.maxRetries) {
          log(`[RetryMiddleware] ${name} failed after ${attempt} attempts: ${lastError.message}`);
          break;
        }

        if (!isRetryableError(lastError, this.config)) {
          log(`[RetryMiddleware] ${name} failed with non-retryable error: ${lastError.message}`);
          break;
        }

        const delayMs = calculateDelay(attempt, this.config);
        totalDelayMs += delayMs;

        log(`[RetryMiddleware] ${name} attempt ${attempt} failed, retrying in ${delayMs}ms: ${lastError.message}`);
        
        await sleep(delayMs);
      }
    }

    return {
      success: false,
      attempts: this.config.maxRetries + 1,
      totalDelayMs,
      lastError,
    };
  }

  updateConfig(config: Partial<RetryConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): RetryConfig {
    return { ...this.config };
  }
}

export { isRetryableError, calculateDelay, sleep };

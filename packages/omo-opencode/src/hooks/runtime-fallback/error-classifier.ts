import {
  classifyRuntimeFallbackError,
  extractRuntimeFallbackAutoRetrySignal,
  getRuntimeFallbackErrorMessage,
  getRuntimeFallbackErrorName,
  getRuntimeFallbackRetryableSignal,
  getRuntimeFallbackStatusCode,
  isRuntimeFallbackRetryableError,
} from "@oh-my-opencode/model-core"
import { HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"

export const extractAutoRetrySignal = extractRuntimeFallbackAutoRetrySignal
export const getErrorMessage = getRuntimeFallbackErrorMessage
export const extractStatusCode = getRuntimeFallbackStatusCode
export const extractErrorName = getRuntimeFallbackErrorName
export const extractRetryableSignal = getRuntimeFallbackRetryableSignal

export function classifyErrorType(error: unknown): string | undefined {
  const baseType = classifyRuntimeFallbackError(error)
  if (baseType) return baseType

  const message = getErrorMessage(error)
  const errorName = extractErrorName(error)?.toLowerCase()?.replace(/[_-]/g, "")

  if (
    errorName?.includes("emptyoutput") ||
    /empty\s*output/i.test(message) ||
    /no\s*text\s*output/i.test(message) ||
    /no\s*content/i.test(message)
  ) {
    return "empty_output"
  }

  return undefined
}

export function containsErrorContent(
  parts: Array<{ type?: string; text?: string }> | undefined
): { hasError: boolean; errorMessage?: string } {
  if (!parts || parts.length === 0) return { hasError: false }

  const errorParts = parts.filter((p) => p.type === "error")
  if (errorParts.length > 0) {
    const errorMessages = errorParts.map((p) => p.text).filter((text): text is string => typeof text === "string")
    const errorMessage = errorMessages.length > 0 ? errorMessages.join("\n") : undefined
    return { hasError: true, errorMessage }
  }

  return { hasError: false }
}

export function isRetryableError(error: unknown, retryOnErrors: number[]): boolean {
  if (classifyErrorType(error) === "empty_output") {
    return true
  }

  return isRuntimeFallbackRetryableError(error, retryOnErrors, {
    onUnsafeRetryableSignalRejected: ({ statusCode, retryOnErrors }) => {
      log(`[${HOOK_NAME}] Retryable signal rejected due to unsafe status code`, {
        statusCode,
        retryOnErrors,
      })
    },
  })
}

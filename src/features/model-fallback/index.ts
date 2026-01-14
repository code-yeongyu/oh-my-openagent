import { log } from "../../shared/logger"

export interface ModelSpec {
  providerID: string
  modelID: string
  variant?: string
}

export function parseModelString(model: string): ModelSpec | undefined {
  const parts = model.split("/")
  if (parts.length >= 2) {
    const providerID = parts[0].trim()
    const modelID = parts.slice(1).join("/").trim()
    if (providerID.length === 0 || modelID.length === 0) {
      return undefined
    }
    return { providerID, modelID }
  }
  return undefined
}

export function modelSpecToString(spec: ModelSpec): string {
  return `${spec.providerID}/${spec.modelID}`
}

export function buildModelChain(primary: string, fallback?: string[]): ModelSpec[] {
  const chain: ModelSpec[] = []
  const primarySpec = parseModelString(primary)
  if (primarySpec) chain.push(primarySpec)
  if (fallback) {
    for (const fb of fallback) {
      const spec = parseModelString(fb)
      if (spec) chain.push(spec)
    }
  }
  return chain
}

export function isModelError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const msg = error.message.toLowerCase()
  return (
    msg.includes("rate limit") ||
    msg.includes("rate_limit") ||
    msg.includes("429") ||
    msg.includes("503") ||
    msg.includes("502") ||
    msg.includes("unavailable") ||
    msg.includes("overloaded") ||
    msg.includes("capacity") ||
    msg.includes("timeout") ||
    msg.includes("econnrefused") ||
    msg.includes("enotfound")
  )
}

export interface RetryResult<T> {
  success: boolean
  result?: T
  usedModel?: ModelSpec
  attempts: number
  errors: Array<{ model: string; error: string }>
}

export interface RetryConfig {
  delayMs?: number
  maxAttempts?: number
}

export async function withModelFallback<T>(
  modelChain: ModelSpec[],
  operation: (model: ModelSpec) => Promise<T>,
  options?: { retryConfig?: RetryConfig; logPrefix?: string }
): Promise<RetryResult<T>> {
  const maxAttempts = Math.max(1, options?.retryConfig?.maxAttempts ?? modelChain.length)
  const delayMs = options?.retryConfig?.delayMs ?? 1000
  const prefix = options?.logPrefix ?? "[model-fallback]"
  const errors: Array<{ model: string; error: string }> = []

  if (modelChain.length === 0) {
    return { success: false, attempts: 0, errors: [{ model: "none", error: "No models configured" }] }
  }
  if (modelChain.length < maxAttempts) {
    log(`${prefix} Warning: maxAttempts (${maxAttempts}) exceeds available models (${modelChain.length})`, { level: "warn" })
  }

  for (let i = 0; i < Math.min(maxAttempts, modelChain.length); i++) {
    const model = modelChain[i]
    const modelStr = modelSpecToString(model)

    try {
      if (i > 0) {
        log(`${prefix} Trying fallback model: ${modelStr}`, { attempt: i + 1, maxAttempts })
      }
      const result = await operation(model)
      if (i > 0) {
        log(`${prefix} Fallback succeeded: ${modelStr}`, { attempt: i + 1 })
      }
      return { success: true, result, usedModel: model, attempts: i + 1, errors }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      errors.push({ model: modelStr, error: errorMsg })
      log(`${prefix} Model ${modelStr} failed: ${errorMsg}`, { attempt: i + 1 })

      const shouldRetry = isModelError(error) && i < Math.min(maxAttempts, modelChain.length) - 1
      if (!shouldRetry) {
        return { success: false, usedModel: model, attempts: i + 1, errors }
      }

      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }

  return { success: false, attempts: Math.min(maxAttempts, modelChain.length), errors }
}

export function formatRetryErrors(errors: Array<{ model: string; error: string }>): string {
  if (errors.length === 0) return "No errors"
  if (errors.length === 1) return `${errors[0].model}: ${errors[0].error}`
  return errors.map((e, i) => `  ${i + 1}. ${e.model}: ${e.error}`).join("\n")
}

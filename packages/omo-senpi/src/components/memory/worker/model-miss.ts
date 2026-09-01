import { isRetryableModelError } from "@oh-my-opencode/model-core"

export type ModelMissResult = {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
}

export type RetryableModelMiss =
  | { readonly kind: "model_not_visible"; readonly id: string }
  | { readonly kind: "auth_missing"; readonly provider: string }
  | { readonly kind: "provider_unavailable"; readonly detail: string }

const MODEL_NOT_FOUND_PATTERN = /^Error: Model "([^"]+)" not found\. Use --list-models to see available models\.$/m
const API_KEY_NOT_FOUND_PATTERN = /^(?:Error:\s*)?No API key found for\s+([^\s.]+)/m
const HTTP_STATUS_PATTERN = /(?:^|\s)(\d{3})\s*:/
const PROVIDER_DETAIL_MAX_CHARS = 200

export function classifyRetryableModelMiss(result: ModelMissResult): RetryableModelMiss | undefined {
  if (result.timedOut || result.code === 0) return undefined
  const output = `${result.stderr}\n${result.stdout}`
  const model = MODEL_NOT_FOUND_PATTERN.exec(output)?.[1]
  if (model !== undefined) return { kind: "model_not_visible", id: model }
  const provider = API_KEY_NOT_FOUND_PATTERN.exec(output)?.[1]
  if (provider !== undefined) return { kind: "auth_missing", provider }
  // A provider-side outage (cooldown, 429/503, overload) says nothing about THIS model being wrong,
  // so the reflection chain must move to the next candidate instead of recording a dead run. The
  // shared classifier owns the pattern table, including the billing/quota STOP cases that another
  // model cannot fix - those stay non-retryable so a burnt budget never burns the whole chain.
  const detail = providerFailureDetail(result)
  if (detail === undefined) return undefined
  const statusCode = Number.parseInt(HTTP_STATUS_PATTERN.exec(detail)?.[1] ?? "", 10)
  return isRetryableModelError({
    message: detail,
    ...(Number.isNaN(statusCode) ? {} : { statusCode }),
  })
    ? { kind: "provider_unavailable", detail }
    : undefined
}

/** First meaningful child error line: senpi prints the fatal provider error and exits. */
function providerFailureDetail(result: ModelMissResult): string | undefined {
  for (const stream of [result.stderr, result.stdout]) {
    const line = stream.split("\n").map((entry) => entry.trim()).find((entry) => entry.length > 0)
    if (line !== undefined) return line.slice(0, PROVIDER_DETAIL_MAX_CHARS)
  }
  return undefined
}

export function isRetryableModelMiss(result: ModelMissResult): boolean {
  return classifyRetryableModelMiss(result) !== undefined
}

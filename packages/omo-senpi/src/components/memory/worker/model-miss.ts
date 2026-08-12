export type ModelMissResult = {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
}

export type RetryableModelMiss =
  | { readonly kind: "model_not_visible"; readonly id: string }
  | { readonly kind: "auth_missing"; readonly provider: string }

const MODEL_NOT_FOUND_PATTERN = /^Error: Model "([^"]+)" not found\. Use --list-models to see available models\.$/m
const API_KEY_NOT_FOUND_PATTERN = /^(?:Error:\s*)?No API key found for\s+([^\s.]+)/m

export function classifyRetryableModelMiss(result: ModelMissResult): RetryableModelMiss | undefined {
  if (result.timedOut || result.code === 0) return undefined
  const output = `${result.stderr}\n${result.stdout}`
  const model = MODEL_NOT_FOUND_PATTERN.exec(output)?.[1]
  if (model !== undefined) return { kind: "model_not_visible", id: model }
  const provider = API_KEY_NOT_FOUND_PATTERN.exec(output)?.[1]
  if (provider !== undefined) return { kind: "auth_missing", provider }
  return undefined
}

export function isRetryableModelMiss(result: ModelMissResult): boolean {
  return classifyRetryableModelMiss(result) !== undefined
}

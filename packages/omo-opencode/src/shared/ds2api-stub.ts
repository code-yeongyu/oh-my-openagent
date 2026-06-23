// PORT-TODO(ds2api): full ds2api-client module deferred. Stub provides type-safe no-op for solve-captcha-handler.
// Returns enabled=false so Capsolver/AntiCaptcha branches dispatch normally.

export type ResolveDs2apiConfigOptions = {
  readonly apiKeyEnvVar?: string
  readonly baseUrlEnvVar?: string
  readonly fallbackApiKey?: string
  readonly fallbackBaseUrl?: string
}

export type ResolveDs2apiConfigResult = {
  readonly apiKey: string | undefined
  readonly baseUrl: string | undefined
  readonly proxyKey: string | undefined
  readonly adminKey: string | undefined
  readonly visionModel: string | undefined
  readonly enabled: boolean
}

export function resolveDs2apiConfig(_options?: ResolveDs2apiConfigOptions): ResolveDs2apiConfigResult {
  return {
    apiKey: undefined,
    baseUrl: undefined,
    proxyKey: undefined,
    adminKey: undefined,
    visionModel: undefined,
    enabled: false,
  }
}

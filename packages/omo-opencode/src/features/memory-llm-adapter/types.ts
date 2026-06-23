export type ClaudeMemLlmAdapterConfig = {
  host: string
  port: number
  endpoint: string
  apiKey: string
  primaryModel: string
  fallbackModel: string
  requestTimeoutMs: number
  authToken?: string
  providerOverride?: Record<string, unknown>
}

export type ClaudeMemLlmAdapterFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

export type ClaudeMemLlmAdapterDeps = {
  config: ClaudeMemLlmAdapterConfig
  fetchImpl: ClaudeMemLlmAdapterFetch
}

export type OpenAiChatCompletionRequest = {
  model?: string
  messages: Array<{ role: string; content: string }>
  temperature?: number
  max_tokens?: number
  stream?: boolean
}

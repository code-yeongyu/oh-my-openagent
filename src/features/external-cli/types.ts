import type { ExternalCliProvider } from "../../config/schema"

export interface ExternalCliExecuteOptions {
  model: string
  prompt: string
  workspace?: string
  timeout?: number
}

export interface ExternalCliExecuteResult {
  success: boolean
  result: string
  error?: string
  duration_ms?: number
  session_id?: string
}

export interface ExternalCliProviderInterface {
  readonly name: ExternalCliProvider
  execute(options: ExternalCliExecuteOptions): Promise<ExternalCliExecuteResult>
  isAvailable(): Promise<boolean>
}

export interface ExternalCliBackendConfig {
  enabled: boolean
  provider: ExternalCliProvider
  models?: Record<string, string>
  default_model: string
  workspace?: string
  timeout: number
}

export interface CursorAgentResponse {
  type: string
  subtype: string
  is_error: boolean
  duration_ms: number
  duration_api_ms: number
  result: string
  session_id: string
  request_id: string
}

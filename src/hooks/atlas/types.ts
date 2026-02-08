import type { BackgroundManager } from "../../features/background-agent"

export type ModelInfo = { providerID: string; modelID: string }

export interface AtlasHookOptions {
  directory: string
  backgroundManager?: BackgroundManager
  isContinuationStopped?: (sessionID: string) => boolean
}

export interface ToolExecuteAfterInput {
  tool: string
  sessionID?: string
  callID?: string
}

export interface ToolExecuteAfterOutput {
  title: string
  output: string
  metadata: Record<string, unknown>
}

export interface SessionState {
  lastEventWasAbortError?: boolean
  lastContinuationInjectedAt?: number
  promptFailureCount: number
}

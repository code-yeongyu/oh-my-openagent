import type { ExperimentalConfig } from "../../config"

export interface MessageInfo {
  id?: string
  role?: string
  sessionID?: string
  parentID?: string
  error?: unknown
}

export interface SessionRecoveryOptions {
  experimental?: ExperimentalConfig
}

export interface SessionRecoveryHook {
  handleSessionRecovery: (info: MessageInfo) => Promise<boolean>
  handleInterruptedToolResultsOnIdle: (sessionID: string) => Promise<boolean>
  isRecoverableError: (error: unknown) => boolean
  setOnAbortCallback: (callback: (sessionID: string) => void) => void
  setOnRecoveryCompleteCallback: (callback: (sessionID: string) => void) => void
}

export interface SessionRecoveryCallbacks {
  onAbortCallback: ((sessionID: string) => void) | null
  onRecoveryCompleteCallback: ((sessionID: string) => void) | null
}

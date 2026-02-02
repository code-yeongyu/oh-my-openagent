import type { PluginInput } from "@opencode-ai/plugin"
import type { BackgroundTask, LaunchInput } from "./types"

export const TASK_TTL_MS = 30 * 60 * 1000
export const MIN_STABILITY_TIME_MS = 10 * 1000
export const DEFAULT_STALE_TIMEOUT_MS = 180_000
export const MIN_RUNTIME_BEFORE_STALE_MS = 30_000
export const MIN_IDLE_TIME_MS = 5000
export const POLLING_INTERVAL_MS = 3000
export const TASK_CLEANUP_DELAY_MS = 10 * 60 * 1000
export const TMUX_CALLBACK_DELAY_MS = 200

export type ProcessCleanupEvent = NodeJS.Signals | "beforeExit" | "exit"

export type OpencodeClient = PluginInput["client"]

export interface MessagePartInfo {
  sessionID?: string
  type?: string
  tool?: string
}

export interface EventProperties {
  sessionID?: string
  info?: { id?: string }
  [key: string]: unknown
}

export interface BackgroundEvent {
  type: string
  properties?: EventProperties
}

export interface Todo {
  content: string
  status: string
  priority: string
  id: string
}

export interface QueueItem {
  task: BackgroundTask
  input: LaunchInput
}

export interface SubagentSessionCreatedEvent {
  sessionID: string
  parentID: string
  title: string
}

export type OnSubagentSessionCreated = (event: SubagentSessionCreatedEvent) => Promise<void>

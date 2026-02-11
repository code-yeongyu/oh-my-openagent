import type { McbToolAvailability } from "./types"

export interface QueuedMcbOperation {
  id: string
  tool: keyof McbToolAvailability
  action: string
  params: Record<string, unknown>
  queuedAt: number
  retryCount: number
  maxRetries: number
  source: string
  sessionId?: string
}

export interface SyncQueueConfig {
  maxEntries: number
  maxAgeMs: number
  queueDir: string
  queueFile: string
}

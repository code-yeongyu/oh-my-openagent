import type { Sandbox } from "opensandbox"

export type ProjectType = "node" | "python"

export interface ProjectConfig {
  type: ProjectType
  rootDir: string
  startCommand?: string
  port?: number
  dependenciesInstalled: boolean
}

export interface FileSyncState {
  lastSync: Map<string, number> // path → mtime
}

export interface PreviewSession {
  sandbox: Sandbox
  config: ProjectConfig
  endpoint: string
  processId?: string
  isWatching: boolean
}

export interface PreviewAgentConfig {
  image: "node:20" | "python:3.11"
  port: number
  domain: string
  watchIntervalMs: number
  autoRenewMinutes: number
}
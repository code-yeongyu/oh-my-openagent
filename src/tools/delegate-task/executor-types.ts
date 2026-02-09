import type { BackgroundManager } from "../../features/background-agent"
import type { CategoriesConfig, GitMasterConfig, BrowserAutomationProvider, AgentOverrides } from "../../config/schema"
import type { OpencodeClient } from "./types"

export interface ExecutorContext {
  manager: BackgroundManager
  client: OpencodeClient
  directory: string
  userCategories?: CategoriesConfig
  gitMasterConfig?: GitMasterConfig
  sisyphusJuniorModel?: string
  browserProvider?: BrowserAutomationProvider
  agentOverrides?: AgentOverrides
  onSyncSessionCreated?: (event: { sessionID: string; parentID: string; title: string }) => Promise<void>
}

export interface ParentContext {
  sessionID: string
  messageID: string
  agent?: string
  model?: { providerID: string; modelID: string; variant?: string }
}

export interface SessionMessage {
  info?: {
    id?: string
    role?: string
    time?: { created?: number }
    finish?: string
    agent?: string
    model?: { providerID: string; modelID: string; variant?: string }
    modelID?: string
    providerID?: string
    variant?: string
  }
  parts?: Array<{ type?: string; text?: string }>
}

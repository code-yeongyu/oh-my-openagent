import type { BackgroundManager } from "../../features/background-agent"
import type { CategoriesConfig, GitMasterConfig, BrowserAutomationProvider } from "../../config/schema"
import type { OpencodeClient } from "./types"

export interface ExecutorContext {
  manager: BackgroundManager
  client: OpencodeClient
  directory: string
  userCategories?: CategoriesConfig
  gitMasterConfig?: GitMasterConfig
  sisyphusJuniorModel?: string
  browserProvider?: BrowserAutomationProvider
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
    role?: string
    time?: { created?: number }
    agent?: string
    model?: { providerID: string; modelID: string }
    modelID?: string
    providerID?: string
  }
  parts?: Array<{ type?: string; text?: string }>
}

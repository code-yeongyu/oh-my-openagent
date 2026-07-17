import type { BackgroundManager } from "../../features/background-agent"
import type { CategoriesConfig, GitMasterConfig, BrowserAutomationProvider, AgentOverrides, SisyphusAgentConfig } from "../../config/schema"
import type { ModelFallbackControllerAccessor } from "../../hooks/model-fallback"
import type { LoadedSkill } from "../../features/opencode-skill-loader/types"
import type { SessionPromptAsyncData, SessionPromptData, SessionStatusData } from "@opencode-ai/sdk"
import type {
  AvailableCategory,
  AvailableSkill,
} from "../../agents/dynamic-agent-prompt-builder"

type SessionPathInput = { readonly path: { readonly id: string } }
type SessionMessagesQuery = { readonly directory?: string; readonly limit?: number }
type SessionPromptInput = Omit<SessionPromptData | SessionPromptAsyncData, "url"> & {
  readonly signal?: AbortSignal | null
  readonly [key: string]: unknown
}
type SessionStatusInput = Omit<SessionStatusData, "url">

type SessionCreateResult =
  | { readonly data: { readonly id: string }; readonly error?: undefined }
  | { readonly data?: undefined; readonly error: unknown }

type SessionGetResult = {
  readonly data?: { readonly directory?: string }
  readonly error?: unknown
}

export interface OmoAgentClient {
  readonly app: {
    readonly agents: () => Promise<unknown>
  }
  readonly config: {
    readonly get: () => Promise<unknown>
  }
  readonly model?: {
    readonly list?: () => Promise<unknown>
  }
  readonly session: {
    readonly abort: (input: SessionPathInput) => Promise<unknown>
    readonly create: (input: {
      readonly body: Record<string, unknown>
      readonly query?: { readonly directory?: string }
    }) => Promise<SessionCreateResult>
    readonly get: (input: SessionPathInput) => Promise<SessionGetResult>
    readonly messages: (input: SessionPathInput | (SessionPathInput & { readonly query?: SessionMessagesQuery })) => Promise<unknown>
    readonly prompt?: (input: SessionPromptInput) => Promise<unknown>
    readonly promptAsync?: (input: SessionPromptInput) => Promise<unknown>
    readonly status: (input?: SessionStatusInput) => Promise<unknown>
  }
}

export type OpencodeClient = OmoAgentClient

export interface DelegateTaskArgs {
  description: string
  descriptionSource?: "explicit" | "generated"
  prompt: string
  category?: string
  subagent_type?: string
  requested_subagent_type?: string
  run_in_background: boolean
  task_id?: string
  command?: string
  load_skills: string[]
}

export interface ToolContextWithMetadata {
  sessionID: string
  messageID: string
  agent: string
  abort: AbortSignal
  metadata?: (input: { title?: string; metadata?: Record<string, unknown> }) => void | Promise<void>
  /**
   * Tool call ID injected by OpenCode's internal context (not in plugin ToolContext type,
   * but present at runtime via spread in fromPlugin()). Used for metadata store keying.
   */
  callID?: string
  /** @deprecated OpenCode internal naming may vary across versions */
  callId?: string
  /** @deprecated OpenCode internal naming may vary across versions */
  call_id?: string
}

export interface SyncSessionCreatedEvent {
  sessionID: string
  parentID: string
  title: string
}

export interface DelegateTaskToolOptions {
  manager: BackgroundManager
  client: OpencodeClient
  directory: string
  /**
   * Test hook: bypass global cache reads (Bun runs tests in parallel).
   * If provided, resolveCategoryExecution/resolveSubagentExecution uses this instead of reading from disk cache.
   */
  connectedProvidersOverride?: string[] | null
  /**
   * Test hook: bypass fetchAvailableModels() by providing an explicit available model set.
   */
  availableModelsOverride?: Set<string>
  userCategories?: CategoriesConfig
  gitMasterConfig?: GitMasterConfig
  sisyphusJuniorModel?: string
  browserProvider?: BrowserAutomationProvider
  disabledSkills?: Set<string>
  teamModeEnabled?: boolean
  availableCategories?: AvailableCategory[]
  availableSkills?: AvailableSkill[]
  agentOverrides?: AgentOverrides
  sisyphusAgentConfig?: SisyphusAgentConfig
  modelFallbackControllerAccessor?: ModelFallbackControllerAccessor
  onSyncSessionCreated?: (event: SyncSessionCreatedEvent) => Promise<void>
  syncPollTimeoutMs?: number
  blockOnBackgroundTasks?: boolean
  isBackgroundWaitAvailable?: (sessionID: string) => boolean
  /** OpenCode native skill accessor for skills registered via config.skills.paths. Same shape as SkillLoadOptions.nativeSkills. */
  nativeSkills?: {
    all(): { name: string; description: string; location: string; content: string }[] | Promise<{ name: string; description: string; location: string; content: string }[]>
    get(name: string): { name: string; description: string; location: string; content: string } | undefined | Promise<{ name: string; description: string; location: string; content: string } | undefined>
    dirs(): string[] | Promise<string[]>
  }
  getLoadedSkills?: () => Promise<LoadedSkill[]>
}

import type { DelegatedModelConfig } from "../../shared/model-resolution-types"
export type { DelegatedModelConfig }

export interface BuildSystemContentInput {
  skillContent?: string
  skillContents?: string[]
  categoryPromptAppend?: string
  agentsContext?: string
  planAgentPrepend?: string
  maxPromptTokens?: number
  model?: DelegatedModelConfig
  agentName?: string
  availableCategories?: AvailableCategory[]
  availableSkills?: AvailableSkill[]
  nativeSkillInfos?: { name: string; description: string; location: string }[]
}

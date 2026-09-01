/**
 * Structural typings for the OpenCode V2 plugin host (opencode2, beta channel).
 *
 * These are purposefully structural and minimal: the V2 plugin API is still a
 * moving beta, so we do NOT take a runtime or type dependency on
 * `@opencode-ai/plugin@beta`. The shapes below mirror the published
 * `dist/promise/*.d.ts` surface of beta-18707..18721 (verified live in
 * `.omo/evidence/20260831-opencode-v2-dual-host/`). Field-level drift is
 * caught by the V2 live QA gate, not by the compiler.
 */

export type V2Json = string | number | boolean | null | V2Json[] | { [key: string]: V2Json }

export interface V2App {
  readonly name: string
  readonly version: string
  readonly channel: string
}

export interface V2Location {
  readonly directory: string
  readonly workspaceID?: string
  readonly project?: {
    readonly id?: string
    readonly directory?: string
    readonly canonical?: string
  }
}

export interface V2Registration {
  readonly dispose: () => Promise<void>
}

export type V2Transform<Draft> = (callback: (input: Draft) => void) => Promise<V2Registration>

export type V2HookRegister<Spec> = <Name extends keyof Spec>(
  name: Name,
  callback: (input: Spec[Name]) => Promise<void> | void,
  options?: { providerID?: string },
) => Promise<V2Registration>

/** JSON Schema (draft 2020-12-ish) accepted by tool drafts. */
export interface V2JsonSchema {
  readonly type?: string
  readonly properties?: Record<string, V2JsonSchema | undefined>
  readonly required?: readonly string[]
  readonly additionalProperties?: boolean | V2JsonSchema
  readonly [key: string]: unknown
}

export interface V2ToolContent {
  readonly type: "text" | "file"
  readonly text?: string
  readonly uri?: string
  readonly mime?: string
  readonly name?: string
}

export interface V2ToolResult {
  readonly output?: unknown
  readonly content?: string | ReadonlyArray<V2ToolContent>
  readonly metadata?: Record<string, unknown>
}

export interface V2ToolExecuteContext {
  readonly sessionID: string
  readonly agent: string
  readonly messageID: string
  readonly id: string
  readonly progress: (update: Record<string, unknown>) => Promise<void>
}

export interface V2ToolDefinition {
  readonly name: string
  readonly description: string
  readonly input: V2JsonSchema
  readonly options?: {
    readonly namespace?: string
    readonly codemode?: boolean
    readonly pinned?: boolean
    readonly permission?: string
  }
  readonly execute: (input: unknown, context: V2ToolExecuteContext) => Promise<V2ToolResult>
}

export interface V2ToolDraft {
  list(): ReadonlyArray<V2ToolDefinition & { readonly id: string }>
  get(id: string): (V2ToolDefinition & { readonly id: string }) | undefined
  add(tool: V2ToolDefinition): void
  update(id: string, update: (tool: V2ToolDefinition) => void): void
  remove(id: string): void
}

export interface V2ToolHookBefore {
  readonly tool: string
  readonly sessionID: string
  readonly agent: string
  readonly messageID: string
  readonly id: string
  input: unknown
}

export interface V2ToolHookAfter {
  readonly tool: string
  readonly sessionID: string
  readonly agent: string
  readonly messageID: string
  readonly id: string
  readonly input: unknown
  readonly status: "completed" | "error"
  result?: V2ToolResult
  error?: { readonly message?: string }
}

export interface V2ToolDomain {
  readonly transform: V2Transform<V2ToolDraft>
  readonly reload: () => Promise<void>
  readonly hook: V2HookRegister<{
    "execute.before": V2ToolHookBefore
    "execute.after": V2ToolHookAfter
  }>
}

export interface V2AgentInfo {
  id: string
  name: string
  model?: { id: string; providerID: string; variant?: string }
  request?: { settings?: Record<string, unknown>; headers?: Record<string, string>; body?: Record<string, unknown> }
  system?: string
  description?: string
  mode: "subagent" | "primary" | "all"
  hidden?: boolean
  color?: string
  steps?: number
  permissions?: Array<{ action: string; resource: string; effect: "allow" | "deny" | "ask" }>
}

export interface V2AgentDraft {
  list(): ReadonlyArray<V2AgentInfo>
  get(id: string): V2AgentInfo | undefined
  default(id: string | undefined): void
  update(id: string, update: (agent: V2AgentInfo) => void): void
  remove(id: string): void
}

export interface V2AgentDomain {
  list(): Promise<unknown>
  get(input: { agentID: string }): Promise<unknown>
  transform: V2Transform<V2AgentDraft>
  reload: () => Promise<void>
}

export interface V2McpServerConfig {
  readonly type: "local" | "remote"
  readonly command?: ReadonlyArray<string>
  readonly cwd?: string
  readonly environment?: Record<string, string>
  readonly url?: string
  readonly headers?: Record<string, string>
  readonly disabled?: boolean
  readonly timeout?: { startup?: number; catalog?: number; execution?: number }
  readonly [key: string]: unknown
}

export interface V2McpDraft {
  list(): ReadonlyArray<readonly [string, V2McpServerConfig]>
  get(name: string): V2McpServerConfig | undefined
  set(name: string, config: V2McpServerConfig): void
  update(name: string, update: (config: V2McpServerConfig) => void): void
  remove(name: string): void
}

export interface V2McpDomain {
  list(): Promise<unknown>
  transform: V2Transform<V2McpDraft>
  reload: () => Promise<void>
}

export interface V2SkillInfo {
  id: string
  name: string
  description?: string
  slash?: boolean
  autoinvoke?: boolean
  location: string
  content: string
}

export interface V2SkillDraft {
  list(): ReadonlyArray<V2SkillInfo>
  add(skill: V2SkillInfo): void
  update(id: string, update: (skill: V2SkillInfo) => void): void
  remove(id: string): void
}

export interface V2SkillDomain {
  list(): Promise<unknown>
  transform: V2Transform<V2SkillDraft>
  reload: () => Promise<void>
}

export interface V2CommandInvocation {
  readonly sessionID: string
  readonly prompt: { readonly text: string; readonly files?: ReadonlyArray<unknown>; readonly agents?: ReadonlyArray<unknown>; readonly skills?: ReadonlyArray<unknown> }
  readonly delivery: "steer" | "queue"
}

export interface V2CommandDefinition {
  readonly name: string
  readonly description?: string
  readonly execute: (input: V2CommandInvocation) => Promise<void>
}

export interface V2CommandDraft {
  add(definition: V2CommandDefinition): void
}

export interface V2CommandDomain {
  list(): Promise<unknown>
  transform: V2Transform<V2CommandDraft>
  reload: () => Promise<void>
}

/** Session domain (subset used by the bridge + facade). */
export interface V2SessionPromptInput {
  readonly text?: string
  readonly files?: ReadonlyArray<unknown>
  readonly agents?: ReadonlyArray<unknown>
  readonly skills?: ReadonlyArray<unknown>
  readonly agent?: string
  readonly model?: { providerID: string; id: string }
  readonly [key: string]: unknown
}

export interface V2SessionDomain {
  list(input?: unknown): Promise<unknown>
  get(input: { sessionID: string }): Promise<unknown>
  create(input?: unknown): Promise<unknown>
  remove(input: { sessionID: string }): Promise<void>
  prompt(input: { sessionID: string; text?: string; delivery?: "steer" | "queue"; agent?: string; model?: { providerID: string; id: string } } & Record<string, unknown>): Promise<unknown>
  synthetic(input: { sessionID: string; text: string; agent?: string } & Record<string, unknown>): Promise<unknown>
  interrupt(input: { sessionID: string; continue?: boolean }): Promise<unknown>
  compact(input: { sessionID: string } & Record<string, unknown>): Promise<unknown>
  wait(input: { sessionID: string }): Promise<void>
  context(input: { sessionID: string }): Promise<unknown>
  message(input: { sessionID: string; messageID: string }): Promise<unknown>
  switchAgent(input: { sessionID: string; agent: string }): Promise<void>
  switchModel(input: { sessionID: string; model: { providerID: string; id: string } }): Promise<void>
  hook: V2HookRegister<V2SessionHooks>
}

export interface V2SessionPromptHook {
  readonly sessionID: string
  readonly messageID: string
  prompt: {
    text: string
    files?: Array<Record<string, unknown>>
    agents?: Array<Record<string, unknown>>
    skills?: Array<Record<string, unknown>>
  }
  metadata?: Record<string, unknown>
  delivery: "steer" | "queue"
}

export interface V2SystemPart {
  readonly type?: string
  readonly text?: string
  readonly [key: string]: unknown
}

export interface V2SessionContextHook {
  readonly sessionID: string
  readonly agent: string
  readonly model: { providerID: string; id: string; variant?: string }
  system: Array<V2SystemPart>
  messages: Array<Record<string, unknown>>
  tools: Record<string, { description: string; input: unknown }>
  generation: {
    maxTokens?: number
    temperature?: number
    topP?: number
    topK?: number
    frequencyPenalty?: number
    presencePenalty?: number
    seed?: number
    stop?: string[]
  }
  providerOptions: Record<string, unknown>
}

export interface V2SessionModelRequestHook {
  readonly sessionID: string
  readonly agent: string
  readonly model: { providerID: string; id: string; variant?: string }
  baseURL?: string
  headers: Record<string, string>
}

export interface V2SessionRetryHook {
  readonly sessionID: string
  readonly agent: string
  readonly model: { providerID: string; id: string; variant?: string }
  readonly error: { type?: string; message?: string; status?: number }
  readonly attempt: number
  decision: { retry: boolean; delay?: number }
}

export interface V2SessionHooks {
  readonly prompt: V2SessionPromptHook
  readonly context: V2SessionContextHook
  readonly "model.request": V2SessionModelRequestHook
  readonly retry: V2SessionRetryHook
}

export interface V2ShellDomain {
  hook: V2HookRegister<{
    readonly "create.before": {
      command: string
      cwd: string
      timeout: number
      shell: string
      env: Record<string, string | undefined>
    }
  }>
}

export interface V2EventSubscribe {
  (options?: { signal?: AbortSignal }): AsyncIterable<Record<string, unknown>>
}

export interface V2EventDomain {
  subscribe: V2EventSubscribe
}

export interface V2StorageDomain {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  remove(key: string): Promise<void>
}

export interface V2CatalogDomain {
  readonly provider: { list(): Promise<unknown>; get(input: { providerID: string }): Promise<unknown> }
  readonly model: { list(): Promise<unknown>; default(): Promise<unknown> }
  readonly transform: V2Transform<unknown>
  readonly reload: () => Promise<void>
}

export interface V2PluginInfoList {
  list(): Promise<unknown>
}

/** The plugin context handed to `setup(ctx)` by the V2 host. */
export interface V2PluginContext {
  readonly app: V2App
  readonly location: V2Location
  readonly options: Record<string, unknown>
  readonly agent: V2AgentDomain
  readonly tool: V2ToolDomain
  readonly mcp: V2McpDomain
  readonly skill: V2SkillDomain
  readonly command: V2CommandDomain
  readonly session: V2SessionDomain
  readonly shell: V2ShellDomain
  readonly event: V2EventDomain
  readonly storage: V2StorageDomain
  readonly catalog: V2CatalogDomain
  readonly plugin: V2PluginInfoList
  readonly generate?: { text(input: Record<string, unknown>): Promise<{ text: string }> }
}

/** The V2 plugin shape: `{ id, setup }` (Plugin.define is identity at runtime). */
export interface V2Plugin {
  readonly id: string
  readonly setup: (context: V2PluginContext) => Promise<(() => Promise<void> | void) | void> | (() => Promise<void> | void)
}

/**
 * Vendored TypeScript contract for the OpenCode v2 beta plugin API.
 *
 * Source of truth: @opencode-ai/plugin@0.0.0-beta-17728 dist d.ts files,
 * verified against the real opencode2 binary (see
 * .omo/evidence/20260821-opencode-v2-migration/spikes/).
 *
 * Deliberately self-contained: no imports from @opencode-ai/* so this module
 * stays loadable under the v1 host and free of beta-channel dependencies.
 * Domains with no current consumer (integration, reference, websearch,
 * storage, aisdk details) are stubbed loosely on purpose.
 */

export type JsonSchemaObject = Record<string, unknown>

export type Cleanup = () => Promise<void> | void

export interface OmoV2App {
  readonly name: string
  readonly version: string
  readonly channel: string
}

export type PluginOptions = Readonly<Record<string, unknown>>

export interface V2Registration {
  readonly dispose: () => Promise<void>
}

export type V2Hooks<Spec> = <Name extends keyof Spec>(
  name: Name,
  callback: (input: Spec[Name]) => Promise<void> | void,
) => Promise<V2Registration>

export type V2ModelHookOptions = {
  readonly providerID?: string
}

export type V2ModelHooks<Spec> = <Name extends keyof Spec>(
  name: Name,
  callback: (input: Spec[Name]) => Promise<void> | void,
  options?: V2ModelHookOptions,
) => Promise<V2Registration>

export type V2Transform<Input> = (callback: (input: Input) => void) => Promise<V2Registration>

// --- tool domain ---

export interface V2ToolContext {
  readonly sessionID: string
  readonly agent: string
  readonly messageID: string
  readonly id: string
  readonly progress: (update: Record<string, unknown>) => Promise<void>
}

export interface V2ToolResult {
  readonly output?: unknown
  readonly content?: string | ReadonlyArray<{ type: "text"; text: string } | { type: "file"; uri: string; mime: string }>
  readonly metadata?: Record<string, unknown>
}

export interface V2ToolInfo {
  readonly name: string
  readonly description: string
  readonly input: JsonSchemaObject
  readonly output?: JsonSchemaObject
  readonly execute: (input: unknown, context: V2ToolContext) => Promise<V2ToolResult>
  readonly options?: { readonly namespace?: string; readonly permission?: string }
}

export interface V2ToolDraft {
  add(tool: V2ToolInfo): void
}

export interface V2ToolExecuteBefore {
  readonly tool: string
  readonly sessionID: string
  readonly agent: string
  readonly messageID: string
  readonly id: string
  input: unknown
}

export type V2ToolExecuteAfter = Omit<V2ToolExecuteBefore, "input"> & {
  readonly input: unknown
} & (
    | { readonly status: "completed"; result: V2ToolResult }
    | { readonly status: "error"; error: unknown }
  )

export interface V2ToolDomain {
  readonly transform: V2Transform<V2ToolDraft>
  readonly hook: V2Hooks<{
    "execute.before": V2ToolExecuteBefore
    "execute.after": V2ToolExecuteAfter
  }>
}

// --- session domain ---

export interface V2SessionContextEvent {
  readonly sessionID: string
  readonly agent: string
  readonly model: { readonly providerID: string; readonly modelID: string }
  system: unknown[]
  messages: unknown[]
  tools: Record<string, { description: string; input: JsonSchemaObject }>
}

export interface V2SessionHttpRequest {
  readonly sessionID: string
  readonly agent: string
  readonly model: { readonly providerID: string; readonly modelID: string }
  request: Request
}

export interface V2SessionHttpResponse {
  readonly sessionID: string
  readonly agent: string
  readonly model: { readonly providerID: string; readonly modelID: string }
  readonly request: Request
  response: Response
}

export interface V2SessionDomain {
  readonly hook: V2ModelHooks<{
    context: V2SessionContextEvent
    "http.request": V2SessionHttpRequest
    "http.response": V2SessionHttpResponse
  }>
  // Client methods are consumed through the client bridge; typed loosely here.
  readonly create: (input?: unknown) => Promise<unknown>
  readonly get: (input: unknown) => Promise<unknown>
  readonly prompt: (input: unknown) => Promise<unknown>
  readonly wait: (input: unknown) => Promise<void>
}

// --- event domain ---

export interface V2BusEvent {
  readonly id: string
  readonly created: number
  readonly type: string
  readonly [key: string]: unknown
}

export interface V2EventDomain {
  readonly subscribe: () => AsyncIterable<V2BusEvent>
}

// --- registration-style domains (drafts used at setup time) ---

export interface V2AgentDraft {
  list(): readonly Record<string, unknown>[]
  get(id: string): Record<string, unknown> | undefined
  default(id: string | undefined): void
  update(id: string, update: (agent: Record<string, unknown>) => void): void
  remove(id: string): void
}

export interface V2AgentDomain {
  readonly transform: V2Transform<V2AgentDraft>
  readonly reload: () => Promise<void>
}

export interface V2CommandDraft {
  list(): readonly Record<string, unknown>[]
  get(name: string): Record<string, unknown> | undefined
  update(name: string, update: (command: Record<string, unknown>) => void): void
  remove(name: string): void
}

export interface V2CommandDomain {
  readonly transform: V2Transform<V2CommandDraft>
  readonly reload: () => Promise<void>
}

export interface V2McpDraft {
  list(): readonly (readonly [string, Record<string, unknown>])[]
  get(name: string): Record<string, unknown> | undefined
  set(name: string, config: Record<string, unknown>): void
  update(name: string, update: (config: Record<string, unknown>) => void): void
  remove(name: string): void
}

export interface V2McpDomain {
  readonly transform: V2Transform<V2McpDraft>
  readonly reload: () => Promise<void>
}

export interface V2SkillDraft {
  list(): readonly Record<string, unknown>[]
  add(skill: Record<string, unknown>): void
  update(id: string, update: (skill: Record<string, unknown>) => void): void
  remove(id: string): void
}

export interface V2SkillDomain {
  readonly transform: V2Transform<V2SkillDraft>
  readonly reload: () => Promise<void>
}

// --- aggregate context + plugin ---

export interface V2PluginContext {
  readonly app: OmoV2App
  readonly options: PluginOptions
  readonly agent: V2AgentDomain
  readonly command: V2CommandDomain
  readonly event: V2EventDomain
  readonly mcp: V2McpDomain
  readonly session: V2SessionDomain
  readonly skill: V2SkillDomain
  readonly tool: V2ToolDomain
}

export interface V2Plugin {
  readonly id: string
  readonly tui?: boolean
  readonly setup: (context: V2PluginContext) => Promise<Cleanup | void> | Cleanup | void
}

export function defineV2Plugin(plugin: V2Plugin): V2Plugin {
  return plugin
}

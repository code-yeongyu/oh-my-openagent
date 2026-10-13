/**
 * Structural view of the OpenCode 2.x plugin context (`@opencode/plugin` `Plugin.Context`).
 *
 * The adapter types only the members it reads. `@opencode/plugin` is deliberately not a dependency:
 * it pulls its own `effect` peer, and `dependency-security.test.ts` pins the single locked
 * `effect` version that the OpenCode 1.x plugin package needs. The real 2.x binary is the drift
 * check (see the opencode-qa V2 scripts), not a compile-time import.
 */

export type V2Registration = {
  readonly dispose: () => Promise<void>
}

export type V2Cleanup = () => Promise<void> | void

export type V2LocationProject = {
  readonly id: string
  readonly directory: string
  readonly canonical: string
}

export type V2Location = {
  readonly directory: string
  readonly workspaceID?: string
  readonly project: V2LocationProject
}

export type V2App = {
  readonly name: string
  readonly version: string
  readonly channel: string
}

export type V2ToolContent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }

export type V2ToolResult = {
  readonly output?: unknown
  readonly content?: string | ReadonlyArray<V2ToolContent>
  readonly metadata?: Readonly<Record<string, unknown>>
}

export type V2ToolExecuteContext = {
  readonly sessionID: string
  readonly agent: string
  readonly messageID: string
  readonly id: string
  readonly signal: AbortSignal
  readonly progress: (update: Readonly<Record<string, unknown>>) => Promise<void>
}

export type V2ToolInfo = {
  readonly name: string
  readonly description: string
  /** Standard Schema, Effect Schema or JSON Schema; zod v4 schemas are Standard Schema. */
  readonly input: unknown
  readonly execute: (input: any, context: V2ToolExecuteContext) => Promise<V2ToolResult>
  readonly options?: { readonly codemode?: boolean; readonly permission?: string; readonly namespace?: string }
}

export type V2ToolEditor = {
  readonly add: (tool: V2ToolInfo) => void
}

export type V2ToolDomain = {
  readonly transform: (callback: (editor: V2ToolEditor) => void) => Promise<V2Registration>
}

export type V2PluginContext = {
  readonly app: V2App
  readonly location: V2Location
  readonly options: Readonly<Record<string, unknown>>
  readonly tool: V2ToolDomain
}

export type V2PluginDefinition = {
  readonly id: string
  readonly setup: (context: V2PluginContext) => Promise<V2Cleanup>
}

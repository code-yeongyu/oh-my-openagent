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

export type V2PluginContext = {
  readonly app: V2App
  readonly location: V2Location
  readonly options: Readonly<Record<string, unknown>>
}

export type V2PluginDefinition = {
  readonly id: string
  readonly setup: (context: V2PluginContext) => Promise<V2Cleanup>
}

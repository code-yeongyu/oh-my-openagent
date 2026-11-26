import type { JsonObject } from "../../../remote/types"

// What the engine calls answer as their `value`: the record each forwarded command prints today. Slice E1a exports the
// engine's typed function per leaf; its return type must be assignable to the type here, and E1c checks that.
export type AgentDir = {
  readonly version: 1
  readonly ok: true
  readonly dir: string
  readonly source: string
  readonly rule: string
  readonly brandedPrefix: string
}

export type ResourceEntry = {
  readonly scope: "global" | "project"
  readonly source: string
  readonly resource: { readonly type: string; readonly path: string }
  readonly enabled: boolean
  readonly state?: "inherit" | "load" | "unload"
}
export type Resources = { readonly resources: readonly ResourceEntry[] }

export type ModelsDiscovered = { readonly provider: string; readonly models: readonly string[] }
export type ModelRow = {
  readonly provider: string
  readonly model: string
  readonly context: number
  readonly max_out: number
  readonly thinking: boolean
  readonly images: boolean
}
export type ModelsRefreshed = { readonly refreshed: true }

export type PackageChanged = { readonly source: string; readonly scope: "user" | "project" }
export type PackageRow = { readonly source: string; readonly path?: string }
export type Packages = { readonly user: readonly PackageRow[]; readonly project: readonly PackageRow[] }
export type PackagesUpdated = { readonly updated: readonly string[] }

/** The engine's PromptSizeReport (metadata only; prompt text never escapes into it). */
export type PromptSizes = {
  readonly sections: readonly JsonObject[]
  readonly total: { readonly bytes: number; readonly estimatedTokens: number }
}
export type Tip = { readonly id: string; readonly text: string; readonly requiresCommand?: string }

export type ScheduleList = {
  readonly jobs: readonly JsonObject[]
  readonly invalid: readonly JsonObject[]
  readonly runners: readonly JsonObject[]
}
export type ScheduleCancelled = { readonly cancelled: true; readonly in_flight: boolean }
export type ScheduleDelivery = JsonObject
export type ScheduleRunEnded = { readonly passes: number }

export type SessionOfPid = {
  readonly version: 1
  readonly ok: true
  readonly attested: boolean
  readonly pid: number
  readonly sessionId?: string
  readonly attestedPid?: number
  readonly hostPid?: number
  readonly chain?: readonly number[]
  readonly reason?: "process_not_found" | "no_attested_ancestor"
}
export type HtmlExported = { readonly path: string }

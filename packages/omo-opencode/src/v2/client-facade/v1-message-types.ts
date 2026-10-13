import type { V2TokenUsage } from "../context-types"

/** The 1.x message part fields the plugin reads; part-specific fields ride along untyped. */
export type V1Part = {
  readonly id: string
  readonly sessionID: string
  readonly messageID: string
  readonly type: string
} & Readonly<Record<string, unknown>>

export type V1MessageInfo = {
  readonly id: string
  readonly sessionID: string
  readonly role: "user" | "assistant"
  readonly time: { readonly created: number; readonly completed?: number }
  readonly agent: string
  readonly model?: { readonly providerID: string; readonly modelID: string }
  readonly variant?: string
  readonly parentID?: string
  readonly mode?: string
  readonly providerID?: string
  readonly modelID?: string
  readonly finish?: string
  readonly cost?: number
  readonly tokens?: V2TokenUsage
  readonly path?: { readonly cwd: string; readonly root: string }
  readonly error?: { readonly name: string; readonly data: Readonly<Record<string, unknown>> }
  readonly summary?: boolean
}

export type V1Message = { readonly info: V1MessageInfo; readonly parts: ReadonlyArray<V1Part> }

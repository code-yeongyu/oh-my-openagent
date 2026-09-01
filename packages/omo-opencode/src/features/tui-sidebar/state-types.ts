import type { BackgroundTaskStatus } from "../background-agent/types"

export type AgentStatus = "busy" | "idle" | "error" | "running" | "retry"

export type AgentRow = {
  readonly name: string
  readonly status: AgentStatus
}

export type JobRow = {
  readonly title: string
  readonly status: BackgroundTaskStatus
  readonly toolCalls: number | null
  readonly lastTool: string | null
}

export type RosterRow = {
  readonly label: string
  readonly model: string
}

export type ConfigState =
  | { readonly kind: "valid" }
  | { readonly kind: "invalid"; readonly messages: readonly string[] }

export type RosterState =
  | { readonly kind: "empty" }
  | { readonly kind: "rows"; readonly rows: readonly RosterRow[] }

export type AgentsState =
  | { readonly kind: "none" }
  | { readonly kind: "list"; readonly agents: readonly AgentRow[] }

export type JobBoardState =
  | { readonly kind: "none" }
  | { readonly kind: "list"; readonly jobs: readonly JobRow[] }

export type LoopLive = {
  readonly kind: "live"
  readonly goalsDone: number
  readonly goalsTotal: number
  readonly pass: number
  readonly fail: number
  readonly pending: number
  readonly blocked: number
  readonly activeGoal: string | null
}

export type LoopState = { readonly kind: "none" } | LoopLive

export type ConfigBanner =
  | { readonly kind: "none" }
  | { readonly kind: "invalid" }

export type SidebarView =
  | {
      readonly kind: "active"
      readonly loop: LoopState
      readonly agents: AgentsState
      readonly jobs: JobBoardState
      readonly configBanner: ConfigBanner
    }
  | { readonly kind: "broken"; readonly messages: readonly string[] }
  | { readonly kind: "idle"; readonly roster: RosterState }

export function assertNever(value: never): never {
  throw new Error(`Unexpected variant: ${JSON.stringify(value)}`)
}

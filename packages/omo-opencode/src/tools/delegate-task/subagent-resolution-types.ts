import type { FallbackEntry } from "../../shared/model-requirements"
import type { AgentInfo } from "./subagent-discovery"
import type { DelegatedModelConfig } from "./types"

export interface ResolveSubagentExecutionOptions {
  allowSisyphusJuniorDirect?: boolean
  allowPrimaryAgentDelegation?: boolean
}

export interface ResolveSubagentExecutionResult {
  agentToUse: string
  categoryModel: DelegatedModelConfig | undefined
  fallbackChain?: FallbackEntry[]
  error?: string
}

export type SubagentRequestPreflight =
  | { readonly kind: "valid"; readonly agentName: string }
  | { readonly kind: "invalid"; readonly result: ResolveSubagentExecutionResult }

export type SubagentAgentMatch =
  | {
      readonly kind: "matched"
      readonly agentToUse: string
      readonly matchedAgent: AgentInfo
    }
  | { readonly kind: "error"; readonly result: ResolveSubagentExecutionResult }

export interface ResolvedSubagentModel {
  readonly categoryModel: DelegatedModelConfig | undefined
  readonly fallbackChain: FallbackEntry[] | undefined
}

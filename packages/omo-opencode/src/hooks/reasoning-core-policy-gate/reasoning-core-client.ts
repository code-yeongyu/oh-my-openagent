import type { PolicyVerdict, ReasoningCoreRequest } from "./types"
import {
  createReasoningCoreClientV2,
  type ReasoningCoreClientConfigV2,
  type ReasoningCoreClientV2,
} from "./client"

export type {
  ReasoningCoreVariableDefinition,
  ReasoningCoreConstraintRequest,
  ReasoningCoreConstraintState,
  ReasoningCoreKbQuery,
  ReasoningCoreKbQueryResult,
  ReasoningCoreKbAddEntry,
  ReasoningCoreKbAddResult,
  ReasoningCoreKbRemoveEntry,
  ReasoningCoreSolveProblem,
  ReasonArgueRequest,
  ReasoningCoreSolveOutcome,
  ReasoningCoreMetacognitiveState,
  ReasoningCoreMetacognitiveVerdict,
  ReasoningCoreMetacognitiveStatus,
} from "./client"

export interface ReasoningCoreClientConfig {
  binaryPath?: string
  timeoutMs?: number
  verbose?: boolean
  httpEndpoint?: string
  mode?: "auto" | "http" | "stdio"
  poolSize?: number
}

export type ReasoningCoreClient = ReasoningCoreClientV2

export function createReasoningCoreClient(config?: ReasoningCoreClientConfig): ReasoningCoreClient {
  const v2Config: ReasoningCoreClientConfigV2 = {
    mode: config?.mode,
    httpEndpoint: config?.httpEndpoint,
    binaryPath: config?.binaryPath,
    poolSize: config?.poolSize,
    timeoutMs: config?.timeoutMs,
    verbose: config?.verbose,
  }
  return createReasoningCoreClientV2(v2Config)
}

export type { PolicyVerdict, ReasoningCoreRequest }

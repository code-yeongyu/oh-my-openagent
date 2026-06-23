export type { ReasoningCoreTransport, TransportConfig } from "./transport-interface"
export type { JsonRpcRequest, JsonRpcResponse, JsonRpcSuccessResponse, JsonRpcErrorResponse } from "./json-rpc-message"
export { isJsonRpcErrorResponse } from "./json-rpc-message"
export { ReasoningCoreInfrastructureError, isReasoningCoreInfrastructureError } from "./infrastructure-error"
export type { InfrastructureErrorKind } from "./infrastructure-error"
export { buildTheory } from "./theory-builder"
export { buildPolicyFacts } from "./policy-facts-builder"
export type { PolicyFact } from "./policy-facts-builder"
export { deriveVerdict, allow, deny } from "./verdict-deriver"
export { extractToolPayload, extractJsonRpcError, isRecord, tryParseJson } from "./mcp-payload-extractor"
export { createStdioTransport } from "./stdio-transport"
export type { StdioTransportConfig } from "./stdio-transport"
export { createStdioProcessPool } from "./stdio-process-pool"
export type { StdioProcessPoolConfig } from "./stdio-process-pool"
export { createHttpTransport, probeHttpHealth } from "./http-transport"
export type { HttpTransportConfig } from "./http-transport"
export { createTransport } from "./transport-factory"
export type { TransportMode, TransportFactoryConfig } from "./transport-factory"
export { createReasoningCoreClientV2 } from "./client-impl"
export type { ReasoningCoreClientV2, ReasoningCoreClientConfigV2 } from "./client-impl"
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
} from "./client-types"

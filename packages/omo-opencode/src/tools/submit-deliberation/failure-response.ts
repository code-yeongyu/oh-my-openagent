import type { DeliberationRequest } from "../../agents/themis/types"
import type { FormalizationErrorCode } from "../../hooks/reasoning-core-policy-gate/semantic-formalization-service"
import { buildFormalizationBlock } from "./formalization-helpers"

export function buildNoTheoryResponse(request: DeliberationRequest) {
  return {
    verdict: "formalization_failed",
    rationale: "No pre-formalized theory provided and no Formalizer service is wired into this tool instance. Call task(subagent_type='formalizer', prompt=<your deliberation request as JSON>) first, then pass the returned JSON theory as the 'theory' parameter.",
    proof_chain: [],
    sidecar_trace: { theory: null, extensions: [], argue_result: null, sidecar: null },
    provenance: { semantics: request.requested_semantics, iterations: 0, timestamp: new Date().toISOString(), input_request: request, formalization: buildFormalizationBlock("provider_failure") },
    bundle: null,
    error: "No theory provided. Use subagent_type='formalizer' first.",
    formalization: buildFormalizationBlock("provider_failure"),
  }
}

export function buildInvalidTheoryResponse(request: DeliberationRequest, parseError: unknown) {
  return {
    verdict: "formalization_failed",
    rationale: `Failed to parse theory JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
    proof_chain: [],
    sidecar_trace: { theory: null, extensions: [], argue_result: null, sidecar: null },
    provenance: { semantics: request.requested_semantics, iterations: 0, timestamp: new Date().toISOString(), input_request: request, formalization: buildFormalizationBlock("schema_invalid") },
    bundle: null,
    error: "Invalid theory JSON",
    formalization: buildFormalizationBlock("schema_invalid"),
  }
}

export function buildAutoFormalizationFailedResponse(
  request: DeliberationRequest,
  err: unknown,
  errorCode: FormalizationErrorCode,
) {
  const message = err instanceof Error ? err.message : String(err)
  const formalizationBlock = buildFormalizationBlock(errorCode)
  return {
    verdict: "formalization_failed",
    rationale: `Automatic formalization via Formalizer subagent failed (${errorCode}): ${message}. You can retry by passing a pre-formalized ASPIC+ theory via the 'theory' argument.`,
    proof_chain: [],
    sidecar_trace: { theory: null, extensions: [], argue_result: null, sidecar: null },
    provenance: { semantics: request.requested_semantics, iterations: 0, timestamp: new Date().toISOString(), input_request: request, formalization: formalizationBlock },
    bundle: null,
    error: `Auto-formalization failed: ${message}`,
    formalization: formalizationBlock,
  }
}

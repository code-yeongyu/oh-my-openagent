import type { DeliberationResponse } from "../../agents/themis/types"
import type { AudienceAnalysis, ConvergenceStatus, EpistemicAnalysis, SemanticsComparison } from "../../hooks/reasoning-core-policy-gate/extended-response-types"
import type { RuntimeBuildState } from "../../shared/runtime-build-state"
import { getRuntimeBuildState } from "../../shared/runtime-build-state"
import { buildRationaleSurface } from "./rationale-surface"

export function buildSuccessResponseJson(input: {
  response: DeliberationResponse
  preferenceCycle: { detected: boolean; path: string[] }
  semanticsComparison: SemanticsComparison
  audienceAnalysis?: unknown
  epistemicAnalysis?: EpistemicAnalysis
  formalization: Record<string, unknown>
  solveMetacognition?: unknown
  convergence?: ConvergenceStatus
  runtimeBuildInfoOverride?: RuntimeBuildState
}): string {
  const audienceAnalysis = isAudienceAnalysis(input.audienceAnalysis) ? input.audienceAnalysis : undefined
  const runtimeBuildState = input.runtimeBuildInfoOverride ?? getRuntimeBuildState()

  if (runtimeBuildState.stale_runtime_detected) {
    const staleRuntimeMessage = "Stale runtime detected: host build does not match latest local build. Run /reload-plugins or fully restart the host."
    return JSON.stringify({
      ...input.response,
      verdict: "sidecar_internal_error",
      rationale: staleRuntimeMessage,
      error: staleRuntimeMessage,
      bundle: null,
      runtime_provenance: runtimeBuildState,
      preference_cycle_detected: input.preferenceCycle.detected,
      preference_cycle_path: input.preferenceCycle.path,
      semantics_comparison: input.semanticsComparison,
      ...(audienceAnalysis ? { audience_analysis: audienceAnalysis } : {}),
      ...(input.epistemicAnalysis ? { epistemic_analysis: input.epistemicAnalysis } : {}),
      ...(input.convergence ? { convergence: input.convergence } : {}),
      formalization: input.formalization,
      provenance: {
        ...input.response.provenance,
        formalization: input.formalization,
        ...(input.solveMetacognition ? { solve_metacognition: input.solveMetacognition } : {}),
      },
    }, null, 2)
  }

  const effectiveVerdict = deriveEffectiveVerdict(input.response, audienceAnalysis, input.convergence)
  const response = effectiveVerdict === input.response.verdict ? input.response : { ...input.response, verdict: effectiveVerdict }
  const basePayload = {
    ...response,
    preference_cycle_detected: input.preferenceCycle.detected,
    preference_cycle_path: input.preferenceCycle.path,
    semantics_comparison: input.semanticsComparison,
    ...(audienceAnalysis ? { audience_analysis: audienceAnalysis } : {}),
    ...(input.epistemicAnalysis ? { epistemic_analysis: input.epistemicAnalysis } : {}),
    ...(input.convergence ? { convergence: input.convergence } : {}),
  }
  const rationaleSurface = buildRationaleSurface({
    response,
    preferenceCycle: input.preferenceCycle,
    semanticsComparison: input.semanticsComparison,
    audienceAnalysis,
    convergence: input.convergence,
  })
  const bundle = enhanceBundleActionGuidance(response.bundle, audienceAnalysis, input.convergence)

  return JSON.stringify({
    ...basePayload,
    ...(bundle ? { bundle } : {}),
    rationale: rationaleSurface.rationale,
    ...(rationaleSurface.rationale_detail ? { rationale_detail: rationaleSurface.rationale_detail } : {}),
    runtime_provenance: runtimeBuildState,
    formalization: input.formalization,
    provenance: {
      ...input.response.provenance,
      formalization: input.formalization,
      ...(input.solveMetacognition ? { solve_metacognition: input.solveMetacognition } : {}),
    },
  }, null, 2)
}

function enhanceBundleActionGuidance(
  bundle: DeliberationResponse["bundle"],
  audienceAnalysis: AudienceAnalysis | undefined,
  convergence: ConvergenceStatus | undefined,
): DeliberationResponse["bundle"] {
  if (!bundle) return bundle

  const guardrails = [...new Set([
    ...(bundle.guardrails ?? []),
    ...(audienceAnalysis?.consensus === "split"
      ? ["Record dissenting value perspectives before executing the selected option."]
      : []),
    ...(convergence === "not_converged"
      ? ["Treat this recommendation as contestable across semantics and record the decision rationale before execution."]
      : []),
  ])]

  return {
    ...bundle,
    guardrails,
  }
}

function deriveEffectiveVerdict(
  response: DeliberationResponse,
  audienceAnalysis: AudienceAnalysis | undefined,
  convergence: ConvergenceStatus | undefined,
): DeliberationResponse["verdict"] {
  if (response.verdict !== "selected") {
    return response.verdict
  }

  const recourseLevel = getRecourseLevel(response.voi_analysis)
  if (audienceAnalysis?.consensus === "split" && convergence === "not_converged" && isReversibleRecourse(recourseLevel)) {
    return "defer_recommended"
  }

  return response.verdict
}

function isAudienceAnalysis(value: unknown): value is AudienceAnalysis {
  return typeof value === "object"
    && value !== null
    && Array.isArray((value as { audiences?: unknown }).audiences)
    && typeof (value as { consensus?: unknown }).consensus === "string"
    && typeof (value as { per_audience?: unknown }).per_audience === "object"
}

function getRecourseLevel(value: DeliberationResponse["voi_analysis"]): string | undefined {
  if (!isRecord(value) || !isRecord(value.result)) return undefined
  return typeof value.result.recourseLevel === "string" ? value.result.recourseLevel : undefined
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isReversibleRecourse(value: string | undefined): boolean {
  return value === "reversible" || value === "partially_reversible"
}

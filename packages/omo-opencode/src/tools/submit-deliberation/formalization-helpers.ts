import { createLiveFormalizationService } from "../../hooks/reasoning-core-policy-gate/semantic-formalization-service/live-service-factory"
import {
  createCacheKeyGenerator,
  createCacheStore,
  createSchemaParser,
  createSemanticFormalizationService,
  createTheoryValidator,
  FormalizationError,
  type FormalizationProvenance,
  type SemanticFormalizationService,
} from "../../hooks/reasoning-core-policy-gate/semantic-formalization-service"
import { getOptionSelectionKeys } from "../../hooks/reasoning-core-policy-gate/option-selection-key"
import { processConclusion } from "../../hooks/epistemic-state-interpreter/hook-v2-conclusion-processor"
import { normalizeProofArtifact } from "../../hooks/epistemic-state-interpreter/normalize-proof-artifact"
import { computePianoD } from "../../hooks/epistemic-state-interpreter/piano-d-engine"
import type { MultiPlaneHookConfig } from "../../hooks/epistemic-state-interpreter/hook-v2"
import type { parseProofArtifact } from "../../hooks/epistemic-state-interpreter/proof-artifact-parser"
import type { AudienceAnalysis } from "../../hooks/reasoning-core-policy-gate/extended-response-types"
import { log } from "../../shared/logger"

function asAudienceAnalysis(value: unknown): AudienceAnalysis | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const candidate = value as { audiences?: unknown; consensus?: unknown; per_audience?: unknown }
  if (!Array.isArray(candidate.audiences)) return undefined
  if (typeof candidate.consensus !== "string") return undefined
  if (typeof candidate.per_audience !== "object" || candidate.per_audience === null) return undefined
  return candidate as AudienceAnalysis
}

export const FORMALIZATION_MODEL_ID = process.env.THEMIS_FORMALIZATION_MODEL_ID ?? "semantic-formalization-unconfigured"
export const FORMALIZATION_MODEL_VERSION = process.env.THEMIS_FORMALIZATION_MODEL_VERSION
export const FORMALIZATION_PROMPT_VERSION = process.env.THEMIS_FORMALIZATION_PROMPT_VERSION ?? "dev"
export const FORMALIZATION_SCHEMA_VERSION = Number(process.env.THEMIS_FORMALIZATION_SCHEMA_VERSION ?? "1")

export type FormalizationBlock = {
  model_id: string
  model_version?: string
  prompt_version: string
  schema_version: number
  mode: "permissive" | "strict"
  cache_hit: boolean
  iterations_attempted: number
  error_code?: FormalizationError["code"]
}

export const PIPELINE_CONFIG: MultiPlaneHookConfig = {
  enabled: true,
  epistemic_gate_mode: "annotation",
  plausibilita_threshold: 0.6,
  ethical_value_hierarchy: ["vita_umana", "autonomia"],
  pragmatic_weights: { peso_proprio: 0.6, peso_controparte: 0.4 },
  moral_context_defaults: { default_audience: "general", require_audience_model: false },
  transition_thresholds: { advancement_min_strength: 1, retrocession_min_strength: 2, expulsion_min_strength: 3, reopening_min_strength: 2 },
  confidence_weights: { extensionRatio: 0.4, proofChainDepth: 0.3, ruleStrength: 0.3 },
}

export function toSlug(value: string, index: number): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
  return slug.length > 0 ? slug : `option_${index}`
}

export function createOptionMap(options: string[]) {
  return new Map(
    options.flatMap((option, index) => getOptionSelectionKeys(option, index).map((key) => [key, option] as const)),
  )
}

export function detectIsInteractive(context: { ask?: unknown }): boolean {
  return typeof context.ask === "function" && process.stdin?.isTTY === true && process.stdout?.isTTY === true
}

export function buildFormalizationBlock(errorCode?: FormalizationError["code"]): FormalizationBlock {
  return {
    model_id: FORMALIZATION_MODEL_ID,
    ...(FORMALIZATION_MODEL_VERSION ? { model_version: FORMALIZATION_MODEL_VERSION } : {}),
    prompt_version: FORMALIZATION_PROMPT_VERSION,
    schema_version: FORMALIZATION_SCHEMA_VERSION,
    mode: "permissive",
    cache_hit: false,
    iterations_attempted: 0,
    ...(errorCode ? { error_code: errorCode } : {}),
  }
}

export function createDefaultSemanticService(pluginDeps?: {
  delegateTaskTool?: { execute(args: Record<string, unknown>, context: unknown): Promise<unknown> }
  pluginContext?: { sessionID: string; metadata?: (data: Record<string, unknown>) => void }
}): SemanticFormalizationService {
  return createLiveFormalizationService({
    delegateTaskTool: pluginDeps?.delegateTaskTool,
    pluginContext: pluginDeps?.pluginContext,
    modelId: FORMALIZATION_MODEL_ID,
    modelVersion: FORMALIZATION_MODEL_VERSION,
    promptVersion: FORMALIZATION_PROMPT_VERSION,
    schemaVersion: FORMALIZATION_SCHEMA_VERSION,
  })
}

export function toFormalizationProvenanceBlock(provenance: FormalizationProvenance): FormalizationBlock {
  return {
    model_id: provenance.model_id,
    ...(provenance.model_version ? { model_version: provenance.model_version } : {}),
    prompt_version: provenance.prompt_version,
    schema_version: provenance.schema_version,
    mode: provenance.mode,
    cache_hit: provenance.cache_hit,
    iterations_attempted: provenance.iterations_attempted,
  }
}

export function createProcessedConclusions(
  argueResult: unknown,
  sessionID: string,
  callID: string,
  parsed: NonNullable<ReturnType<typeof parseProofArtifact>>,
  audienceAnalysis?: unknown,
) {
  const artifact = normalizeProofArtifact(argueResult)
  const timestamp = Date.now()
  const processed = [...parsed.conclusions.entries()].map(([conclusion, parsedConclusion]) => processConclusion({
    config: PIPELINE_CONFIG,
    response: artifact,
    sessionID,
    callID,
    conclusion,
    parsedConclusion,
    extensionCount: parsed.extensionCount,
    totalConclusions: parsed.conclusions.size,
    timestamp,
  }))
  const narrowedAudienceAnalysis = asAudienceAnalysis(audienceAnalysis)
  const pianoD = computePianoD({
    conclusions: processed.map(({ annotation, valutazione, blocked }) => ({
      conclusion: annotation.conclusion,
      valutazione,
      blocked,
    })),
    ...(narrowedAudienceAnalysis ? { audienceAnalysis: narrowedAudienceAnalysis } : {}),
  })
  for (const { annotation } of processed) {
    annotation.state.pianoD = pianoD
  }
  return processed
}

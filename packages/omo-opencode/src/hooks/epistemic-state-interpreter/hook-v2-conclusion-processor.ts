import type { ConfidenceWeights } from "../../config/schema/epistemic-v5"
import type {
  MoralContextDefaults,
  PragmaticWeights,
  TransitionThresholds,
} from "../../config/schema/epistemic-v6"
import { evaluateEtico } from "./evaluator-etico-v6"
import { evaluateMorale } from "./evaluator-morale-v6"
import { evaluatePragmatico } from "./evaluator-pragmatico-v6"
import { createHook, getHookBalance } from "./hook-store"
import type { EpistemicHook } from "./hook-entity-types"
import {
  createHookFactors,
  getHookPolarity,
  getHookStrength,
  getPremiseTags,
  toAnalyzedProofChain,
} from "./hook-v2-conclusion-support"
import type { MultiPlaneAnnotation } from "./multi-plane-types"
import { computePianoB } from "./piano-b-engine"
import { computePianoC } from "./piano-c-engine"
import { classifyPianoA } from "./piano-a-classifier"
import { derivePreference, toValutazioneMultiAsse } from "./preference-derivation-v2"
import { evaluateLogico } from "./preference-evaluator-logico"
import { evaluateProbabilistico } from "./preference-evaluator-probabilistico"
import { analyzeProofChain } from "./proof-chain-analyzer"
import type { ParsedConclusion } from "./proof-artifact-parser"
import { enrichParsedConclusionWithTags } from "./tag-conclusion-preprocessor"
import { computeTransitionV2 } from "./transition-engine-v2"

interface ProcessConclusionConfig {
  plausibilita_threshold: number
  ethical_value_hierarchy: string[]
  pragmatic_weights: PragmaticWeights
  moral_context_defaults: MoralContextDefaults
  transition_thresholds: TransitionThresholds
  confidence_weights: ConfidenceWeights
}

export interface ProcessConclusionInput {
  config: ProcessConclusionConfig
  response: unknown
  sessionID: string
  callID: string
  conclusion: string
  parsedConclusion: ParsedConclusion
  extensionCount: number
  totalConclusions: number
  timestamp: number
}

export interface ProcessedConclusion {
  annotation: MultiPlaneAnnotation
  hook: EpistemicHook
  valutazione: NonNullable<MultiPlaneAnnotation["valutazione"]>
  blocked: boolean
}

export function processConclusion(input: ProcessConclusionInput): ProcessedConclusion {
  const extensionMembership = {
    inCount: input.parsedConclusion.extensionsIn,
    totalCount: input.extensionCount,
  }
  const rawClassification = classifyPianoA({
    status: input.parsedConclusion.status,
    extensionsIn: input.parsedConclusion.extensionsIn,
    extensionsTotal: input.extensionCount,
    proofChainKind: input.parsedConclusion.proofChainKind,
    hasResidualDefeasibleSupport: input.parsedConclusion.hasResidualDefeasibleSupport,
  })
  const chain = toAnalyzedProofChain(analyzeProofChain(input.response, input.conclusion))
  const pianoB = computePianoB(
    extensionMembership,
    chain,
    input.config.confidence_weights,
    input.config.plausibilita_threshold,
  )
  const pianoC = computePianoC(chain, extensionMembership)
  const logico = evaluateLogico(input.parsedConclusion.proofChainKind)
  const probabilistico = evaluateProbabilistico(extensionMembership.inCount, extensionMembership.totalCount)
  const chainDerivedTags = getPremiseTags(chain)
  const premiseTags = enrichParsedConclusionWithTags(input.conclusion, chainDerivedTags)
  const hook = createHook(
    input.sessionID,
    input.conclusion,
    getHookPolarity(rawClassification),
    getHookStrength(rawClassification),
    createHookFactors({
      logico,
      probabilistico,
      pianoBProbabile: pianoB.probabile,
      pianoCInconclusivo: pianoC.inconclusivo,
      eticoScore: 0.5,
      pragmaticoScore: 0,
      blocked: false,
      premiseTags,
    }),
    `classification=${rawClassification}`,
  )
  const transition = computeTransitionV2(
    rawClassification,
    getHookBalance(input.sessionID, input.conclusion),
    input.config.transition_thresholds,
    pianoB.plausibile,
  )
  const etico = evaluateEtico({
    conclusion: input.conclusion,
    proofChainKind: input.parsedConclusion.proofChainKind,
    premiseTags,
    extensionMembership,
    valueHierarchy: input.config.ethical_value_hierarchy,
  })
  const pragmatico = evaluatePragmatico({
    conclusion: input.conclusion,
    proofChainKind: input.parsedConclusion.proofChainKind,
    extensionMembership,
    competingConclusionCount: Math.max(0, input.totalConclusions - 1),
    hasStrongAttackers: extensionMembership.inCount < extensionMembership.totalCount,
    weights: input.config.pragmatic_weights,
  })
  const morale = evaluateMorale({
    conclusion: input.conclusion,
    premiseTags,
    audienceType: null,
    conclusionAction: null,
    hasQualifications: premiseTags.some((tag) => tag.includes("qualif") || tag.includes("warning") || tag.includes("caution")),
    competingArgumentCount: Math.max(0, input.totalConclusions - 1),
    defaults: input.config.moral_context_defaults,
  })
  const derivationInput = {
    conclusion: input.conclusion,
    logico,
    probabilistico,
    etico,
    pragmatico,
    morale,
  }
  const derived = derivePreference(derivationInput)
  hook.factors = createHookFactors({
    logico,
    probabilistico,
    pianoBProbabile: pianoB.probabile,
    pianoCInconclusivo: pianoC.inconclusivo,
    eticoScore: etico.score ?? 0.5,
    pragmaticoScore: pragmatico.score,
    blocked: derived.blocked,
    premiseTags,
  })
  const valutazione = toValutazioneMultiAsse(derived, derivationInput)
  const annotation: MultiPlaneAnnotation = {
    conclusion: input.conclusion,
    state: {
      pianoA: transition.to,
      pianoB,
      pianoC,
      pianoD: null,
    },
    rawClassification,
    reason: `status=${input.parsedConclusion.status} extensions=${extensionMembership.inCount}/${extensionMembership.totalCount} transition=${transition.reason}`,
    timestamp: input.timestamp,
    callID: input.callID,
    proofChainKind: input.parsedConclusion.proofChainKind,
    extensionMembership,
    valutazione,
  }

  return {
    annotation,
    hook,
    valutazione,
    blocked:
      derived.blocked
      || pianoC.inconclusivo
      || transition.to === "escluso"
      || transition.to === "escluso_operativamente",
  }
}

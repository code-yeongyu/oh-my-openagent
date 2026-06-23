import {
  createReasoningCoreClient,
  type ReasoningCoreClient,
  type ReasonArgueRequest,
} from "../../hooks/reasoning-core-policy-gate/reasoning-core-client"
import { log } from "../../shared"
import { parseAspicPayload, readStatusVerdict } from "./aspic-payload-parser"
import type { AspicSemantics, Evidence, EvidenceVerdict, Hypothesis, HypothesisStatus } from "./types"

const SUPPORTS_WEIGHT = 0.25
const REFUTES_WEIGHT = -0.5
const CONFIRMED_THRESHOLD = 0.9

let cachedClient: ReasoningCoreClient | null = null

function getClient(): ReasoningCoreClient {
  if (cachedClient == null) cachedClient = createReasoningCoreClient()
  return cachedClient
}

export function __setReasoningCoreClientForTest(client: ReasoningCoreClient | null): void {
  cachedClient = client
}

export type DecisionInput = {
  hypothesis: Hypothesis
  evidenceHistory: Evidence[]
  latestVerdict: EvidenceVerdict
  latestEvidenceId: number
  runReasoningCore: boolean
  aspicSemantics?: AspicSemantics
  aspicPreferences?: ReadonlyArray<{ superior: string; inferior: string }>
}

export type DecisionSource =
  | "aspic-conclusive"
  | "aspic-multi-extension"
  | "aspic-inconclusive"
  | "fallback-weights"
  | "fallback-error"

export type Decision = {
  status: HypothesisStatus
  confidence: number
  source: DecisionSource
  extensionsCount: number | null
  uncertaintyLabel: string | null
}

type AspicOutcome =
  | { outcome: "conclusive"; decision: Decision }
  | { outcome: "multi-extension"; decision: Decision }
  | { outcome: "inconclusive"; extensionsCount: number | null }
  | { outcome: "error" }

export async function decideHypothesisStatus(input: DecisionInput): Promise<Decision> {
  if (!input.runReasoningCore) return computeFallback(input, "fallback-weights")
  const template = parseTemplate(input.hypothesis.aspic_theory_template)
  if (!template) return computeFallback(input, "fallback-weights")
  const aspic = await tryAspicDecide(input, template)
  if (aspic.outcome === "conclusive") return aspic.decision
  if (aspic.outcome === "multi-extension") return aspic.decision
  if (aspic.outcome === "inconclusive") return inconclusiveDecision(input, aspic.extensionsCount)
  return computeFallback(input, "fallback-error")
}

function inconclusiveDecision(input: DecisionInput, extensionsCount: number | null): Decision {
  const baseline: HypothesisStatus =
    input.hypothesis.status === "refuted" || input.hypothesis.status === "confirmed"
      ? "active"
      : input.hypothesis.status
  return { status: baseline, confidence: input.hypothesis.confidence, source: "aspic-inconclusive", extensionsCount, uncertaintyLabel: null }
}

function computeFallback(input: DecisionInput, source: "fallback-weights" | "fallback-error"): Decision {
  let confidence = 0.5
  let lastRefute = -1
  let lastSupport = -1
  for (let i = 0; i < input.evidenceHistory.length; i++) {
    const verdict = input.evidenceHistory[i]!.verdict
    if (verdict === "supports") {
      confidence += SUPPORTS_WEIGHT
      lastSupport = i
    } else if (verdict === "refutes") {
      confidence += REFUTES_WEIGHT
      lastRefute = i
    }
  }
  confidence = Math.max(0, Math.min(1, confidence))
  if (lastRefute >= 0 && lastRefute >= lastSupport) {
    return { status: "refuted", confidence: Math.min(confidence, 0), source, extensionsCount: null, uncertaintyLabel: null }
  }
  if (confidence >= CONFIRMED_THRESHOLD) {
    return { status: "confirmed", confidence, source, extensionsCount: null, uncertaintyLabel: null }
  }
  const baseline: HypothesisStatus =
    input.hypothesis.status === "refuted" || input.hypothesis.status === "confirmed"
      ? "active"
      : input.hypothesis.status
  return { status: baseline, confidence, source, extensionsCount: null, uncertaintyLabel: null }
}

function parseTemplate(raw: string | null): ReasonArgueRequest["theory"] | null {
  if (raw == null || raw.trim() === "") return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { premises?: unknown }).premises)) {
      return parsed as ReasonArgueRequest["theory"]
    }
    return null
  } catch {
    return null
  }
}

async function tryAspicDecide(input: DecisionInput, template: ReasonArgueRequest["theory"]): Promise<AspicOutcome> {
  let client: ReasoningCoreClient
  try {
    client = getClient()
  } catch (err) {
    return logAspicError(input.hypothesis.id, err)
  }
  if (typeof client.argue !== "function") return { outcome: "error" }
  try {
    const enriched = enrichWithEvidence(template, input)
    const semantics: AspicSemantics = input.aspicSemantics ?? "grounded"
    const payload = await client.argue({ theory: enriched, semantics })
    return interpretAspicPayload(payload, input.hypothesis.id, semantics)
  } catch (err) {
    return logAspicError(input.hypothesis.id, err)
  }
}

function interpretAspicPayload(payload: unknown, hypothesisId: string, semantics: AspicSemantics): AspicOutcome {
  const parsed = parseAspicPayload(payload)
  const verdict = readStatusVerdict(parsed.acceptedConclusions, hypothesisId)
  if (semantics !== "grounded" && parsed.extensionsCount > 1) {
    if (verdict !== null) {
      return { outcome: "multi-extension", decision: { status: "active", confidence: 0.5, source: "aspic-multi-extension", extensionsCount: parsed.extensionsCount, uncertaintyLabel: "high" } }
    }
    return { outcome: "inconclusive", extensionsCount: parsed.extensionsCount }
  }
  if (verdict === "refuted") {
    return { outcome: "conclusive", decision: { status: "refuted", confidence: 0, source: "aspic-conclusive", extensionsCount: parsed.extensionsCount, uncertaintyLabel: null } }
  }
  if (verdict === "confirmed") {
    return { outcome: "conclusive", decision: { status: "confirmed", confidence: 1, source: "aspic-conclusive", extensionsCount: parsed.extensionsCount, uncertaintyLabel: null } }
  }
  return { outcome: "inconclusive", extensionsCount: parsed.extensionsCount }
}

function logAspicError(hypothesisId: string, err: unknown): { outcome: "error" } {
  const message = err instanceof Error ? err.message : String(err)
  log("[probe-lab] reason_argue failed; falling back to cumulative weights", { hypothesis_id: hypothesisId, error: message })
  return { outcome: "error" }
}

function enrichWithEvidence(template: ReasonArgueRequest["theory"], input: DecisionInput): ReasonArgueRequest["theory"] {
  const verdictPredicate = input.latestVerdict === "supports" ? "supports" : input.latestVerdict === "refutes" ? "refutes" : "inconclusive"
  const evidenceFormula = `${verdictPredicate}(evidence(${input.latestEvidenceId}))`
  const premises = [...(template.premises ?? []), { formula: evidenceFormula }]
  const preferences = mergePreferences(template, input.aspicPreferences)
  return { ...template, premises, preferences }
}

function mergePreferences(template: ReasonArgueRequest["theory"], derived: ReadonlyArray<{ superior: string; inferior: string }> | undefined): { superior: string; inferior: string }[] | undefined {
  const existing = template.preferences ?? []
  if (!derived || derived.length === 0) return existing.length === 0 ? undefined : [...existing]
  return [...existing, ...derived]
}

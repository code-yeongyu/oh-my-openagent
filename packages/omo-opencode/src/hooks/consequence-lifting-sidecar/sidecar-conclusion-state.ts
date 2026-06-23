import type { ProcessedConclusion } from "../epistemic-state-interpreter/hook-v2-conclusion-processor"
import type { ProofStep } from "./consequence-graph"
import type { ContaminationResult } from "./contamination-types"
import type { DecisionProfile } from "./types"

export interface SidecarConclusionState {
  status: string
  pianoA: string
  combined: number
  tags: string[]
  blocked: boolean
  proofChain: ProofStep[]
  proofChainKind: ProcessedConclusion["annotation"]["proofChainKind"] | null
  extensionMembership: ProcessedConclusion["annotation"]["extensionMembership"] | null
}

export function buildConclusionStates(input: {
  processed: ProcessedConclusion[]
  proofArtifact: unknown
  detectContamination: (conclusion: string, proofChain: ProofStep[], tags: string[]) => ContaminationResult
}): { states: Map<string, SidecarConclusionState>; contaminationResults: ContaminationResult[] } {
  const proofEntries = extractProofEntries(input.proofArtifact)
  const states = new Map<string, SidecarConclusionState>()
  const contaminationResults: ContaminationResult[] = []

  for (const entry of input.processed) {
    const proof = proofEntries.get(entry.annotation.conclusion)
    const tags = getTags(entry.annotation.conclusion, proof?.proofChain ?? [])
    states.set(entry.annotation.conclusion, {
      status: proof?.status ?? (entry.blocked ? "Rejected" : "Accepted"),
      pianoA: entry.annotation.state.pianoA,
      combined: entry.valutazione.combined,
      tags,
      blocked: entry.blocked,
      proofChain: proof?.proofChain ?? [],
      proofChainKind: entry.annotation.proofChainKind,
      extensionMembership: entry.annotation.extensionMembership,
    })
    contaminationResults.push(input.detectContamination(entry.annotation.conclusion, proof?.proofChain ?? [], tags))
  }

  propagateContamination(input.processed, states, contaminationResults)

  return { states, contaminationResults }
}

export function toCoreStatus(status: string, blocked: boolean): DecisionProfile["coreStatus"] {
  if (status === "Rejected" || blocked) return "rejected"
  if (status === "Accepted") return "accepted"
  return "undecided"
}

export function feasibilityConstraints(decisions: string[], states: Map<string, SidecarConclusionState>): Array<{ decision: string; feasible: boolean; reason: string }> {
  return decisions.map((decision) => {
    const tags = states.get(decision)?.tags ?? []
    const infeasible = tags.includes("feasible:false") || tags.some((tag) => tag === "constraint:infeasible" || tag === "constraint:temporal_window_closed")
    return { decision, feasible: !infeasible, reason: infeasible ? "temporal or feasibility constraint" : "no blocking constraint" }
  })
}

function extractProofEntries(raw: unknown): Map<string, { status: string; proofChain: ProofStep[] }> {
  const result = getRecord(raw, "result")
  const conclusions = getRecord(result, "conclusions")

  return new Map(Object.entries(conclusions).map(([conclusion, entry]) => {
    const record = isRecord(entry) ? entry : {}
    const proofChain = Array.isArray(record.proof_chain) ? (record.proof_chain as ProofStep[]) : []
    return [conclusion, { status: typeof record.status === "string" ? record.status : "Undecided", proofChain }]
  }))
}

function getTags(conclusion: string, proofChain: ProofStep[]): string[] {
  return [...new Set([
    conclusion,
    ...proofChain.flatMap((step) => [step.conclusion, ...(step.from ?? step.antecedents ?? [])]),
  ].filter((item): item is string => typeof item === "string" && item.includes(":")))]
}

function propagateContamination(
  processed: ProcessedConclusion[],
  states: Map<string, SidecarConclusionState>,
  contaminationResults: ContaminationResult[],
): void {
  const resultsByConclusion = new Map(contaminationResults.map((result, index) => [result.conclusion, { index, result }]))

  for (let iteration = 0; iteration < processed.length; iteration += 1) {
    let changed = false

    for (const entry of processed) {
      const current = resultsByConclusion.get(entry.annotation.conclusion)
      const proofChain = states.get(entry.annotation.conclusion)?.proofChain ?? []
      const propagated = mergeContamination(current?.result, getParentContaminationResults(proofChain, resultsByConclusion))

      if (!current || contaminationEquals(current.result, propagated)) {
        continue
      }

      contaminationResults[current.index] = propagated
      resultsByConclusion.set(entry.annotation.conclusion, { index: current.index, result: propagated })
      changed = true
    }

    if (!changed) {
      return
    }
  }
}

function getParentContaminationResults(
  proofChain: ProofStep[],
  resultsByConclusion: Map<string, { index: number; result: ContaminationResult }>,
): ContaminationResult[] {
  const parentConclusions = new Set(
    proofChain.flatMap((step) => step.from ?? step.antecedents ?? []).filter((item): item is string => typeof item === "string"),
  )

  return [...parentConclusions]
    .map((conclusion) => resultsByConclusion.get(conclusion)?.result)
    .filter((result): result is ContaminationResult => result !== undefined && result.level !== "none")
}

function mergeContamination(
  current: ContaminationResult | undefined,
  propagatedParents: ContaminationResult[],
): ContaminationResult {
  if (!current) {
    throw new Error("current contamination result is required")
  }

  if (propagatedParents.length === 0) {
    return current
  }

  const combined = [current, ...propagatedParents]
  const highestLevel = combined.reduce((highest, result) => contaminationRank(result.level) > contaminationRank(highest) ? result.level : highest, current.level)
  const reasons = [...new Set(combined.flatMap((result) => result.reasons))]

  return {
    conclusion: current.conclusion,
    level: highestLevel,
    axis: deriveAxis(combined.map((result) => result.axis)),
    reasons,
  }
}

function contaminationEquals(left: ContaminationResult, right: ContaminationResult): boolean {
  return left.level === right.level
    && left.axis === right.axis
    && left.reasons.length === right.reasons.length
    && left.reasons.every((reason, index) => reason === right.reasons[index])
}

function contaminationRank(level: ContaminationResult["level"]): number {
  switch (level) {
    case "high":
      return 3
    case "medium":
      return 2
    case "low":
      return 1
    default:
      return 0
  }
}

function deriveAxis(axes: Array<ContaminationResult["axis"]>): ContaminationResult["axis"] {
  const normalizedAxes = new Set(axes.filter((axis): axis is NonNullable<ContaminationResult["axis"]> => axis !== null))

  if (normalizedAxes.has("coi+severance") || (normalizedAxes.has("coi") && normalizedAxes.has("severance"))) {
    return "coi+severance"
  }

  if (normalizedAxes.has("coi")) return "coi"
  if (normalizedAxes.has("severance")) return "severance"
  if (normalizedAxes.has("framework")) return "framework"
  if (normalizedAxes.has("world")) return "world"
  return null
}

function getRecord(value: unknown, key: string): Record<string, unknown> {
  if (!isRecord(value) || !isRecord(value[key])) return {}
  return value[key]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

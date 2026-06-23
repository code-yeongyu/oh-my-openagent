import { log } from "../../shared"
import { computeAttribution, computeAttributionCriteria } from "./attribution-engine"
import { splitCertainty } from "./certainty-splitter"
import { enforceSelectedPolicyCompleteness } from "./completeness-enforcer"
import { buildConsequenceGraph } from "./consequence-graph"
import { classifyCatastrophicRisk } from "./catastrophic-risk-classifier"
import { applyCatastrophicGate } from "./catastrophic-risk-gate"
import { detectContamination } from "./contamination-detector"
import { assemblePolicyBundle } from "./policy-bundle-assembler"
import { selectPolicyBundle } from "./bundle-selector"
import {
  deriveDeliberativeTriples,
  deriveExtendedPolicyStatus,
  deriveFrameworkStatus,
  deriveImplementationStatus,
  deriveWorldStatus,
} from "./formalization"
import { classifyRecourse } from "./recourse-classifier"
import { buildRepairHumilityContext } from "./repair-humility-context"
import { assessRepairHumility } from "./repair-humility-reporter"
import { classifyConclusion, identifyDecisions } from "./decision-registry"
import { createDecisionSlot, filterByFeasibility, selectFromSlot } from "./feasibility-filter"
import { validateImplementationSafety } from "./implementation-safety-validator"
import { bindMitigations } from "./mitigation-binder"
import { liftNormativeProfile } from "./normative-lift"
import { composePolicy } from "./policy-composer"
import { buildConclusionStates, feasibilityConstraints, toCoreStatus } from "./sidecar-conclusion-state"
import { estimateVOI } from "./voi-estimator"
import type { ImplementationSafetyConclusionState } from "./safety-validation-types"
import type { DecisionProfile, SidecarInput, SidecarOutput } from "./types"

export function runConsequenceLiftingSidecar(input: SidecarInput): SidecarOutput {
  log("[consequence-sidecar] start", { sessionID: input.sessionID, callID: input.callID, processed: input.processed.length })
  const { states, contaminationResults } = buildConclusionStates({
    processed: input.processed,
    proofArtifact: input.proofArtifact,
    detectContamination,
  })

  log("[consequence-sidecar] identify-decisions", { conclusions: states.size })
  const decisions = identifyDecisions(new Map([...states.entries()].map(([conclusion, state]) => [conclusion, { status: state.status, tags: state.tags }])))

  log("[consequence-sidecar] build-graph", { decisions: decisions.length })
  const graph = buildConsequenceGraph(decisions, new Map([...states.entries()].map(([conclusion, state]) => [conclusion, { status: state.status, proofChain: state.proofChain, tags: state.tags }])), 3)
  graph.edges = graph.edges.map((edge) => {
    const target = states.get(edge.to)
    const attribution = computeAttributionCriteria(edge.from, edge.to, edge.relation, target?.status ?? "Undecided", target?.tags ?? [])
    return { ...edge, attribution, liftStrength: computeAttribution({ ...edge, attribution }) }
  })
  const classifications = new Map([...states.entries()].map(([conclusion, state]) => [conclusion, classifyCatastrophicRisk(conclusion, state.tags)]))
  const { gated: catastrophicGate, blocked: catastrophicBlocked } = applyCatastrophicGate(
    decisions,
    graph,
    classifications,
    { blockEnabled: input.catastrophicBlockEnabled === true },
  )

  log("[consequence-sidecar] feasibility", { decisions: decisions.length })
  const feasibility = filterByFeasibility(decisions, feasibilityConstraints(decisions, states))
  const slot = decisions.length > 1 ? createDecisionSlot("primary_decision", decisions, 1) : null
  const profiles = new Map<string, DecisionProfile>()

  for (const decision of decisions) {
    log("[consequence-sidecar] profile", { decision })
    const state = states.get(decision)
    const contamination = contaminationResults.find((result) => result.conclusion === decision)
    const certainty = state
      ? splitCertainty({
          proofChainKind: state.proofChainKind,
          extensionMembership: state.extensionMembership,
          proofChain: state.proofChain,
          tags: state.tags,
          contaminationLevel: contamination?.level,
          contaminationAxis: contamination?.axis,
        })
      : { framework_certainty: null, world_certainty: null }
    const { burdens, benefits } = liftNormativeProfile(decision, graph, new Map([...states.entries()].map(([key, state]) => [key, { status: state.status, pianoA: state.pianoA, combined: state.combined, tags: state.tags }])))
    const acceptedMitigations = [...states.entries()]
      .filter(([conclusion, state]) => classifyConclusion(conclusion, state.tags) === "mitigation" && state.status === "Accepted")
      .map(([conclusion]) => conclusion)
    const mitigations = bindMitigations(burdens, acceptedMitigations, graph)
    const requiredConditions = graph.edges
      .filter((edge) => edge.from === decision && classifyConclusion(edge.to, states.get(edge.to)?.tags ?? []) === "condition")
      .map((edge) => edge.to)
    const policy = composePolicy(decision, {
      decision,
      coreStatus: toCoreStatus(states.get(decision)?.status ?? "Undecided", states.get(decision)?.blocked ?? false),
      coreCombined: states.get(decision)?.combined ?? 0,
      framework_certainty: certainty.framework_certainty,
      world_certainty: certainty.world_certainty,
      catastrophicGated: catastrophicGate.get(decision) ?? false,
      forwardBurdens: burdens,
      forwardBenefits: benefits,
      mitigations,
      requiredConditions,
    }, slot, feasibility.get(decision)?.feasible ?? true)
    profiles.set(decision, policy.profile)
  }

  const policies = decisions
    .map((decision) => composePolicy(decision, {
      decision,
      coreStatus: profiles.get(decision)?.coreStatus ?? "undecided",
      coreCombined: profiles.get(decision)?.coreCombined ?? 0,
      framework_certainty: profiles.get(decision)?.framework_certainty ?? null,
      world_certainty: profiles.get(decision)?.world_certainty ?? null,
      catastrophicGated: profiles.get(decision)?.catastrophicGated ?? false,
      forwardBurdens: profiles.get(decision)?.forwardBurdens ?? [],
      forwardBenefits: profiles.get(decision)?.forwardBenefits ?? [],
      mitigations: profiles.get(decision)?.mitigations ?? [],
      requiredConditions: profiles.get(decision)?.requiredConditions ?? [],
    }, slot, feasibility.get(decision)?.feasible ?? true))
    .map((policy) => ({
      ...policy,
      implementationSafety: validateImplementationSafety(policy, new Map([...states.entries()].map(([conclusion, state]) => [conclusion, {
        status: state.status,
        blocked: state.blocked,
        tags: state.tags,
        proofChain: state.proofChain,
      } satisfies ImplementationSafetyConclusionState]))),
    }))
  const policiesWithCompleteness = policies.map((policy) => ({
    ...policy,
    completeness: enforceSelectedPolicyCompleteness(policy, {
      graph,
      slot,
      policies,
    }),
  }))
    .sort((left, right) => right.profile.coreCombined - left.profile.coreCombined)

  const tagsByDecision = new Map(decisions.map((decision) => [decision, states.get(decision)?.tags ?? []]))
  const bundle = assemblePolicyBundle(policiesWithCompleteness, tagsByDecision)
  const bundleSelection = selectPolicyBundle(bundle, policiesWithCompleteness)
  const selection = slot ? selectFromSlot(slot, profiles, policiesWithCompleteness) : { selected: decisions[0] ?? null, excluded: [] }
  const selectedDecision = slot
    ? Object.values(bundleSelection.selectedBySlot).flat()[0]
    : selection.selected ?? undefined
  const selectedProfile = selectedDecision ? profiles.get(selectedDecision) : undefined
  const voiResult = selectedProfile
    ? estimateVOI(selectedProfile, 1 - selectedProfile.coreCombined, classifyRecourse(selectedProfile))
    : undefined
  if (voiResult) {
    bundleSelection.voi = voiResult
    log("[consequence-sidecar] voi", {
      sessionID: input.sessionID,
      callID: input.callID,
      selectedDecision,
      score: voiResult.score,
      deferRecommended: voiResult.deferRecommended,
      recourseLevel: voiResult.recourseLevel,
      reasons: voiResult.reasons,
    })
  }
  if (slot) log("[consequence-sidecar] slot-selection", selection)
  log("[consequence-sidecar] bundle-selection", bundleSelection)

  const selectedDecisions = slot
    ? Object.values(bundleSelection.selectedBySlot).flat()
    : selection.selected ? [selection.selected] : []
  const finalizedPolicies = policiesWithCompleteness.map((policy) => ({
    ...policy,
    formalization: {
      frameworkStatus: deriveFrameworkStatus(policy),
      worldStatus: deriveWorldStatus(policy),
      implementationStatus: deriveImplementationStatus(policy.implementationSafety),
      extendedStatus: deriveExtendedPolicyStatus(policy, policy.completeness),
      triples: deriveDeliberativeTriples(policy),
    },
  }))
  const selectedFinalPolicies = finalizedPolicies.filter((policy) => selectedDecisions.includes(policy.primaryDecision))
  const selectedFinalPolicy = selectedFinalPolicies[0]
  const noSelectableBundleDerived = hasAcceptedConclusion(input.proofArtifact, "no_selectable_bundle")
    || (selectedDecisions.length === 0 && finalizedPolicies.length > 0)
  const humilityReport = noSelectableBundleDerived
    ? {
        capacity: "irreparable" as const,
        escalationReasons: [{ code: "no_selectable_bundle", message: "No policy bundle remains selectable after gating and constraints" }],
        summary: "irreparable: No policy bundle remains selectable after gating and constraints",
      }
    : assessRepairHumility(
        selectedFinalPolicy?.completeness,
        selectedFinalPolicy?.implementationSafety,
        voiResult,
        buildRepairHumilityContext({
          proofArtifact: input.proofArtifact,
          selectedPolicy: selectedFinalPolicy,
          selectedDecision,
        }),
      )
  log("[consequence-sidecar] humility", {
    sessionID: input.sessionID,
    callID: input.callID,
    capacity: humilityReport.capacity,
    escalationReasons: humilityReport.escalationReasons,
  })

  return {
    policies: finalizedPolicies,
    profiles: [...profiles.values()],
    graph,
    catastrophic: { classifications: [...classifications.values()], blocked: catastrophicBlocked },
    bundle: { bundle, selection: bundleSelection },
    contamination: { results: contaminationResults },
    voi: voiResult ? { result: voiResult } : undefined,
    humility: { report: humilityReport },
  }
}

function hasAcceptedConclusion(proofArtifact: unknown, targetConclusion: string): boolean {
  const result = getRecord(proofArtifact, "result")
  const conclusions = getRecord(result, "conclusions")
  if (isRecord(conclusions[targetConclusion]) && conclusions[targetConclusion].status === "Accepted") {
    return true
  }

  const extensions = Array.isArray(result.extensions) ? result.extensions : []
  return extensions.some((extension) => isRecord(extension)
    && Array.isArray(extension.accepted_conclusions)
    && extension.accepted_conclusions.includes(targetConclusion))
}

function getRecord(value: unknown, key: string): Record<string, unknown> {
  if (!isRecord(value) || !isRecord(value[key])) return {}
  return value[key]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

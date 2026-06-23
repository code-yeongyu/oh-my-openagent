import { existsSync } from "node:fs"
import { basename, dirname, extname, relative, resolve } from "node:path"
import { isAllowedFile } from "../prometheus-md-only/path-policy"
import type { CandidateAction, PolicyVerdict } from "./types"
import type {
  ReasoningCoreClient,
  ReasoningCoreConstraintRequest,
  ReasoningCoreSolveProblem,
} from "./reasoning-core-client"
import { isReasoningCoreInfrastructureError } from "./reasoning-core-infrastructure-error"
import type { InfrastructureFailMode } from "./hook"

const PROMETHEUS_AGENT_KEY = "prometheus"
const PLAN_GATE_NAMES = [
  "research_completed",
  "user_intent_clear",
  "scope_bounded",
  "codebase_explored",
  "no_blocking_questions",
  "dependencies_identified",
] as const

type PlanGateName = typeof PLAN_GATE_NAMES[number]
type MutationKind = "write" | "edit"

type PlanWritePrerequisites = Record<PlanGateName, boolean> & {
  requirementsText: string
  researchText: string
  scopeText: string
  planPath: string
  draftPath: string
  planName: string
  planDirectory: string
}

export function isPrometheusPlanWriteGateCandidate(candidate: CandidateAction, workspaceRoot: string): boolean {
  if (candidate.agent !== PROMETHEUS_AGENT_KEY) return false
  if (!isPlanMutationTool(candidate.tool)) return false

  const filePath = getCandidateFilePath(candidate)
  if (!filePath || !isAllowedFile(filePath, workspaceRoot)) return false

  return /(^|[/\\])\.sisyphus[/\\]plans[/\\]/i.test(relative(workspaceRoot, resolve(workspaceRoot, filePath)))
}

export async function evaluatePrometheusPlanWriteGate(input: {
  client: ReasoningCoreClient
  candidate: CandidateAction
  callID: string
  workspaceRoot: string
  toolHistory: CandidateAction[]
  mutationKind: MutationKind
  infrastructureFailMode?: InfrastructureFailMode
}): Promise<PolicyVerdict> {
  const { client, candidate, callID, workspaceRoot, toolHistory, mutationKind } = input
  const failMode: InfrastructureFailMode = input.infrastructureFailMode ?? "open"
  const sessionKey = `plan-write-gate:${candidate.sessionID}:${callID}`

  try {
    if (mutationKind === "edit") {
      return await evaluatePrometheusPlanEditGate({ candidate, workspaceRoot })
    }

    const prerequisites = await readPrerequisites(candidate, workspaceRoot)
    const missing = PLAN_GATE_NAMES.filter(name => !prerequisites[name])
    const kbResult = await client.kbQuery({
      content_type: "insight",
      keyword: "",
      layer: "Learned",
      similarity_query: [prerequisites.requirementsText, prerequisites.researchText, prerequisites.scopeText].filter(Boolean).join("\n"),
      tags: ["planning"],
    })

    for (const request of buildPlanWriteConstraints(prerequisites)) {
      await client.constrain(sessionKey, request)
    }

    const planningStatus = await client.status(sessionKey)
    if (!planningStatus.session_active) {
      return { allow: false, reason: "planning write session did not initialize", proofArtifact: { kbResult, planningStatus, missing } }
    }

    const outcome = await client.solve(buildPlanWriteSolveProblem({
      candidate,
      prerequisites,
      kbEntries: kbResult.entries,
      toolHistory,
    }))
    const allowAccepted = outcome.argumentation_result?.conclusions?.["allow_action(current)"]?.status === "Accepted"
    if (allowAccepted) {
      return {
        allow: true,
        proofArtifact: {
          kbResult,
          planningStatus,
          outcome,
          mutationKind,
          evidence: buildEvidenceSummary(toolHistory, prerequisites),
        },
      }
    }

    return {
      allow: false,
      reason: missing.length > 0 ? `missing prerequisites: ${missing.join(", ")}` : "plan write gate returned no accepted allow_action(current)",
      proofArtifact: {
        kbResult,
        planningStatus,
        outcome,
        missing,
        mutationKind,
        evidence: buildEvidenceSummary(toolHistory, prerequisites),
      },
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    if (isReasoningCoreInfrastructureError(reason)) {
      if (failMode === "closed") {
        return {
          allow: false,
          reason: `Plan write gate infrastructure failure (fail-closed): ${reason}. Set reasoning_core.infrastructure_fail_mode='open' to allow degraded operation.`,
          proofArtifact: { fallbackAllow: false, reason, failMode: "closed" },
        }
      }
      return { allow: true, proofArtifact: { fallbackAllow: true, reason } }
    }

    return { allow: false, reason }
  } finally {
    client.disposeSession(sessionKey)
  }
}

function buildPlanWriteConstraints(prerequisites: PlanWritePrerequisites): ReasoningCoreConstraintRequest[] {
  return [
    { variables: PLAN_GATE_NAMES.map(name => ({ name, domain: [0, 1] })) },
    ...PLAN_GATE_NAMES.map(name => ({ constraint: { Equals: { variable: name, value: prerequisites[name] ? 1 : 0 } }, question: name }))
  ]
}

function buildPlanWriteSolveProblem(input: {
  candidate: CandidateAction
  prerequisites: PlanWritePrerequisites
  kbEntries: Array<Record<string, unknown>>
  toolHistory: CandidateAction[]
}): ReasoningCoreSolveProblem {
  const { candidate, prerequisites, kbEntries, toolHistory } = input
  const initialConstraints = buildPlanWriteConstraints(prerequisites)
    .slice(1)
    .map(request => ({ constraint: request.constraint ?? {}, question: request.question }))
  const kbObservedPrereqs = extractKbObservedPrerequisites(kbEntries)
  const evidenceSummary = buildEvidenceSummary(toolHistory, prerequisites)
  const premises = PLAN_GATE_NAMES.flatMap(name => buildPrerequisitePremises(name, prerequisites[name], evidenceSummary.unverified.includes(name)))
  const kbPremises = kbObservedPrereqs.map(name => ({ formula: `kb_observed_${name}(current)`, kind: "ordinary" as const }))
  const kbRules = kbObservedPrereqs.map(name => ({
    id: `kb-support-${name}`,
    antecedents: [`kb_observed_${name}(current)`],
    consequent: "allow_action(current)",
  }))
  const claimRules = evidenceSummary.unverified.includes("codebase_explored")
    ? [{
        id: "claim-support-codebase_explored",
        antecedents: ["claimed_codebase_explored(current)"],
        consequent: "codebase_explored(current)",
      }]
    : []

  return {
    description: `Prometheus plan write gate for session ${candidate.sessionID}`,
    variables: PLAN_GATE_NAMES.map(name => ({ name, domain: [0, 1] })),
    initial_constraints: initialConstraints,
    incremental_constraints: [],
    max_iterations: 1,
    theory: {
      premises: [
        ...premises,
        ...kbPremises,
        ...(kbEntries.length > 0 ? [{ formula: "kb_context_found(current)", kind: "ordinary" as const }] : []),
      ],
      strict_rules: [{
        id: "plan-write-allow",
        antecedents: PLAN_GATE_NAMES.map(name => `${name}(current)`),
        consequent: "allow_action(current)",
      }],
      defeasible_rules: [...claimRules, ...kbRules],
      preferences: [],
      classical_negation: true,
    },
  }
}

function buildPrerequisitePremises(
  name: PlanGateName,
  satisfied: boolean,
  unverified: boolean,
): Array<{ formula: string; kind: "ordinary" }> {
  if (!satisfied) return []
  if (name === "codebase_explored" && unverified) {
    return [{ formula: "claimed_codebase_explored(current)", kind: "ordinary" }]
  }

  return [{ formula: `${name}(current)`, kind: "ordinary" }]
}

function extractKbObservedPrerequisites(entries: Array<Record<string, unknown>>): string[] {
  const names = new Set<string>()

  for (const entry of entries) {
    const tags = Array.isArray(entry.tags) ? entry.tags : []
    for (const tag of tags) {
      if (typeof tag === "string" && tag.startsWith("prereq:")) {
        names.add(sanitizePredicateName(tag.slice("prereq:".length)))
      }
    }

    const content = isRecord(entry.content) ? entry.content : undefined
    const insight = content && isRecord(content.Insight) ? content.Insight : undefined
    const lesson = typeof insight?.lesson === "string" ? insight.lesson : ""
    const matches = lesson.match(/additional prerequisites?:\s*([a-z0-9_, -]+)/i)
    if (!matches) continue

    for (const rawName of matches[1].split(/[;,]/)) {
      const normalized = sanitizePredicateName(rawName.trim())
      if (normalized) names.add(normalized)
    }
  }

  return [...names]
}

function sanitizePredicateName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "")
}

function buildEvidenceSummary(toolHistory: CandidateAction[], prerequisites: PlanWritePrerequisites): {
  verified: PlanGateName[]
  unverified: PlanGateName[]
} {
  const verified = new Set<PlanGateName>()
  const unverified = new Set<PlanGateName>()

  if (prerequisites.codebase_explored) {
    if (hasCodebaseExplorationEvidence(toolHistory)) {
      verified.add("codebase_explored")
    } else {
      unverified.add("codebase_explored")
    }
  }

  return {
    verified: [...verified],
    unverified: [...unverified],
  }
}

function hasCodebaseExplorationEvidence(toolHistory: CandidateAction[]): boolean {
  return toolHistory.some(action => {
    const tool = action.tool.toLowerCase()
    if (["read", "glob", "grep", "ast_grep_search", "lsp_symbols", "lsp_find_references", "lsp_goto_definition"].includes(tool)) {
      return true
    }

    return tool === "task" && action.context?.subagentType === "explore"
  })
}

async function evaluatePrometheusPlanEditGate(input: {
  candidate: CandidateAction
  workspaceRoot: string
}): Promise<PolicyVerdict> {
  const { candidate, workspaceRoot } = input
  const planPath = resolve(workspaceRoot, getCandidateFilePath(candidate) ?? "")
  const existingPlanText = existsSync(planPath) ? await Bun.file(planPath).text() : ""
  if (!existingPlanText) {
    return { allow: false, reason: "edit-path structural check requires an existing plan" }
  }

  const candidatePlanText = buildEditedPlanText(existingPlanText, candidate)
  const removedHeadings = ["### Interview Summary", "### Metis Review", "## Work Objectives", "### Must NOT Have"]
    .filter(heading => existingPlanText.includes(heading) && !candidatePlanText.includes(heading))
  const hasWaveStructure = /\bWave\s+(?:\d+|FINAL)\b/i.test(candidatePlanText)

  if (!hasWaveStructure) {
    return {
      allow: false,
      reason: "edit-path structural check failed: plan wave structure was removed",
      proofArtifact: { mutationKind: "edit", structuralCheck: { removedHeadings, hasWaveStructure } },
    }
  }

  if (removedHeadings.length > 0) {
    return {
      allow: false,
      reason: `edit-path structural check failed: required sections removed (${removedHeadings.join(", ")})`,
      proofArtifact: { mutationKind: "edit", structuralCheck: { removedHeadings, hasWaveStructure } },
    }
  }

  return {
    allow: true,
    proofArtifact: { mutationKind: "edit", structuralCheck: { removedHeadings, hasWaveStructure } },
  }
}

function buildEditedPlanText(existingPlanText: string, candidate: CandidateAction): string {
  const oldString = typeof candidate.args.oldString === "string" ? candidate.args.oldString : ""
  const newString = typeof candidate.args.newString === "string" ? candidate.args.newString : ""

  if (oldString && existingPlanText.includes(oldString)) {
    return existingPlanText.replace(oldString, newString)
  }

  return `${existingPlanText}\n${newString}`
}

async function readPrerequisites(candidate: CandidateAction, workspaceRoot: string): Promise<PlanWritePrerequisites> {
  const planPath = resolve(workspaceRoot, getCandidateFilePath(candidate) ?? "")
  const relativePath = relative(workspaceRoot, planPath)
  const draftPath = resolve(workspaceRoot, relativePath.replace(/\.sisyphus([/\\])plans([/\\])/i, ".sisyphus$1drafts$2"))
  const draftContent = existsSync(draftPath) ? await Bun.file(draftPath).text() : ""
  const planText = [
    existsSync(planPath) ? await Bun.file(planPath).text() : "",
    typeof candidate.args.content === "string" ? candidate.args.content : "",
    typeof candidate.args.newString === "string" ? candidate.args.newString : "",
  ].filter(Boolean).join("\n")
  const requirementsText = getSection(draftContent, "## Requirements (confirmed)")
  const researchText = getSection(draftContent, "## Research Findings")
  const openQuestionsText = getSection(draftContent, "## Open Questions")
  const scopeText = getSection(draftContent, "## Scope Boundaries")
  const technicalDecisionsText = getSection(draftContent, "## Technical Decisions")
  const metisText = getSection(planText, "### Metis Review")

  return {
    research_completed: hasSubstantiveText(metisText) && !/placeholder/i.test(metisText),
    user_intent_clear: hasSubstantiveText(requirementsText),
    scope_bounded: hasScopeBoundaries(scopeText),
    codebase_explored: /src\/|\.[cm]?[jt]sx?\b|\.md\b|`[^`]+`/i.test(researchText),
    no_blocking_questions: isOpenQuestionSectionResolved(openQuestionsText),
    dependencies_identified: hasDependencies(technicalDecisionsText, researchText),
    requirementsText,
    researchText,
    scopeText,
    planPath,
    draftPath,
    planName: basename(planPath, extname(planPath)),
    planDirectory: dirname(planPath),
  }
}

function isPlanMutationTool(tool: string): boolean {
  const normalized = tool.toLowerCase()
  return normalized === "write" || normalized === "edit"
}

function getCandidateFilePath(candidate: CandidateAction): string | undefined {
  const path = candidate.args.filePath ?? candidate.args.path ?? candidate.args.file
  return typeof path === "string" ? path : undefined
}

function getSection(content: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = content.match(new RegExp(`${escaped}[\r\n]+([\\s\\S]*?)(?:\n## |\n### |$)`, "i"))
  return match?.[1]?.trim() ?? ""
}

function hasSubstantiveText(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  return normalized.length > 0 && normalized !== "- none" && normalized !== "none" && !normalized.includes("[placeholder]")
}

function hasScopeBoundaries(value: string): boolean {
  return /include:\s*.+/i.test(value) && /exclude:\s*.+/i.test(value)
}

function isOpenQuestionSectionResolved(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  return normalized.length === 0 || normalized === "none" || normalized === "- none"
}

function hasDependencies(technicalDecisionsText: string, researchText: string): boolean {
  const combined = `${technicalDecisionsText}\n${researchText}`.toLowerCase()
  return /dependenc|integration|library|sdk|service|api|database|none/.test(combined)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

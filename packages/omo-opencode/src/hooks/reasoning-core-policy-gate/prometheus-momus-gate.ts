import { existsSync, readFileSync } from "node:fs"
import { relative, resolve } from "node:path"
import type { CandidateAction, PolicyVerdict } from "./types"
import type {
  ReasoningCoreClient,
  ReasoningCoreConstraintRequest,
  ReasoningCoreSolveProblem,
} from "./reasoning-core-client"

const PROMETHEUS_AGENT_KEY = "prometheus"
const MOMUS_SUBAGENT = "momus"
const MOMUS_GATE_NAMES = [
  "plan_file_referenced",
  "plan_content_present",
  "review_scope_clear",
  "plan_generation_completed",
] as const

type MomusGateName = typeof MOMUS_GATE_NAMES[number]

type MomusReviewContext = Record<MomusGateName, boolean> & {
  planPrompt: string
  planPath: string
  planContent: string
}

export function isPrometheusMomusGateCandidate(candidate: CandidateAction): boolean {
  return candidate.tool === "task"
    && candidate.agent === PROMETHEUS_AGENT_KEY
    && candidate.context?.subagentType === MOMUS_SUBAGENT
}

export async function evaluatePrometheusMomusGate(input: {
  client: ReasoningCoreClient
  candidate: CandidateAction
  callID: string
  workspaceRoot: string
  toolHistory: CandidateAction[]
}): Promise<PolicyVerdict> {
  const { client, candidate, callID, workspaceRoot, toolHistory } = input
  const review = readMomusReviewContext(candidate, workspaceRoot)
  const missing = MOMUS_GATE_NAMES.filter(name => !review[name])
  const sessionKey = `momus-gate:${candidate.sessionID}:${callID}`

  if (!review.plan_file_referenced || !review.review_scope_clear || !review.plan_content_present) {
    const reason = !review.plan_file_referenced
      ? "momus review request must reference exactly one plan file under .sisyphus/plans/*.md"
      : !review.review_scope_clear
        ? "momus review scope is unclear; provide only the plan path"
        : "referenced plan file is not reviewable"

    return {
      allow: false,
      reason,
      proofArtifact: { review, missing },
    }
  }

  try {
    const kbResult = await client.kbQuery({
      content_type: "insight",
      keyword: "",
      layer: "Learned",
      similarity_query: review.planPath,
      tags: ["planning", "review"],
    })

    for (const request of buildMomusConstraints(review)) {
      await client.constrain(sessionKey, request)
    }

    const planningStatus = await client.status(sessionKey)
    if (!planningStatus.session_active) {
      return { allow: false, reason: "momus review session did not initialize", proofArtifact: { kbResult, planningStatus, review } }
    }

    const outcome = await client.solve(buildMomusSolveProblem({
      candidate,
      review,
      kbEntries: kbResult.entries,
      toolHistory,
    }))
    const allowAccepted = outcome.argumentation_result?.conclusions?.["allow_action(current)"]?.status === "Accepted"

    if (!allowAccepted) {
      return {
        allow: false,
        reason: missing.length > 0 ? `missing prerequisites: ${missing.join(", ")}` : "momus gate returned no accepted allow_action(current)",
        proofArtifact: {
          kbResult,
          planningStatus,
          outcome,
          review,
          evidence: buildMomusEvidenceSummary(toolHistory, review),
        },
      }
    }

    return {
      allow: true,
      proofArtifact: {
        kbResult,
        planningStatus,
        outcome,
        review,
        evidence: buildMomusEvidenceSummary(toolHistory, review),
      },
    }
  } catch (error) {
    return { allow: false, reason: error instanceof Error ? error.message : String(error) }
  } finally {
    client.disposeSession(sessionKey)
  }
}

function buildMomusConstraints(review: MomusReviewContext): ReasoningCoreConstraintRequest[] {
  return [
    { variables: MOMUS_GATE_NAMES.map(name => ({ name, domain: [0, 1] })) },
    ...MOMUS_GATE_NAMES.map(name => ({
      constraint: { Equals: { variable: name, value: review[name] ? 1 : 0 } },
      question: name,
    })),
  ]
}

function buildMomusSolveProblem(input: {
  candidate: CandidateAction
  review: MomusReviewContext
  kbEntries: Array<Record<string, unknown>>
  toolHistory: CandidateAction[]
}): ReasoningCoreSolveProblem {
  const { candidate, review, kbEntries, toolHistory } = input
  const initialConstraints = buildMomusConstraints(review)
    .slice(1)
    .map(request => ({ constraint: request.constraint ?? {}, question: request.question }))
  const kbObservedPrereqs = extractKbObservedPrerequisites(kbEntries)
  const evidence = buildMomusEvidenceSummary(toolHistory, review)
  const premises = [
    ...(review.plan_file_referenced ? [{ formula: "plan_file_referenced(current)", kind: "ordinary" as const }] : []),
    ...(review.plan_content_present ? [{ formula: "plan_content_present(current)", kind: "ordinary" as const }] : []),
    ...(review.review_scope_clear ? [{ formula: "review_scope_clear(current)", kind: "ordinary" as const }] : []),
    ...buildPlanGenerationPremises(review.plan_generation_completed, evidence.unverified.includes("plan_generation_completed")),
  ]
  const kbPremises = kbObservedPrereqs.map(name => ({ formula: `kb_observed_${name}(current)`, kind: "ordinary" as const }))
  const kbRules = kbObservedPrereqs.map(name => ({
    id: `kb-support-${name}`,
    antecedents: [`kb_observed_${name}(current)`],
    consequent: "allow_action(current)",
  }))
  const claimRules = evidence.unverified.includes("plan_generation_completed")
    ? [{
        id: "claim-support-plan_generation_completed",
        antecedents: ["claimed_plan_generation_completed(current)"],
        consequent: "plan_generation_completed(current)",
      }]
    : []

  return {
    description: `Prometheus Momus review gate for session ${candidate.sessionID}`,
    variables: MOMUS_GATE_NAMES.map(name => ({ name, domain: [0, 1] })),
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
        id: "momus-review-allow",
        antecedents: MOMUS_GATE_NAMES.map(name => `${name}(current)`),
        consequent: "allow_action(current)",
      }],
      defeasible_rules: [...claimRules, ...kbRules],
      preferences: [],
      classical_negation: true,
    },
  }
}

function buildPlanGenerationPremises(
  planGenerationCompleted: boolean,
  unverified: boolean,
): Array<{ formula: string; kind: "ordinary" }> {
  if (!planGenerationCompleted) return []
  if (unverified) {
    return [{ formula: "claimed_plan_generation_completed(current)", kind: "ordinary" }]
  }

  return [{ formula: "plan_generation_completed(current)", kind: "ordinary" }]
}

function readMomusReviewContext(candidate: CandidateAction, workspaceRoot: string): MomusReviewContext {
  const prompt = typeof candidate.args.prompt === "string" ? candidate.args.prompt.trim() : ""
  const planPaths = [...prompt.matchAll(/\.sisyphus\/plans\/[^\s`]+\.md/gi)].map(match => match[0])
  const planPath = planPaths.length === 1 ? resolve(workspaceRoot, planPaths[0]) : ""
  const planContent = planPath && existsSync(planPath) ? readFileSync(planPath, "utf8") : ""
  const reviewScopeClear = planPaths.length === 1 && prompt === planPaths[0]

  return {
    plan_file_referenced: planPaths.length === 1,
    plan_content_present: isReviewablePlanContent(planContent),
    review_scope_clear: reviewScopeClear,
    plan_generation_completed: planPaths.length === 1,
    planPrompt: prompt,
    planPath,
    planContent,
  }
}

function isReviewablePlanContent(planContent: string): boolean {
  const trimmed = planContent.trim()
  if (trimmed.length < 40) return false

  return /#\s+/m.test(planContent) && /(##\s+|Wave\s+\d+)/m.test(planContent)
}

function extractKbObservedPrerequisites(entries: Array<Record<string, unknown>>): string[] {
  const names = new Set<string>()

  for (const entry of entries) {
    const tags = Array.isArray(entry.tags) ? entry.tags : []
    for (const tag of tags) {
      if (typeof tag === "string" && tag.startsWith("review_prereq:")) {
        names.add(sanitizePredicateName(tag.slice("review_prereq:".length)))
      }
    }
  }

  return [...names]
}

function sanitizePredicateName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "")
}

function buildMomusEvidenceSummary(
  toolHistory: CandidateAction[],
  review: MomusReviewContext,
): {
  verified: Array<"plan_generation_completed">
  unverified: Array<"plan_generation_completed">
} {
  const verified = new Set<"plan_generation_completed">()
  const unverified = new Set<"plan_generation_completed">()

  if (review.plan_generation_completed) {
    if (hasPlanGenerationEvidence(toolHistory)) {
      verified.add("plan_generation_completed")
    } else {
      unverified.add("plan_generation_completed")
    }
  }

  return {
    verified: [...verified],
    unverified: [...unverified],
  }
}

function hasPlanGenerationEvidence(toolHistory: CandidateAction[]): boolean {
  return toolHistory.some(action => {
    const tool = action.tool.toLowerCase()
    if (!(["write", "edit"].includes(tool))) return false

    const filePath = typeof action.args.filePath === "string"
      ? action.args.filePath
      : typeof action.args.path === "string"
        ? action.args.path
        : ""

    return /(^|[/\\])\.sisyphus[/\\]plans[/\\].+\.md$/i.test(filePath)
  })
}

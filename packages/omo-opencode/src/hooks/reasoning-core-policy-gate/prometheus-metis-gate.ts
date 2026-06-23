import type { CandidateAction, PolicyVerdict } from "./types"
import type {
  ReasoningCoreClient,
  ReasoningCoreConstraintRequest,
  ReasoningCoreSolveProblem,
} from "./reasoning-core-client"

const PROMETHEUS_AGENT_KEY = "prometheus"
const METIS_SUBAGENT = "metis"
const PLANNING_SECTION_PATTERNS = {
  goal: [/\*\*User's Goal\*\*:\s*(.+)/i, /\*\*Goal\*\*:\s*(.+)/i],
  discussed: [/\*\*What We Discussed\*\*:\s*(.+)/i, /\*\*Discussed\*\*:\s*(.+)/i],
  understanding: [/\*\*My Understanding\*\*:\s*(.+)/i],
  research: [/\*\*Research Findings\*\*:\s*(.+)/i, /\*\*Research\*\*:\s*(.+)/i],
} as const

export function isPrometheusPlanningGateCandidate(candidate: CandidateAction): boolean {
  return candidate.tool === "task"
    && candidate.agent === PROMETHEUS_AGENT_KEY
    && candidate.context?.subagentType === METIS_SUBAGENT
}

export async function evaluatePrometheusPlanningGate(input: {
  client: ReasoningCoreClient
  candidate: CandidateAction
  callID: string
  toolHistory: CandidateAction[]
}): Promise<PolicyVerdict> {
  const { client, candidate, callID, toolHistory } = input
  const prompt = typeof candidate.args.prompt === "string" ? candidate.args.prompt : ""
  const sections = extractPlanningSections(prompt)
  const sessionKey = `planning-gate:${candidate.sessionID}:${callID}`

  try {
    const kbResult = await client.kbQuery({
      content_type: "insight",
      keyword: "",
      layer: "Learned",
      similarity_query: [sections.goal, sections.understanding].filter(Boolean).join("\n"),
      tags: ["planning", "metis"],
    })

    for (const request of buildPlanningConstraints(sections)) {
      await client.constrain(sessionKey, request)
    }

    const planningStatus = await client.status(sessionKey)
    if (!planningStatus.session_active) {
      return { allow: false, reason: "planning session did not initialize", proofArtifact: { kbResult, planningStatus } }
    }

    const outcome = await client.solve(buildPlanningSolveProblem({
      candidate,
      sections,
      kbEntries: kbResult.entries,
      toolHistory,
    }))
    const allowAccepted = outcome.argumentation_result?.conclusions?.["allow_action(current)"]?.status === "Accepted"

    if (!allowAccepted) {
      return {
        allow: false,
        reason: "planning gate returned no accepted allow_action(current)",
        proofArtifact: {
          kbResult,
          planningStatus,
          outcome,
          sections,
          evidence: buildPlanningEvidenceSummary(toolHistory, sections),
        },
      }
    }

    return {
      allow: true,
      proofArtifact: {
        kbResult,
        planningStatus,
        outcome,
        sections,
        evidence: buildPlanningEvidenceSummary(toolHistory, sections),
      },
    }
  } catch (error) {
    return { allow: false, reason: error instanceof Error ? error.message : String(error) }
  } finally {
    client.disposeSession(sessionKey)
  }
}

function extractPlanningSections(prompt: string) {
  return {
    goal: extractSection(prompt, PLANNING_SECTION_PATTERNS.goal),
    discussed: extractSection(prompt, PLANNING_SECTION_PATTERNS.discussed),
    understanding: extractSection(prompt, PLANNING_SECTION_PATTERNS.understanding),
    research: extractSection(prompt, PLANNING_SECTION_PATTERNS.research),
  }
}

function extractSection(prompt: string, patterns: readonly RegExp[]): string {
  for (const pattern of patterns) {
    const value = prompt.match(pattern)?.[1]?.trim()
    if (value) return value
  }

  return ""
}

function buildPlanningConstraints(sections: ReturnType<typeof extractPlanningSections>): ReasoningCoreConstraintRequest[] {
  return [
    { variables: [
      { name: "goal_present", domain: [0, 1] },
      { name: "discussion_present", domain: [0, 1] },
      { name: "understanding_present", domain: [0, 1] },
      { name: "research_present", domain: [0, 1] },
    ] },
    { constraint: { Equals: { variable: "goal_present", value: sections.goal ? 1 : 0 } }, question: "goal presence" },
    { constraint: { Equals: { variable: "discussion_present", value: sections.discussed ? 1 : 0 } }, question: "discussion presence" },
    { constraint: { Equals: { variable: "understanding_present", value: sections.understanding ? 1 : 0 } }, question: "understanding presence" },
    { constraint: { Equals: { variable: "research_present", value: sections.research ? 1 : 0 } }, question: "research presence" },
  ]
}

function buildPlanningSolveProblem(input: {
  candidate: CandidateAction
  sections: ReturnType<typeof extractPlanningSections>
  kbEntries: Array<Record<string, unknown>>
  toolHistory: CandidateAction[]
}): ReasoningCoreSolveProblem {
  const { candidate, sections, kbEntries, toolHistory } = input
  const initialConstraints = buildPlanningConstraints(sections)
    .slice(1)
    .map(request => ({ constraint: request.constraint ?? {}, question: request.question }))
  const kbObservedPrereqs = extractKbObservedPrerequisites(kbEntries)
  const evidenceSummary = buildPlanningEvidenceSummary(toolHistory, sections)
  const premises = [
    ...(sections.goal ? [{ formula: "goal_present(current)", kind: "ordinary" as const }] : []),
    ...(sections.discussed ? [{ formula: "discussion_present(current)", kind: "ordinary" as const }] : []),
    ...(sections.understanding ? [{ formula: "understanding_present(current)", kind: "ordinary" as const }] : []),
    ...buildResearchPremises(sections.research, evidenceSummary.unverified.includes("research_present")),
  ]
  const kbPremises = kbObservedPrereqs.map(name => ({ formula: `kb_observed_${name}(current)`, kind: "ordinary" as const }))
  const kbRules = kbObservedPrereqs.map(name => ({
    id: `kb-support-${name}`,
    antecedents: [`kb_observed_${name}(current)`],
    consequent: "allow_action(current)",
  }))
  const claimRules = evidenceSummary.unverified.includes("research_present")
    ? [{
        id: "claim-support-research_present",
        antecedents: ["claimed_research_present(current)"],
        consequent: "research_present(current)",
      }]
    : []

  return {
    description: `Prometheus planning gate for session ${candidate.sessionID}`,
    variables: [
      { name: "goal_present", domain: [0, 1] },
      { name: "discussion_present", domain: [0, 1] },
      { name: "understanding_present", domain: [0, 1] },
      { name: "research_present", domain: [0, 1] },
    ],
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
        id: "planning-allow",
        antecedents: ["goal_present(current)", "discussion_present(current)", "understanding_present(current)", "research_present(current)"],
        consequent: "allow_action(current)",
      }],
      defeasible_rules: [...claimRules, ...kbRules],
      preferences: [],
      classical_negation: true,
    },
  }
}

function buildResearchPremises(research: string, unverified: boolean): Array<{ formula: string; kind: "ordinary" }> {
  if (!research) return []
  if (unverified) {
    return [{ formula: "claimed_research_present(current)", kind: "ordinary" }]
  }

  return [{ formula: "research_present(current)", kind: "ordinary" }]
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
    const matches = lesson.match(/additional (?:consultation )?(?:observations|prerequisites?):\s*([a-z0-9_, -]+)/i)
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

function buildPlanningEvidenceSummary(
  toolHistory: CandidateAction[],
  sections: ReturnType<typeof extractPlanningSections>,
): {
  verified: Array<"research_present">
  unverified: Array<"research_present">
} {
  const verified = new Set<"research_present">()
  const unverified = new Set<"research_present">()

  if (sections.research) {
    if (hasResearchEvidence(toolHistory)) {
      verified.add("research_present")
    } else {
      unverified.add("research_present")
    }
  }

  return {
    verified: [...verified],
    unverified: [...unverified],
  }
}

function hasResearchEvidence(toolHistory: CandidateAction[]): boolean {
  return toolHistory.some(action => {
    const tool = action.tool.toLowerCase()
    if (["read", "glob", "grep", "ast_grep_search", "lsp_symbols", "lsp_find_references", "lsp_goto_definition"].includes(tool)) {
      return true
    }

    return tool === "task" && action.context?.subagentType === "explore"
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

import type { CandidateAction } from "./types"
import type { ReasoningCoreClient, ReasoningCoreKbQueryResult } from "./reasoning-core-client"
import {
  clearChallenge,
  clearChallengeState,
  getChallenge,
  recordChallenge,
} from "./epistemic-interlock-challenge-state"
import type { InfrastructureFailMode } from "./hook"

const PROMETHEUS_AGENT_KEY = "prometheus"
const THEMIS_AGENT_KEY = "themis"
const MUTATION_TOOLS = ["write", "edit"]
const DELIBERATION_PATH_PATTERN = /(^|[/\\])\.sisyphus[/\\]deliberations[/\\].+\.md$/i

export interface EpistemicInterlockVerdict {
  allow: boolean
  reason?: string
  needsAdversarialCheck?: boolean
  kbEntries?: ReasoningCoreKbQueryResult["entries"]
}

export interface EpistemicInterlockGateConfig {
  epistemic_interlock_enabled?: boolean
  infrastructure_fail_mode?: InfrastructureFailMode
}

export function isEpistemicInterlockCandidate(candidate: CandidateAction): boolean {
  if (!MUTATION_TOOLS.includes(candidate.tool.toLowerCase())) return false
  if (candidate.agent === PROMETHEUS_AGENT_KEY) return false
  if (candidate.agent === THEMIS_AGENT_KEY) return false
  const filePath = extractCandidateFilePath(candidate.args)
  if (filePath && DELIBERATION_PATH_PATTERN.test(filePath)) return false
  return true
}

export async function evaluateEpistemicInterlockGate(input: {
  client: ReasoningCoreClient
  candidate: CandidateAction
  config?: EpistemicInterlockGateConfig
}): Promise<EpistemicInterlockVerdict> {
  const { client, candidate, config } = input

  if (config?.epistemic_interlock_enabled === false) {
    return { allow: true }
  }
  const failMode: InfrastructureFailMode = config?.infrastructure_fail_mode ?? "open"

  const filePath = extractCandidateFilePath(candidate.args)
  const challengePath = filePath ?? ""

  try {
    const existingChallenge = getChallenge(candidate.sessionID, challengePath)
    if (existingChallenge) {
      const counterKbResult = await client.kbQuery({
        similarity_query: `counter-argument proof ${filePath ?? ""}`,
        layer: "Learned",
        content_type: "insight",
        keyword: "",
        tags: [],
      })

      if (counterKbResult.count <= existingChallenge.kbEntriesCount) {
        return {
          allow: false,
          reason: formatChallengeMessage(existingChallenge.reason),
        }
      }
    }

    const kbResult = await client.kbQuery({
      similarity_query: filePath ? `architectural constraint ${filePath}` : "architectural constraint",
      layer: "Learned",
      content_type: "insight",
      keyword: "",
      tags: [],
    })

    if (!kbResult.entries || kbResult.entries.length === 0) {
      clearChallenge(candidate.sessionID, challengePath)
      return { allow: true }
    }

    const verdict = await client.evaluate({
      candidate,
      sessionContext: {
        theory_override: buildEpistemicInterlockTheory({
          candidate,
          kbEntries: kbResult.entries,
        }),
      },
    })

    if (!verdict.allow) {
      const challengeReason = `KB constraint defeats mutation on ${filePath ?? "unknown path"}: ${verdict.reason ?? "adversarial theory rejected"}`
      recordChallenge(candidate.sessionID, challengePath, challengeReason, kbResult.entries.length)
      return {
        allow: false,
        reason: formatChallengeMessage(challengeReason),
      }
    }

    clearChallenge(candidate.sessionID, challengePath)
    return { allow: true }
  } catch (err) {
    if (failMode === "closed") {
      const message = err instanceof Error ? err.message : String(err)
      return {
        allow: false,
        reason: `Epistemic interlock infrastructure failure (fail-closed): ${message}. Set reasoning_core.infrastructure_fail_mode='open' to allow degraded operation, or restore reasoning-core availability before retrying.`,
      }
    }
    return { allow: true }
  }
}

function buildEpistemicInterlockTheory(input: {
  candidate: CandidateAction
  kbEntries: Array<Record<string, unknown>>
}): Record<string, unknown> {
  const { candidate, kbEntries } = input
  const constraintTags = new Set<string>()
  const supportTags = new Set<string>()
  const preferredSupportTags = new Set<string>()
  const preferredConstraintTags = new Set<string>()

  for (const entry of kbEntries) {
    const tags = Array.isArray(entry.tags) ? entry.tags : []
    for (const tag of tags) {
      if (typeof tag !== "string") continue
      if (tag.startsWith("support:")) {
        const name = sanitizePredicateName(tag.slice("support:".length))
        if (name) supportTags.add(name)
        continue
      }
      if (tag.startsWith("constraint:")) {
        const name = sanitizePredicateName(tag.slice("constraint:".length))
        if (name) constraintTags.add(name)
        continue
      }
      if (tag.startsWith("prefer:support:")) {
        const name = sanitizePredicateName(tag.slice("prefer:support:".length))
        if (name) preferredSupportTags.add(name)
        continue
      }
      if (tag.startsWith("prefer:constraint:")) {
        const name = sanitizePredicateName(tag.slice("prefer:constraint:".length))
        if (name) preferredConstraintTags.add(name)
        continue
      }

    }
  }

  const mutationTool = sanitizePredicateName(candidate.tool) || "mutation"
  const premises = [
    { formula: "mutation_proposed(current)", kind: "ordinary" as const },
    { formula: `mutation_tool_${mutationTool}(current)`, kind: "ordinary" as const },
    ...[...supportTags].map(name => ({ formula: `kb_support_${name}(current)`, kind: "ordinary" as const })),
    ...[...constraintTags].map(name => ({ formula: `kb_constraint_${name}(current)`, kind: "ordinary" as const })),
    ...(kbEntries.length > 0 ? [{ formula: "kb_context_found(current)", kind: "ordinary" as const }] : []),
  ]

  const defeasibleRules = [
    ...[...supportTags].map(name => ({
      id: `kb-support-${name}`,
      antecedents: [`kb_support_${name}(current)`, "mutation_proposed(current)"],
      consequent: "allow_action(current)",
    })),
    ...[...constraintTags].map(name => ({
      id: `kb-constraint-${name}`,
      antecedents: [`kb_constraint_${name}(current)`, "mutation_proposed(current)"],
      consequent: "deny_action(current)",
    })),
  ]

  const preferences = [
    ...[...preferredSupportTags]
      .filter(name => supportTags.has(name) && constraintTags.has(name))
      .map(name => ({
        inferior: `kb-constraint-${name}`,
        superior: `kb-support-${name}`,
      })),
    ...[...preferredConstraintTags]
      .filter(name => supportTags.has(name) && constraintTags.has(name))
      .map(name => ({
        inferior: `kb-support-${name}`,
        superior: `kb-constraint-${name}`,
      })),
  ]

  return {
    premises,
    strict_rules: [],
    defeasible_rules: defeasibleRules,
    preferences,
    classical_negation: true,
  }
}

function sanitizePredicateName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "")
}

function extractCandidateFilePath(args: Record<string, unknown> | undefined): string | undefined {
  if (!args) return undefined
  const value = args.filePath ?? args.path ?? args.file ?? args.file_path
  return typeof value === "string" ? value : undefined
}

function formatChallengeMessage(reason: string): string {
  return `Epistemic Interlock: Write blocked. ${reason}. To proceed: call reason_argue with an ASPIC+ theory that produces an authorization conclusion such as mutation_authorized_on_unknown_path or allow_action(current). The proof will be automatically persisted to the Learned KB, then retry the Write. If the counter-theory is rejected, the block is legitimate.`
}

export { clearChallengeState }

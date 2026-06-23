import type { ConsequenceEpistemicState, ConsequenceGraph, ForwardBenefit, ForwardBurden } from "./types"

type ValenceSeverity = "mild" | "moderate" | "severe" | "critical"

interface ValenceEvent {
  polarity: "burden" | "benefit"
  severity: ValenceSeverity
  source: string
}

const VALENCE_TAG_PATTERN = /@valence:(harm|benefit):([^\s]+)/i
const VALID_VALENCE_SEVERITY_PATTERN = /^(mild|moderate|severe|critical)$/

function deriveEpistemicState(status: string, pianoA: string): ConsequenceEpistemicState {
  if (status === "Rejected") return "excluded"
  if (status === "Accepted" && pianoA === "plausibile") return "established"
  return "residual_live_risk"
}

function firstNormativeTag(tags: string[]): string {
  return tags.find((tag) => /^(legal|ethics|safety|value):/.test(tag)) ?? "unclassified"
}

function isGoodTerm(value: string): boolean {
  return /(saved|protected|prevent|preserved|benefit|stability|backup|safe|rescue|surviv)/i.test(value)
}

function isBadTerm(value: string): boolean {
  return /(violated|collapse|risk|harm|damage|injury|loss|death|exposure|sabotage|panic|erosion)/i.test(value)
}

function stripValenceTag(conclusion: string): string {
  return conclusion.replace(VALENCE_TAG_PATTERN, "").trim()
}

function classifyValenceFromTag(conclusion: string): ValenceEvent | null {
  const match = conclusion.match(VALENCE_TAG_PATTERN)
  if (!match) return null

  const [, rawPolarity, rawSeverity] = match
  if (!rawPolarity || !rawSeverity || !VALID_VALENCE_SEVERITY_PATTERN.test(rawSeverity)) return null

  return {
    polarity: rawPolarity === "harm" ? "burden" : "benefit",
    severity: rawSeverity as ValenceSeverity,
    source: conclusion,
  }
}

function classifyValence(conclusion: string): "burden" | "benefit" | null {
  const tagValence = classifyValenceFromTag(conclusion)
  if (tagValence) return tagValence.polarity

  const content = stripValenceTag(conclusion)
  const stripped = content.startsWith("-") ? content.slice(1) : content
  if (content.startsWith("-") && isBadTerm(stripped)) return "benefit"
  if (content.startsWith("-") && isGoodTerm(stripped)) return "burden"
  if (isBadTerm(content)) return "burden"
  if (isGoodTerm(content)) return "benefit"
  return null
}

export function liftNormativeProfile(
  decision: string,
  graph: ConsequenceGraph,
  conclusionStates: Map<string, { status: string; pianoA: string; combined: number; tags: string[] }>,
): { burdens: ForwardBurden[]; benefits: ForwardBenefit[] } {
  const burdens: ForwardBurden[] = []
  const benefits: ForwardBenefit[] = []

  for (const edge of graph.edges.filter((candidate) => candidate.from === decision)) {
    const state = conclusionStates.get(edge.to)
    if (!state) continue

    const epistemicState = deriveEpistemicState(state.status, state.pianoA)
    if (epistemicState === "excluded") continue

    const normativeTag = firstNormativeTag(state.tags)
    const valence = classifyValence(edge.to)
    if (valence === "burden") {
      burdens.push({
        conclusion: edge.to,
        liftStrength: edge.liftStrength,
        epistemicState,
        normativeTag,
        mitigationStatus: "unmitigated",
        mitigatedBy: [],
      })
      continue
    }

    if (valence === "benefit") {
      benefits.push({ conclusion: edge.to, liftStrength: edge.liftStrength, epistemicState, normativeTag })
    }
  }

  for (const edge of graph.edges.filter((e) => e.relation === "overrides")) {
    const targetBurden = burdens.find((b) => b.conclusion === edge.to)
    if (targetBurden) {
      targetBurden.mitigationStatus = "sufficiently_mitigated"
      targetBurden.mitigatedBy.push(edge.from)
    }
  }

  return { burdens, benefits }
}

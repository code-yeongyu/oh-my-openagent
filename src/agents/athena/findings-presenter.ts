import type { SynthesisResult, SynthesizedFinding } from "./synthesis-types"
import type { AgreementLevel } from "./types"

const AGREEMENT_ORDER: AgreementLevel[] = ["unanimous", "majority", "minority", "solo"]

function toTitle(level: AgreementLevel): string {
  return `${level.charAt(0).toUpperCase()}${level.slice(1)}`
}

function formatAgreementLine(level: AgreementLevel, finding: SynthesizedFinding): string {
  const memberCount = finding.reportedBy.length

  switch (level) {
    case "unanimous":
      return `${memberCount}/${memberCount} members agree`
    case "majority":
      return `${memberCount} members report this (majority)`
    case "minority":
      return `${memberCount} members report this (minority)`
    case "solo":
      return `${memberCount} member reported this`
  }
}

function formatFinding(level: AgreementLevel, finding: SynthesizedFinding): string {
  const assessment = finding.assessment.agrees ? "Agrees" : "Disagrees"
  const warning = level === "solo" && finding.isFalsePositiveRisk ? " [False Positive Risk]" : ""

  return [
    `### ${finding.summary}${warning}`,
    `Details: ${finding.details}`,
    `Reported by: ${finding.reportedBy.join(", ")}`,
    `Agreement context: ${formatAgreementLine(level, finding)}`,
    `Athena assessment: ${assessment}`,
    `Rationale: ${finding.assessment.rationale}`,
  ].join("\n")
}

function formatActionRecommendation(result: SynthesisResult, groupedFindings: Map<AgreementLevel, SynthesizedFinding[]>): string {
  const counts = AGREEMENT_ORDER.map((level) => `${toTitle(level)}: ${groupedFindings.get(level)?.length ?? 0}`).join(" | ")

  return [
    "## Action Recommendation",
    `Findings by agreement level: ${counts}`,
    "Prioritize unanimous and majority findings for immediate execution,",
    "then review minority findings, and manually validate solo findings before delegating changes.",
    `Question context: ${result.question}`,
  ].join("\n")
}

export function formatFindingsForUser(result: SynthesisResult): string {
  if (result.findings.length === 0) {
    return [
      "# Synthesized Findings",
      "No synthesized findings are available.",
      "## Action Recommendation",
      "Gather additional council responses or re-run synthesis before delegation.",
      `Question context: ${result.question}`,
    ].join("\n\n")
  }

  const groupedFindings = new Map<AgreementLevel, SynthesizedFinding[]>(
    AGREEMENT_ORDER.map((level) => [
      level,
      result.findings.filter((finding) => finding.agreementLevel === level),
    ]),
  )

  const sections = AGREEMENT_ORDER.flatMap((level) => {
    const findings = groupedFindings.get(level) ?? []
    if (findings.length === 0) {
      return []
    }

    const firstFinding = findings[0]
    const header = `## ${toTitle(level)} Findings (${formatAgreementLine(level, firstFinding)})`
    const entries = findings.map((finding) => formatFinding(level, finding)).join("\n\n")
    return [`${header}\n\n${entries}`]
  })

  return ["# Synthesized Findings", ...sections, formatActionRecommendation(result, groupedFindings)].join("\n\n")
}

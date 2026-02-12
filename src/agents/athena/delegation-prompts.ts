import type { SynthesizedFinding } from "./synthesis-types"

function formatFindingBlock(finding: SynthesizedFinding, index: number): string {
  const assessment = finding.assessment.agrees ? "Agrees" : "Disagrees"

  return [
    `${index + 1}. ${finding.summary}`,
    `   Details: ${finding.details}`,
    `   Agreement level: ${finding.agreementLevel}`,
    `   Athena assessment: ${assessment}`,
    `   Rationale: ${finding.assessment.rationale}`,
  ].join("\n")
}

function formatConfirmedFindings(confirmedFindings: SynthesizedFinding[]): string {
  return confirmedFindings.map((finding, index) => formatFindingBlock(finding, index)).join("\n\n")
}

export function buildAtlasDelegationPrompt(confirmedFindings: SynthesizedFinding[], question: string): string {
  return [
    "# Atlas Delegation Brief",
    "Original question:",
    question,
    "",
    "Task:",
    "Fix these confirmed issues directly.",
    "",
    "Confirmed findings:",
    formatConfirmedFindings(confirmedFindings),
    "",
    "Execution instructions:",
    "- Implement code changes to resolve each confirmed issue.",
    "- prioritize by agreement level, addressing unanimous findings first.",
    "- Validate fixes with relevant tests and type safety checks.",
  ].join("\n")
}

export function buildPrometheusDelegationPrompt(confirmedFindings: SynthesizedFinding[], question: string): string {
  return [
    "# Prometheus Delegation Brief",
    "Original question:",
    question,
    "",
    "Task:",
    "Create an execution plan for these confirmed issues.",
    "",
    "Confirmed findings:",
    formatConfirmedFindings(confirmedFindings),
    "",
    "Planning instructions:",
    "- Produce a phased implementation plan with clear task boundaries.",
    "- prioritize by agreement level and impact.",
    "- Include verification checkpoints for each phase.",
  ].join("\n")
}

import type { CouncilExecutionResult } from "./types"

export function formatCouncilResultsForSynthesis(result: CouncilExecutionResult): string {
  const completedResponses = result.responses.filter((response) => response.status === "completed")

  if (completedResponses.length === 0) {
    return [
      "# Council Responses for Synthesis",
      `Question: ${result.question}`,
      "No successful responses from council members.",
      "Review failed member details below for provenance.",
      ...result.responses.map((response) => {
        const memberName = response.member.name ?? response.member.model
        return [
          `## Member: ${memberName} (${response.status})`,
          `Model: ${response.member.model}`,
          `Status: ${response.status}`,
          `Duration: ${response.durationMs}ms`,
          `Error: ${response.error ?? "No error message provided"}`,
        ].join("\n")
      }),
    ].join("\n\n")
  }

  const sections = result.responses.map((response) => {
    const memberName = response.member.name ?? response.member.model
    const header = [
      `## Member: ${memberName} (${response.status})`,
      `Model: ${response.member.model}`,
      `Status: ${response.status}`,
      `Duration: ${response.durationMs}ms`,
    ]

    if (response.status === "completed") {
      const responseBody = response.response?.trim() ? response.response : "No response content provided"
      return [...header, "Response:", responseBody].join("\n")
    }

    return [...header, `Error: ${response.error ?? "No error message provided"}`].join("\n")
  })

  return [
    "# Council Responses for Synthesis",
    `Question: ${result.question}`,
    `Completed responses: ${result.completedCount}/${result.totalMembers}`,
    ...sections,
  ].join("\n\n")
}

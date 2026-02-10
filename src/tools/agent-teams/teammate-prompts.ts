export function buildLaunchPrompt(
  teamName: string,
  teammateName: string,
  userPrompt: string,
  categoryPromptAppend?: string,
): string {
  const sections = [
    `You are teammate "${teammateName}" in team "${teamName}".`,
    `When you need updates, call read_inbox with team_name="${teamName}" and agent_name="${teammateName}".`,
    "Initial assignment:",
    userPrompt,
  ]

  if (categoryPromptAppend) {
    sections.push("Category guidance:", categoryPromptAppend)
  }

  return sections.join("\n\n")
}

export function buildDeliveryPrompt(teamName: string, teammateName: string, summary: string, content: string): string {
  return [
    `New team message for "${teammateName}" in team "${teamName}".`,
    `Summary: ${summary}`,
    "Content:",
    content,
  ].join("\n\n")
}

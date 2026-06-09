const LSP_PROMPT_MARKERS = [
  "lsp_diagnostics",
  "lsp_*",
  "lsp tools",
  "semantic search",
]

function referencesLspPromptTool(line: string): boolean {
  const normalized = line.toLowerCase()
  return LSP_PROMPT_MARKERS.some((marker) => normalized.includes(marker))
}

export function stripDisabledMcpPromptReferences(prompt: string, disabledMcps: readonly string[] = []): string {
  if (!disabledMcps.includes("lsp")) return prompt

  return prompt
    .split("\n")
    .filter((line) => !referencesLspPromptTool(line))
    .join("\n")
}

export function stripDisabledMcpReferencesFromAgents<T extends Record<string, { prompt?: string }>>(
  agents: T,
  disabledMcps: readonly string[] = [],
): T {
  if (!disabledMcps.includes("lsp")) return agents

  for (const agent of Object.values(agents)) {
    if (typeof agent.prompt === "string") {
      agent.prompt = stripDisabledMcpPromptReferences(agent.prompt, disabledMcps)
    }
  }

  return agents
}

import type { AgentConfig } from "@opencode-ai/sdk"

/**
 * Strips lines containing `lsp_` tool references from agent prompts
 * when the LSP MCP is disabled via `disabled_mcps`.
 *
 * This prevents agents from being instructed to call LSP tools
 * (lsp_diagnostics, lsp_find_references, lsp_rename, etc.)
 * that don't exist when the LSP MCP server is not registered.
 *
 * Follows the same post-processing pattern as `applyEnvironmentContext`.
 */
export function stripLspPromptReferences(
  config: AgentConfig,
  disabledMcps: string[],
): AgentConfig {
  if (!disabledMcps.includes("lsp")) return config
  if (!config.prompt) return config

  const stripped = removeLspLines(config.prompt)
  if (stripped === config.prompt) return config

  return { ...config, prompt: stripped }
}

/**
 * Removes lines that reference `lsp_` tools from a prompt string.
 * Handles both backtick-wrapped (`lsp_diagnostics`) and bare references.
 * Also collapses resulting double-blank-lines into single blank lines.
 */
export function removeLspLines(prompt: string): string {
  const lines = prompt.split("\n")
  const filtered = lines.filter((line) => !line.includes("lsp_"))
  const result = filtered.join("\n")
  return result.replace(/\n{3,}/g, "\n\n")
}

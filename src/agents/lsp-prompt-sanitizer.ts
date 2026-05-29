import type { AgentConfig } from "@opencode-ai/sdk"
import { log } from "../shared"

const LSP_TOKEN_REPLACEMENTS: Record<string, string> = {
  lsp_diagnostics: "the project's type-checker (build/typecheck)",
  lsp_find_references: "`grep` / `ast_grep_search` for references",
  lsp_prepare_rename: "reference check",
  lsp_rename: "manual rename (`ast_grep_replace`, or `grep` + `edit`)",
  lsp_goto_definition: "`grep` / `ast_grep_search` for the definition",
  lsp_symbols: "`grep` / `ast_grep_search` for symbols",
}

// When ast_grep is also in disabled_mcps, the replacement text can still name an
// unavailable tool. That combined-disable case is out of scope for this gate.
const LSP_TOKEN_PATTERN = /`(lsp_[a-z_]+)`|\b(lsp_[a-z_]+)\b/g

export function sanitizeLspPromptIfDisabled(prompt: string, lspDisabled: boolean): string {
  if (!lspDisabled) {
    return prompt
  }

  return prompt.replace(LSP_TOKEN_PATTERN, (match, backtickedToken, bareToken) => {
    const token = backtickedToken ?? bareToken
    const replacement = LSP_TOKEN_REPLACEMENTS[token]
    if (replacement === undefined) {
      log("lsp-prompt-sanitizer: unmapped lsp token left verbatim", { token })
      return match
    }
    return replacement
  })
}

export function sanitizeLspInAgentConfig(config: AgentConfig, lspDisabled: boolean): AgentConfig {
  if (!lspDisabled || typeof config.prompt !== "string") {
    return config
  }

  return { ...config, prompt: sanitizeLspPromptIfDisabled(config.prompt, lspDisabled) }
}

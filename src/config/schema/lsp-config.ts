import { z } from "zod"

export const LspConfigSchema = z.object({
  /** Use OpenCode's experimental unified LSP tool instead of oh-my-opencode's lsp-tools-mcp.
   * When enabled (and OPENCODE_EXPERIMENTAL_LSP_TOOL=true or OPENCODE_EXPERIMENTAL=true):
   * suppresses lsp_goto_definition and lsp_find_references from the lsp-tools-mcp MCP server
   * via LSP_TOOLS_MCP_DISABLED_TOOLS env var, delegating those operations to OpenCode's built-in LSP.
   * lsp_diagnostics, lsp_prepare_rename, lsp_rename, and lsp_symbols remain on OMO's MCP.
   * Default: false (safe rollout)
   */
  useOpenCodeExperimental: z.boolean().default(false),
})

export type LspConfig = z.infer<typeof LspConfigSchema>

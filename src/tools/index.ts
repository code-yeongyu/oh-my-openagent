import {
  lsp_hover,
  lsp_goto_definition,
  lsp_find_references,
  lsp_document_symbols,
  lsp_workspace_symbols,
  lsp_diagnostics,
  lsp_servers,
  lsp_prepare_rename,
  lsp_rename,
  lsp_code_actions,
  lsp_code_action_resolve,
} from "./lsp"

import {
  ast_grep_search,
  ast_grep_replace,
} from "./ast-grep"

import { grep } from "./grep"
import { glob } from "./glob"
export { createSlashcommandTool, discoverCommandsSync } from "./slashcommand"

import {
  session_list,
  session_read,
  session_search,
  session_info,
} from "./session-manager"

export { sessionExists } from "./session-manager/storage"

export { interactive_bash, startBackgroundCheck as startTmuxCheck } from "./interactive-bash"
export { createSkillTool } from "./skill"
export { getTmuxPath } from "./interactive-bash/utils"
export { createSkillMcpTool } from "./skill-mcp"

import type { ToolDefinition } from "@opencode-ai/plugin"

export { createCallOmoAgent } from "./call-omo-agent"
export { createLookAt } from "./look-at"
export { createSisyphusTask, type SisyphusTaskToolOptions, DEFAULT_CATEGORIES, CATEGORY_PROMPT_APPENDS } from "./sisyphus-task"

export function createBackgroundTools(): Record<string, ToolDefinition> {
  return {}
}

export const builtinTools: Record<string, ToolDefinition> = {
  lsp_hover,
  lsp_goto_definition,
  lsp_find_references,
  lsp_document_symbols,
  lsp_workspace_symbols,
  lsp_diagnostics,
  lsp_servers,
  lsp_prepare_rename,
  lsp_rename,
  lsp_code_actions,
  lsp_code_action_resolve,
  ast_grep_search,
  ast_grep_replace,
  grep,
  glob,
  session_list,
  session_read,
  session_search,
  session_info,
}

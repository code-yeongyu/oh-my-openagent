import {
  lsp_goto_definition,
  lsp_find_references,
  lsp_symbols,
  lsp_diagnostics,
  lsp_prepare_rename,
  lsp_rename,
  lspManager,
} from "./lsp"

export { lspManager }

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
export { createSkillMcpTool } from "./skill-mcp"

import {
  createBackgroundOutput,
  createBackgroundCancel,
} from "./background-task"

import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin"
import type { BackgroundManager } from "../features/background-agent"

type OpencodeClient = PluginInput["client"]

export { createCallOmoAgent } from "./call-omo-agent"
export { createLookAt } from "./look-at"
export { createDelegateTask } from "./delegate-task"

export function createBackgroundTools(manager: BackgroundManager, client: OpencodeClient): Record<string, ToolDefinition> {
  return {
    background_output: createBackgroundOutput(manager, client),
    background_cancel: createBackgroundCancel(manager, client),
  }
}

export const builtinTools: Record<string, ToolDefinition> = {
  lsp_goto_definition,
  lsp_find_references,
  lsp_symbols,
  lsp_diagnostics,
  lsp_prepare_rename,
  lsp_rename,
  ast_grep_search,
  ast_grep_replace,
  grep,
  glob,
  session_list,
  session_read,
  session_search,
  session_info,
}

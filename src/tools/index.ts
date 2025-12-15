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
import { slashcommand } from "./slashcommand"
import { skill } from "./skill"
import { interactive_bash } from "./interactive-bash"

import {
  createBackgroundTask,
  createBackgroundOutput,
  createBackgroundCancel,
} from "./background-task"

import type { PluginInput } from "@opencode-ai/plugin"
import type { BackgroundManager } from "../features/background-agent"

type OpencodeClient = PluginInput["client"]

export { createCallOmoAgent } from "./call-omo-agent"
export { createLookAt } from "./look-at"

export function createBackgroundTools(manager: BackgroundManager, client: OpencodeClient) {
  return {
    background_task: createBackgroundTask(manager),
    background_output: createBackgroundOutput(manager, client),
    background_cancel: createBackgroundCancel(manager, client),
  }
}

export const builtinTools = {
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
  slashcommand,
  skill,
  interactive_bash,
}

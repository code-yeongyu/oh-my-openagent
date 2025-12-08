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
}

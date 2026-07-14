import type { ToolDefinition } from "@opencode-ai/plugin"
import type { MagicContextConfig } from "../../../config/schema/magic-context"
import type { Database } from "../db/sqlite"
import type { Embedder } from "../embedding/provider"
import type { SearchEngine } from "../search"
import { createSearchEngine } from "../search"

import { createCtxSearchTool } from "./ctx-search"
import { createCtxRememberTool } from "./ctx-remember"
import { createCtxForgetTool } from "./ctx-forget"
import { createCtxListTool } from "./ctx-list"

export interface MagicContextToolsDeps {
  db: Database
  embedder: Embedder
  modelId: string
  searchEngine?: SearchEngine
  resolveProjectPath?: (directory: string) => string
}

export function createMagicContextTools(
  config: MagicContextConfig,
  deps: MagicContextToolsDeps,
): Record<string, ToolDefinition> {
  if (!config.enabled) return {}

  const searchEngine = deps.searchEngine ?? createSearchEngine(deps.db, deps.embedder)

  const tools: Record<string, ToolDefinition> = {
    ctx_search: createCtxSearchTool(config, { searchEngine }),
    ctx_remember: createCtxRememberTool(config, {
      db: deps.db,
      embedder: deps.embedder,
      modelId: deps.modelId,
      resolveProjectPath: deps.resolveProjectPath,
    }),
    ctx_forget: createCtxForgetTool(config, { db: deps.db }),
    ctx_list: createCtxListTool(config, { db: deps.db, resolveProjectPath: deps.resolveProjectPath }),
  }

  return tools
}

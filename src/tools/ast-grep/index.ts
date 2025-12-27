import type { ToolDefinition } from "@opencode-ai/plugin"
import { ast_grep_search, ast_grep_replace } from "./tools"

export const builtinTools: Record<string, ToolDefinition> = {
  ast_grep_search,
  ast_grep_replace,
}

export { ast_grep_search, ast_grep_replace }
export { ensureAstGrepBinary, getCachedBinaryPath, getCacheDir } from "./downloader"
export { getAstGrepPath, isCliAvailable, ensureCliAvailable, startBackgroundInit } from "./cli"
export { checkEnvironment, formatEnvironmentCheck } from "./constants"
export type { EnvironmentCheckResult } from "./constants"

import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { MagicContextConfig } from "../../../config/schema/magic-context"
import type { Database } from "../db/sqlite"
import type { Embedder } from "../embedding/provider"
import { memories } from "../db"

export function createCtxRememberTool(
  _config: MagicContextConfig,
  deps: {
    db: Database
    embedder: Embedder
    modelId: string
    resolveProjectPath?: (directory: string) => string
  },
): ToolDefinition {
  return tool({
    description:
      "Remember a fact — store a new cross-session memory in Magic Context. Future sessions will start with this knowledge visible. Use this to persist project rules, architectural decisions, config values, and constraints.",
    args: {
      content: tool.schema.string().describe("The fact to remember — one standalone, self-contained statement"),
      category: tool.schema
        .string()
        .optional()
        .describe(
          "Category: ARCHITECTURE, ARCHITECTURE_DECISIONS, CONFIG_VALUES, CONFIG_DEFAULTS, CONSTRAINTS, ENVIRONMENT, KNOWN_ISSUES, NAMING, USER_DIRECTIVES, USER_PREFERENCES, WORKFLOW_RULES, PROJECT_RULES (default: CONSTRAINTS)",
        ),
    },
    async execute(args, toolContext) {
      const content = args.content?.trim()
      if (!content) return "Error: 'content' is required."

      const projectPath = deps.resolveProjectPath?.(toolContext.directory) ?? toolContext.directory
      const rawCategory = (args.category?.trim() ?? "CONSTRAINTS") as memories.MemoryCategory

      const { memory, inserted } = memories.insertMemoryIdempotent(deps.db, {
        projectPath,
        category: rawCategory,
        content,
        sourceSessionId: toolContext.sessionID,
        sourceType: "agent",
      })

      // Persist an embedding so ctx_search can retrieve this memory. Mirrors
      // MC's queueMemoryEmbedding (store after insert). Failure must not break
      // the remember — the memory is still saved, it just won't be searchable
      // until a re-embed pass.
      try {
        const vector = await deps.embedder.embedText(content)
        memories.saveMemoryEmbedding(deps.db, memory.id, vector, deps.modelId)
      } catch (embedError) {
        console.error("[magic-context] embedding storage failed for memory", memory.id, embedError)
      }

      if (!inserted) {
        return `Memory already exists [ID: ${memory.id}] in ${rawCategory}.`
      }

      return `Saved memory [ID: ${memory.id}] in ${rawCategory}.`
    },
  })
}

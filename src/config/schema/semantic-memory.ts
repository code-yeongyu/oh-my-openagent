import { z } from "zod"

export const SemanticMemoryConfigSchema = z.object({
  enabled: z.boolean().default(true),
  /** Enable AST-pattern tracking and matching for code-related memories */
  use_aft_precision: z.boolean().default(true),
  /** Optional custom SQLite database path. Default is inside the app data directory. */
  db_path: z.string().optional(),
  /** Maximum number of active memories retained per session */
  max_memories_per_session: z.number().min(10).max(1000).default(100),
})

export type SemanticMemoryConfig = z.infer<typeof SemanticMemoryConfigSchema>

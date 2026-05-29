import { z } from "zod"

export const MagicContextConfigSchema = z.object({
  enabled: z.boolean().default(true),
  /** Enable surgical AST node extraction for classes, functions, and TS interfaces */
  use_aft_extraction: z.boolean().default(true),
  /** Maximum number of tokens hydrated as context */
  max_context_tokens: z.number().min(512).max(32768).default(4096),
  /** Glob patterns of paths to exclude from context hydration */
  exclude_paths: z.array(z.string()).default([]),
})

export type MagicContextConfig = z.infer<typeof MagicContextConfigSchema>

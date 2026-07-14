import { z } from "zod"

const EmbeddingSubConfigSchema = z.object({
  provider: z.enum(["local", "openai-compatible", "off", "mock"]).default("openai-compatible"),
  model: z.string().default("Xenova/all-MiniLM-L6-v2"),
  endpoint: z.string().default("http://localhost:9642/v1"),
  api_key: z.string().default(""),
  max_input_tokens: z.number().int().positive().default(8192),
})

const MemorySubConfigSchema = z.object({
  enabled: z.boolean().default(true),
  auto_search: z
    .object({
      enabled: z.boolean().default(true),
      score_threshold: z.number().min(0).max(1).default(0.6),
      min_prompt_chars: z.number().int().min(1).default(40),
    })
    .default({ enabled: true, score_threshold: 0.6, min_prompt_chars: 40 }),
  git_commit_indexing: z
    .object({
      enabled: z.boolean().default(false),
      since_days: z.number().int().min(1).default(90),
      max_commits: z.number().int().min(1).default(200),
    })
    .default({ enabled: false, since_days: 90, max_commits: 200 }),
}).default({
  enabled: true,
  auto_search: { enabled: true, score_threshold: 0.6, min_prompt_chars: 40 },
  git_commit_indexing: { enabled: false, since_days: 90, max_commits: 200 },
})

export const magicContextSchema = z.object({
  /** Enable Magic Context features (default: true) */
  enabled: z.boolean().default(true),
  /**
   * Output language for generated prose as a 2-letter ISO 639-1 code
   * (e.g. "en", "fr", "de", "ja", "ko").
   * USER-LEVEL ONLY: ignored in project config for security.
   */
  language: z
    .string()
    .regex(/^[a-z]{2}$/, "Must be a 2-letter ISO 639-1 code (e.g. 'en', 'fr', 'de')")
    .optional(),
  /** SQLite database path override. null resolves to the default path. */
  sqlite: z
    .object({
      path: z.string().nullable().default(null),
    })
    .default({ path: null }),
  /** Embedding provider configuration */
  embedding: EmbeddingSubConfigSchema.default({
    provider: "openai-compatible",
    model: "Xenova/all-MiniLM-L6-v2",
    endpoint: "http://localhost:9642/v1",
    api_key: "",
    max_input_tokens: 8192,
  }),
  /** Cross-session memory configuration */
  memory: MemorySubConfigSchema,
  /** Enable context reduction (default: true) */
  ctx_reduce_enabled: z.boolean().default(true),
  /** Keep subagent sessions on success instead of deleting them (default: false) */
  keep_subagents: z.boolean().default(false),
})

export { magicContextSchema as MagicContextConfigSchema }
export type MagicContextConfig = z.infer<typeof magicContextSchema>

export type EmbeddingConfig = z.infer<typeof EmbeddingSubConfigSchema>
export type MemoryConfig = z.infer<typeof MemorySubConfigSchema>

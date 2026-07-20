import { z } from "zod"

/**
 * OpenViking integration configuration schema
 * 
 * OpenViking is a context database for AI agents that provides:
 * - L0/L1/L2 hierarchical context loading
 * - Session compression and memory extraction
 * - Semantic memory recall
 * 
 * This configuration enables automatic memory recall before AI calls
 * and automatic session commit when sessions end, reducing token
 * consumption by 50-80% and preventing TPM rate limiting.
 */

/**
 * Memory types that can be recalled from OpenViking
 * - profile: User identity and attributes
 * - preferences: User preferences by topic
 * - entities: Entity memories (people, projects)
 * - events: Event records (decisions, milestones)
 * - cases: Problem + solution pairs
 * - patterns: Reusable workflows
 * - tools: Tool usage experience and best practices
 * - skills: Skill execution experience and workflow strategies
 */
export const MemoryTypeSchema = z.enum([
  "profile",
  "preferences",
  "entities",
  "events",
  "cases",
  "patterns",
  "tools",
  "skills",
])

export type MemoryType = z.infer<typeof MemoryTypeSchema>

/**
 * OpenViking configuration schema
 */
export const OpenVikingConfigSchema = z
  .object({
    /**
     * Enable OpenViking integration
     * @default false
     */
    enabled: z.boolean().optional().default(false),

    /**
     * OpenViking server URL
     * Must be a valid HTTP/HTTPS URL
     * @default "http://localhost:1933"
     */
    url: z
      .string()
      .url("OpenViking URL must be a valid HTTP/HTTPS URL")
      .optional()
      .default("http://localhost:1933"),

    /**
     * API key for authentication (optional)
     * Leave empty if OpenViking server doesn't require authentication
     * @default ""
     */
    api_key: z.string().optional().default(""),

    /**
     * Automatically recall relevant memories before each AI call
     * Uses experimental.chat.messages.transform hook
     * @default true
     */
    auto_recall: z.boolean().optional().default(true),

    /**
     * Automatically commit session to OpenViking when session ends
     * Uses chat.message hook to detect session termination
     * @default true
     */
    auto_commit: z.boolean().optional().default(true),

    /**
     * Maximum number of memories to recall per AI call
     * Must be between 1 and 20
     * @default 5
     */
    max_memories: z
      .number()
      .int("max_memories must be an integer")
      .min(1, "max_memories must be at least 1")
      .max(20, "max_memories must be at most 20")
      .optional()
      .default(5),

    /**
     * Memory types to recall
     * If not specified, all memory types will be recalled
     * @default undefined (all types)
     */
    memory_types: z.array(MemoryTypeSchema).optional(),
  })
  .strict()

export type OpenVikingConfig = z.infer<typeof OpenVikingConfigSchema>

/**
 * Default OpenViking configuration
 */
export const DEFAULT_OPENVIKING_CONFIG: OpenVikingConfig = {
  enabled: false,
  url: "http://localhost:1933",
  api_key: "",
  auto_recall: true,
  auto_commit: true,
  max_memories: 5,
  memory_types: undefined,
}

/**
 * Validate OpenViking configuration
 * Returns validated config or throws error
 */
export function validateOpenVikingConfig(
  config: unknown
): OpenVikingConfig {
  return OpenVikingConfigSchema.parse(config)
}

/**
 * Check if OpenViking configuration is valid and enabled
 */
export function isOpenVikingEnabled(
  config: OpenVikingConfig | undefined
): boolean {
  return config?.enabled === true
}

import { z } from "zod"

export const MemoryProviderKindSchema = z.preprocess(
  (value) => {
    if (value === "filesystem" || value === "mem0" || value === "sqlite") {
      return "runtime"
    }

    return value
  },
  z.enum([
    "runtime",
    "noop",
  ]),
)

export type MemoryProviderKind = z.infer<typeof MemoryProviderKindSchema>

export const Mem0ConnectionConfigSchema = z
  .object({
    api_key: z.string().trim().min(1).nullable().default(null),
    base_url: z.string().trim().min(1).nullable().default(null),
    organization_id: z.string().trim().min(1).nullable().default(null),
    project_id: z.string().trim().min(1).nullable().default(null),
  })
  .default(() => ({
    api_key: null,
    base_url: null,
    organization_id: null,
    project_id: null,
  }))

export type Mem0ConnectionConfig = z.infer<typeof Mem0ConnectionConfigSchema>

export const L3ConnectionConfigSchema = z
  .object({
    vespa_base_url: z.string().trim().min(1).default("http://localhost:8080"),
    pageindex_base_url: z.string().trim().min(1).default("http://localhost:8765"),
    gemini_api_key: z.string().trim().min(1).nullable().default(null),
    cohere_bedrock_region: z.string().trim().min(1).nullable().default(null),
  })
  .default(() => ({
    vespa_base_url: "http://localhost:8080",
    pageindex_base_url: "http://localhost:8765",
    gemini_api_key: null,
    cohere_bedrock_region: null,
  }))

export type L3ConnectionConfig = z.infer<typeof L3ConnectionConfigSchema>

export const ObsidianProjectionConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    vault_path: z.string().trim().min(1).nullable().default(null),
    omo_subdir: z.string().trim().min(1).default("omo"),
  })
  .default(() => ({
    enabled: false,
    vault_path: null,
    omo_subdir: "omo",
  }))

export type ObsidianProjectionConfig = z.infer<typeof ObsidianProjectionConfigSchema>

export const CuratorLoopConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    interval_ms: z.number().int().positive().default(30 * 60_000),
    batch_size: z.number().int().positive().max(200).default(20),
    lookback_hours: z.number().int().positive().default(6),
    min_age_minutes: z.number().int().nonnegative().default(5),
    project_id: z.string().trim().min(1).nullable().default(null),
    transport: z.enum(["vertex-direct", "http-adapter"]).default("vertex-direct"),
    vertex_project_id: z.string().trim().min(1).nullable().default(null),
    vertex_location: z.string().trim().min(1).default("global"),
    adapter_base_url: z.string().trim().min(1).default("http://127.0.0.1:37999/v1/chat/completions"),
    model: z.string().trim().min(1).default("google/gemini-3.1-pro-preview"),
  })
  .default(() => ({
    enabled: false,
    interval_ms: 30 * 60_000,
    batch_size: 20,
    lookback_hours: 6,
    min_age_minutes: 5,
    project_id: null,
    transport: "vertex-direct" as const,
    vertex_project_id: null,
    vertex_location: "global",
    adapter_base_url: "http://127.0.0.1:37999/v1/chat/completions",
    model: "google/gemini-3.1-pro-preview",
  }))

export type CuratorLoopConfigInput = z.infer<typeof CuratorLoopConfigSchema>

export const CartographerLoopConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    draft_interval_hours: z.number().int().positive().default(2),
    signal_threshold: z.enum(["low", "medium", "high"]).default("high"),
    minimum_observations_for_cluster: z.number().int().positive().default(3),
    max_drafts_per_tick: z.number().int().positive().max(20).default(3),
    lookback_hours: z.number().int().positive().default(6),
    min_age_minutes: z.number().int().nonnegative().default(5),
    project_id: z.string().trim().min(1).nullable().default(null),
    transport: z.enum(["vertex-direct"]).default("vertex-direct"),
    vertex_project_id: z.string().trim().min(1).nullable().default(null),
    vertex_location: z.string().trim().min(1).default("global"),
    model: z.string().trim().min(1).default("google/gemini-3.1-pro-preview"),
  })
  .default(() => ({
    enabled: false,
    draft_interval_hours: 2,
    signal_threshold: "high" as const,
    minimum_observations_for_cluster: 3,
    max_drafts_per_tick: 3,
    lookback_hours: 6,
    min_age_minutes: 5,
    project_id: null,
    transport: "vertex-direct" as const,
    vertex_project_id: null,
    vertex_location: "global",
    model: "google/gemini-3.1-pro-preview",
  }))

export type CartographerLoopConfigInput = z.infer<typeof CartographerLoopConfigSchema>

export const MeetingSchedulerConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    min_hours_between: z.number().int().positive().default(4),
    max_hours_between: z.number().int().positive().default(24),
    min_inbox_drafts: z.number().int().positive().default(3),
    idle_threshold_minutes: z.number().int().positive().default(5),
  })
  .default(() => ({
    enabled: false,
    min_hours_between: 4,
    max_hours_between: 24,
    min_inbox_drafts: 3,
    idle_threshold_minutes: 5,
  }))

export type MeetingSchedulerConfigInput = z.infer<typeof MeetingSchedulerConfigSchema>

export const MemoryAgentConfigSchema = z.object({
  enabled: z.boolean().default(true),
  provider: MemoryProviderKindSchema.default("runtime"),
  promote_to_l2: z.boolean().default(true),
  promote_to_l3: z.boolean().default(true),
  ingestion_enabled: z.boolean().default(true),
  max_inline_payload_chars: z.number().int().positive().default(8000),
  remote_docling_host: z.string().trim().min(1).default("localhost"),
  remote_docling_python_env: z.string().trim().min(1).default("$HOME/l3-env/bin/activate"),
  database_url: z.string().trim().min(1).nullable().default(null),
  mem0: Mem0ConnectionConfigSchema,
  l3: L3ConnectionConfigSchema,
  obsidian: ObsidianProjectionConfigSchema,
  curator: CuratorLoopConfigSchema,
  cartographer: CartographerLoopConfigSchema,
  meeting: MeetingSchedulerConfigSchema,
})

export type MemoryAgentConfig = z.infer<typeof MemoryAgentConfigSchema>

export const DEFAULT_MEMORY_AGENT_CONFIG: MemoryAgentConfig = MemoryAgentConfigSchema.parse({})

import * as z from "zod"

// ---------------------------------------------------------------------------
// Reflection
// ---------------------------------------------------------------------------

export const OmoMemoryReflectionTriggerSchema = z.object({
  step_count: z.number().int().nonnegative().default(25),
  on_compaction: z.boolean().default(true),
}).strict()

export const OmoMemoryReflectionSchema = z.object({
  enabled: z.boolean().default(true),
  trigger: OmoMemoryReflectionTriggerSchema.default({ step_count: 25, on_compaction: true }),
  merge: z.enum(["auto", "integration"]).default("auto"),
  category: z.string().min(1).default("quick"),
  timeout_minutes: z.number().int().positive().default(15),
  sandbox: z.enum(["auto", "required", "off"]).default("auto"),
}).strict()

// ---------------------------------------------------------------------------
// Sync + Search (unchanged)
// ---------------------------------------------------------------------------

export const OmoMemorySyncSchema = z.object({
  remote: z.string().min(1).optional(),
  enabled: z.boolean().default(true),
}).strict()

export const OmoMemorySearchSchema = z.object({
  enabled: z.boolean().default(true),
}).strict()

// ---------------------------------------------------------------------------
// Nudge
// ---------------------------------------------------------------------------

export const OmoMemoryNudgeSchema = z.object({
  enabled: z.boolean().default(true),
  every_user_turns: z.number().int().min(1).default(10),
}).strict()

// ---------------------------------------------------------------------------
// Facts (category is deliberately NOT a knob: pinned "quick")
// ---------------------------------------------------------------------------

export const OmoMemoryFactsSchema = z.object({
  enabled: z.boolean().default(true),
  debounce_settles: z.number().int().min(1).default(4),
}).strict()

// ---------------------------------------------------------------------------
// Dream
// ---------------------------------------------------------------------------

export const OmoMemoryDreamSchema = z.object({
  enabled: z.boolean().default(true),
  idle_minutes: z.number().int().min(0).default(30),
  min_hours_between: z.number().int().min(1).default(24),
  shutdown_launch: z.boolean().default(true),
  auto_select_max: z.number().int().min(1).max(10).default(5),
  auto_select_max_chars: z.number().int().min(10000).default(150000),
}).strict()

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export const OmoMemoryPeopleSchema = z.object({
  enabled: z.boolean().default(true),
  max_entries: z.number().int().min(1).max(100).default(40),
  max_entry_chars: z.number().int().min(50).max(500).default(200),
}).strict()

// ---------------------------------------------------------------------------
// Soul
// ---------------------------------------------------------------------------

export const OmoMemorySoulSchema = z.object({
  edit_notice: z.boolean().default(true),
}).strict()

// ---------------------------------------------------------------------------
// Write notice (memory / memory_apply_patch tool-result row)
// ---------------------------------------------------------------------------

export const OmoMemoryWriteNoticeSchema = z.object({
  enabled: z.boolean().default(true),
}).strict()

// ---------------------------------------------------------------------------
// Layer (deep-partial) variants
// ---------------------------------------------------------------------------

export const OmoMemoryReflectionTriggerLayerSchema = z.object({
  step_count: z.number().int().nonnegative().optional(),
  on_compaction: z.boolean().optional(),
}).strict()

export const OmoMemoryReflectionLayerSchema = z.object({
  enabled: z.boolean().optional(),
  trigger: OmoMemoryReflectionTriggerLayerSchema.optional(),
  merge: z.enum(["auto", "integration"]).optional(),
  category: z.string().min(1).optional(),
  timeout_minutes: z.number().int().positive().optional(),
  sandbox: z.enum(["auto", "required", "off"]).optional(),
}).strict()

export const OmoMemorySyncLayerSchema = z.object({
  remote: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
}).strict()

export const OmoMemorySearchLayerSchema = z.object({
  enabled: z.boolean().optional(),
}).strict()

export const OmoMemoryNudgeLayerSchema = z.object({
  enabled: z.boolean().optional(),
  every_user_turns: z.number().int().min(1).optional(),
}).strict()

export const OmoMemoryFactsLayerSchema = z.object({
  enabled: z.boolean().optional(),
  debounce_settles: z.number().int().min(1).optional(),
}).strict()

export const OmoMemoryDreamLayerSchema = z.object({
  enabled: z.boolean().optional(),
  idle_minutes: z.number().int().min(0).optional(),
  min_hours_between: z.number().int().min(1).optional(),
  shutdown_launch: z.boolean().optional(),
  auto_select_max: z.number().int().min(1).max(10).optional(),
  auto_select_max_chars: z.number().int().min(10000).optional(),
}).strict()

export const OmoMemoryPeopleLayerSchema = z.object({
  enabled: z.boolean().optional(),
  max_entries: z.number().int().min(1).max(100).optional(),
  max_entry_chars: z.number().int().min(50).max(500).optional(),
}).strict()

export const OmoMemorySoulLayerSchema = z.object({
  edit_notice: z.boolean().optional(),
}).strict()

export const OmoMemoryWriteNoticeLayerSchema = z.object({
  enabled: z.boolean().optional(),
}).strict()

// ---------------------------------------------------------------------------
// Per-agent overrides (layer-shaped)
// ---------------------------------------------------------------------------

export const OmoMemoryAgentOverridesSchema = z.object({
  enabled: z.boolean().optional(),
  agent: z.string().min(1).optional(),
  reflection: OmoMemoryReflectionLayerSchema.optional(),
  nudge: OmoMemoryNudgeLayerSchema.optional(),
  facts: OmoMemoryFactsLayerSchema.optional(),
  dream: OmoMemoryDreamLayerSchema.optional(),
  people: OmoMemoryPeopleLayerSchema.optional(),
  soul: OmoMemorySoulLayerSchema.optional(),
  write_notice: OmoMemoryWriteNoticeLayerSchema.optional(),
  sync: OmoMemorySyncLayerSchema.optional(),
  search: OmoMemorySearchLayerSchema.optional(),
  compile_warn_tokens: z.number().int().positive().optional(),
}).strict()

// ---------------------------------------------------------------------------
// Root settings schema
// ---------------------------------------------------------------------------

export const OmoMemorySettingsSchema = z.object({
  enabled: z.boolean().default(true),
  agent: z.string().min(1).default("auto"),
  // "direct" registers the memory tools as always-on ToolDefinitions; "search" opts in to the
  // extension-declared MCP server surfaced through senpi's tool_search catalog.
  tool_exposure: z.enum(["direct", "search"]).default("direct"),
  reflection: OmoMemoryReflectionSchema.default({
    enabled: true,
    trigger: { step_count: 25, on_compaction: true },
    merge: "auto",
    category: "quick",
    timeout_minutes: 15,
    sandbox: "auto",
  }),
  nudge: OmoMemoryNudgeSchema.default({ enabled: true, every_user_turns: 10 }),
  facts: OmoMemoryFactsSchema.default({ enabled: true, debounce_settles: 4 }),
  dream: OmoMemoryDreamSchema.default({
    enabled: true,
    idle_minutes: 30,
    min_hours_between: 24,
    shutdown_launch: true,
    auto_select_max: 5,
    auto_select_max_chars: 150000,
  }),
  people: OmoMemoryPeopleSchema.default({ enabled: true, max_entries: 40, max_entry_chars: 200 }),
  soul: OmoMemorySoulSchema.default({ edit_notice: true }),
  write_notice: OmoMemoryWriteNoticeSchema.default({ enabled: true }),
  sync: OmoMemorySyncSchema.default({ enabled: true }),
  search: OmoMemorySearchSchema.default({ enabled: true }),
  compile_warn_tokens: z.number().int().positive().default(30000),
  agents: z.record(z.string(), OmoMemoryAgentOverridesSchema).default({}),
}).strict()

export const OmoMemorySettingsLayerSchema = z.object({
  enabled: z.boolean().optional(),
  agent: z.string().min(1).optional(),
  tool_exposure: z.enum(["direct", "search"]).optional(),
  reflection: OmoMemoryReflectionLayerSchema.optional(),
  nudge: OmoMemoryNudgeLayerSchema.optional(),
  facts: OmoMemoryFactsLayerSchema.optional(),
  dream: OmoMemoryDreamLayerSchema.optional(),
  people: OmoMemoryPeopleLayerSchema.optional(),
  soul: OmoMemorySoulLayerSchema.optional(),
  write_notice: OmoMemoryWriteNoticeLayerSchema.optional(),
  sync: OmoMemorySyncLayerSchema.optional(),
  search: OmoMemorySearchLayerSchema.optional(),
  compile_warn_tokens: z.number().int().positive().optional(),
  agents: z.record(z.string(), OmoMemoryAgentOverridesSchema).optional(),
}).strict()

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type OmoMemoryReflectionTrigger = z.infer<typeof OmoMemoryReflectionTriggerSchema>
export type OmoMemoryReflection = z.infer<typeof OmoMemoryReflectionSchema>
export type OmoMemorySync = z.infer<typeof OmoMemorySyncSchema>
export type OmoMemorySearch = z.infer<typeof OmoMemorySearchSchema>
export type OmoMemoryNudge = z.infer<typeof OmoMemoryNudgeSchema>
export type OmoMemoryFacts = z.infer<typeof OmoMemoryFactsSchema>
export type OmoMemoryDream = z.infer<typeof OmoMemoryDreamSchema>
export type OmoMemoryPeople = z.infer<typeof OmoMemoryPeopleSchema>
export type OmoMemorySoul = z.infer<typeof OmoMemorySoulSchema>
export type OmoMemoryWriteNotice = z.infer<typeof OmoMemoryWriteNoticeSchema>
export type OmoMemoryAgentOverrides = z.infer<typeof OmoMemoryAgentOverridesSchema>
export type OmoMemorySettings = z.infer<typeof OmoMemorySettingsSchema>
export type OmoMemorySettingsLayer = z.infer<typeof OmoMemorySettingsLayerSchema>

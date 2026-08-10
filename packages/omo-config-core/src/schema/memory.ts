import * as z from "zod"

export const OmoMemoryReflectionTriggerSchema = z.object({
  step_count: z.number().int().nonnegative().default(0),
  on_compaction: z.boolean().default(true),
}).strict()

export const OmoMemoryReflectionSchema = z.object({
  trigger: OmoMemoryReflectionTriggerSchema.default({ step_count: 0, on_compaction: true }),
  merge: z.enum(["auto", "integration"]).default("auto"),
  category: z.string().min(1).default("quick"),
  timeout_minutes: z.number().int().positive().default(15),
  sandbox: z.enum(["auto", "required", "off"]).default("auto"),
}).strict()

export const OmoMemorySyncSchema = z.object({
  remote: z.string().min(1).optional(),
  enabled: z.boolean().default(true),
}).strict()

export const OmoMemorySearchSchema = z.object({
  enabled: z.boolean().default(true),
}).strict()

export const OmoMemoryReflectionTriggerLayerSchema = z.object({
  step_count: z.number().int().nonnegative().optional(),
  on_compaction: z.boolean().optional(),
}).strict()

export const OmoMemoryReflectionLayerSchema = z.object({
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

export const OmoMemoryAgentOverridesSchema = z.object({
  enabled: z.boolean().optional(),
  agent: z.string().min(1).optional(),
  reflection: OmoMemoryReflectionLayerSchema.optional(),
  sync: OmoMemorySyncLayerSchema.optional(),
  search: OmoMemorySearchLayerSchema.optional(),
  compile_warn_tokens: z.number().int().positive().optional(),
}).strict()

export const OmoMemorySettingsSchema = z.object({
  enabled: z.boolean().default(true),
  agent: z.string().min(1).default("auto"),
  // "direct" registers the memory tools as always-on ToolDefinitions; "search" opts in to the
  // extension-declared MCP server surfaced through senpi's tool_search catalog.
  tool_exposure: z.enum(["direct", "search"]).default("direct"),
  reflection: OmoMemoryReflectionSchema.default({
    trigger: { step_count: 0, on_compaction: true },
    merge: "auto",
    category: "quick",
    timeout_minutes: 15,
    sandbox: "auto",
  }),
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
  sync: OmoMemorySyncLayerSchema.optional(),
  search: OmoMemorySearchLayerSchema.optional(),
  compile_warn_tokens: z.number().int().positive().optional(),
  agents: z.record(z.string(), OmoMemoryAgentOverridesSchema).optional(),
}).strict()

export type OmoMemoryReflectionTrigger = z.infer<typeof OmoMemoryReflectionTriggerSchema>
export type OmoMemoryReflection = z.infer<typeof OmoMemoryReflectionSchema>
export type OmoMemorySync = z.infer<typeof OmoMemorySyncSchema>
export type OmoMemorySearch = z.infer<typeof OmoMemorySearchSchema>
export type OmoMemoryAgentOverrides = z.infer<typeof OmoMemoryAgentOverridesSchema>
export type OmoMemorySettings = z.infer<typeof OmoMemorySettingsSchema>
export type OmoMemorySettingsLayer = z.infer<typeof OmoMemorySettingsLayerSchema>

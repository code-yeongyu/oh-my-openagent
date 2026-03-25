import { z } from "zod"
import { FallbackModelsSchema } from "./fallback-models"
import { AgentPermissionSchema } from "./internal/permission"

export const FilePermissionSchema = z.object({
  allow: z.array(z.string()).optional(),
  deny: z.array(z.string()).optional(),
})

export type FilePermission = z.infer<typeof FilePermissionSchema>

export const AgentOverrideConfigSchema = z.object({
  /** @deprecated Use `category` instead. Model is inherited from category defaults. */
  model: z.string().optional(),
  fallback_models: FallbackModelsSchema.optional(),
  variant: z.string().optional(),
  /** Category name to inherit model and other settings from CategoryConfig */
  category: z.string().optional(),
  /** Skill names to inject into agent prompt */
  skills: z.array(z.string()).optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  prompt: z.string().optional(),
  /** Text to append to agent prompt. Supports file:// URIs (file:///abs, file://./rel, file://~/home) */
  prompt_append: z.string().optional(),
  tools: z.record(z.string(), z.boolean()).optional(),
  disable: z.boolean().optional(),
  description: z.string().optional(),
  mode: z.enum(["subagent", "primary", "all"]).optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  permission: AgentPermissionSchema.optional(),
  /** Maximum tokens for response. Passed directly to OpenCode SDK. */
  maxTokens: z.number().optional(),
  /** Extended thinking configuration (Anthropic). Overrides category and default settings. */
  thinking: z
    .object({
      type: z.enum(["enabled", "disabled"]),
      budgetTokens: z.number().optional(),
    })
    .optional(),
  /** Reasoning effort level (OpenAI). Overrides category and default settings. */
  reasoningEffort: z.enum(["low", "medium", "high", "xhigh"]).optional(),
  /** Text verbosity level. */
  textVerbosity: z.enum(["low", "medium", "high"]).optional(),
  /** Provider-specific options. Passed directly to OpenCode SDK. */
  providerOptions: z.record(z.string(), z.unknown()).optional(),
  /** Per-message ultrawork override model/variant when ultrawork keyword is detected. */
  ultrawork: z
    .object({
      model: z.string().optional(),
      variant: z.string().optional(),
    })
    .optional(),
  compaction: z
    .object({
      model: z.string().optional(),
      variant: z.string().optional(),
    })
    .optional(),
  file_permissions: FilePermissionSchema.optional(),
})

export const AgentOverridesSchema = z.object({
  build: AgentOverrideConfigSchema.optional(),
  plan: AgentOverrideConfigSchema.optional(),
  sisyphus: AgentOverrideConfigSchema.optional(),
  hephaestus: AgentOverrideConfigSchema.extend({
    allow_non_gpt_model: z.boolean().optional(),
  }).optional(),
  "sisyphus-junior": AgentOverrideConfigSchema.optional(),
  pegasus: AgentOverrideConfigSchema.optional(),
  "OpenCode-Builder": AgentOverrideConfigSchema.optional(),
  prometheus: AgentOverrideConfigSchema.optional(),
  metis: AgentOverrideConfigSchema.optional(),
  momus: AgentOverrideConfigSchema.optional(),
  oracle: AgentOverrideConfigSchema.optional(),
  librarian: AgentOverrideConfigSchema.optional(),
  explore: AgentOverrideConfigSchema.optional(),
  "multimodal-looker": AgentOverrideConfigSchema.optional(),
  atlas: AgentOverrideConfigSchema.optional(),
  "credit-worker": AgentOverrideConfigSchema.optional(),
  "credit-planner": AgentOverrideConfigSchema.optional(),
  "credit-plan-reviewer": AgentOverrideConfigSchema.optional(),
  "credit-executor": AgentOverrideConfigSchema.optional(),
  "credit-tester": AgentOverrideConfigSchema.optional(),
  "credit-server": AgentOverrideConfigSchema.optional(),
})

export type AgentOverrideConfig = z.infer<typeof AgentOverrideConfigSchema>
export type AgentOverrides = z.infer<typeof AgentOverridesSchema>

import { z } from "zod"
import { FallbackModelsSchema } from "./fallback-models"
import { AgentPermissionSchema } from "./internal/permission"

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
  /** Localized display name shown in TUI agent selector (i18n support). Falls back to hardcoded English when not set. */
  displayName: z.string().optional(),
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
  reasoningEffort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]).optional(),
  /** Text verbosity level. */
  textVerbosity: z.enum(["low", "medium", "high"]).optional(),
  /** Provider-specific options. Passed directly to OpenCode SDK. */
  providerOptions: z.record(z.string(), z.unknown()).optional(),
  /** Per-message ultrawork override model/variant when ultrawork keyword is detected. */
  ultrawork: z
    .object({
      model: z.string().optional(),
      variant: z.string().optional(),
      /**
       * Scoped fallback chain used only when an ultrawork-triggered request
       * fails with the override model/variant. Falls back to the agent-level
       * `fallback_models` when omitted, and finally to the hardcoded chain.
       * See #3779 for motivation (#3538 directly demonstrates the failure when
       * variant=max is unsupported by Copilot claude-opus-4.6).
       */
      fallback_models: FallbackModelsSchema.optional(),
    })
    .optional(),
  compaction: z
    .object({
      model: z.string().optional(),
      variant: z.string().optional(),
      /**
       * Scoped fallback chain used only when a compaction-triggered
       * summarization fails with the override model/variant. Falls back to the
       * agent-level `fallback_models` when omitted. Compaction has a separate
       * chain because the summarization model is often deliberately different
       * from the conversation model (e.g. cheap flash for context squeeze).
       * See #3779 / #828 / #2062 for motivation.
       */
      fallback_models: FallbackModelsSchema.optional(),
    })
    .optional(),
})

export const AgentOverridesSchema = z.object({
  build: AgentOverrideConfigSchema.optional(),
  plan: AgentOverrideConfigSchema.optional(),
  sisyphus: AgentOverrideConfigSchema.optional(),
  hephaestus: AgentOverrideConfigSchema.extend({
    allow_non_gpt_model: z.boolean().optional(),
  }).optional(),
  "sisyphus-junior": AgentOverrideConfigSchema.optional(),
  "OpenCode-Builder": AgentOverrideConfigSchema.optional(),
  prometheus: AgentOverrideConfigSchema.optional(),
  metis: AgentOverrideConfigSchema.optional(),
  momus: AgentOverrideConfigSchema.optional(),
  oracle: AgentOverrideConfigSchema.optional(),
  librarian: AgentOverrideConfigSchema.optional(),
  explore: AgentOverrideConfigSchema.optional(),
  "multimodal-looker": AgentOverrideConfigSchema.optional(),
  atlas: AgentOverrideConfigSchema.optional(),
}).catchall(AgentOverrideConfigSchema.optional())

export type AgentOverrideConfig = z.infer<typeof AgentOverrideConfigSchema>
export type AgentOverrides = z.infer<typeof AgentOverridesSchema>

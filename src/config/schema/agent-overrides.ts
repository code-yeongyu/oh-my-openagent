import { z } from "zod"
import { AgentPermissionSchema } from "./internal/permission"

export const AgentOverrideConfigSchema = z.object({
  /** @deprecated Use `category` instead. Model is inherited from category defaults. */
  model: z.string().optional(),
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
  /** Custom fallback chain. Overrides the default AGENT_MODEL_REQUIREMENTS fallback chain for this agent. */
  fallbackChain: z.array(
    z.object({
      providers: z.array(z.string()),
      model: z.string(),
      variant: z.string().optional(),
    })
  ).optional(),
})

export const AgentOverridesSchema = z.object({
  build: AgentOverrideConfigSchema.optional(),
  plan: AgentOverrideConfigSchema.optional(),
  morpheus: AgentOverrideConfigSchema.optional(),
  keymaker: AgentOverrideConfigSchema.optional(),
  mouse: AgentOverrideConfigSchema.optional(),
  "OpenCode-Builder": AgentOverrideConfigSchema.optional(),
  oracle: AgentOverrideConfigSchema.optional(),
  seraph: AgentOverrideConfigSchema.optional(),
  smith: AgentOverrideConfigSchema.optional(),
  merovingian: AgentOverrideConfigSchema.optional(),
  operator: AgentOverrideConfigSchema.optional(),
  trinity: AgentOverrideConfigSchema.optional(),
  construct: AgentOverrideConfigSchema.optional(),
  architect: AgentOverrideConfigSchema.optional(),
  cipher: AgentOverrideConfigSchema.optional(),
  niobe: AgentOverrideConfigSchema.optional(),
  sentinel: AgentOverrideConfigSchema.optional(),
  zion: AgentOverrideConfigSchema.optional(),
})

export type AgentOverrideConfig = z.infer<typeof AgentOverrideConfigSchema>
export type AgentOverrides = z.infer<typeof AgentOverridesSchema>

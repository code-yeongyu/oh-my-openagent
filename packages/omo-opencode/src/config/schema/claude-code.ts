import { z } from "zod"

export const ClaudeCodeConfigSchema = z.object({
  mcp: z.boolean().optional(),
  commands: z.boolean().optional(),
  skills: z.boolean().optional(),
  agents: z.boolean().optional(),
  hooks: z.boolean().optional(),
  plugins: z.boolean().optional(),
  plugins_override: z.record(z.string(), z.boolean()).optional(),
  /** Override the provider used for Claude Code agent model aliases (opus/sonnet/haiku).
   * Default: "anthropic". Set to your provider name if you proxy Anthropic models
   * through a custom gateway (e.g., "kiro", "my-gateway"). */
  anthropic_provider: z.string().trim().min(1).refine((v) => !v.includes("/"), {
    message: "anthropic_provider must be a provider name without '/'",
  }).optional(),
})

export type ClaudeCodeConfig = z.infer<typeof ClaudeCodeConfigSchema>

import { z } from "zod";

export const ClaudeCodeConfigSchema = z.object({
  enabled: z.boolean().optional(),
  mcp: z.boolean().optional(),
  commands: z.boolean().optional(),
  skills: z.boolean().optional(),
  agents: z.boolean().optional(),
  hooks: z.boolean().optional(),
  plugins: z.boolean().optional(),
  plugins_override: z.record(z.string(), z.boolean()).optional(),
});

export type ClaudeCodeConfig = z.infer<typeof ClaudeCodeConfigSchema>;

type ComponentKey = keyof Omit<
  ClaudeCodeConfig,
  "enabled" | "plugins_override"
>;

/**
 * Returns whether a Claude Code component is enabled.
 * `enabled: false` on the parent object is a hard master gate that overrides
 * all per-component flags.
 */
export function isClaudeCodeEnabled(
  claudeCode: ClaudeCodeConfig | undefined,
  component: ComponentKey,
): boolean {
  if (claudeCode?.enabled === false) return false;
  return claudeCode?.[component] ?? true;
}

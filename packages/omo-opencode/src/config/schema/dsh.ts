import { z } from "zod"

export const DshConfigSchema = z.object({
  /** Enable the DeepSeek Harness (dsh) executor tool (default: false) */
  enabled: z.boolean().default(false),
  /** Execution mode: headless one-shot profile (published CLI) or ACP protocol server */
  mode: z.enum(["headless", "acp"]).default("headless"),
  /** Executable to spawn per run (default: npx) */
  command: z.string().default("npx"),
  /** Base arguments for the dsh CLI (default: npx -y @deepseek-ai/dsh; -y avoids an interactive install prompt) */
  args: z.array(z.string()).default(["-y", "@deepseek-ai/dsh"]),
  /** Optional working-directory override for the child process */
  cwd: z.string().optional(),
  /** Auto-answer policy for the ACP child's permission requests (ACP mode only) */
  permission: z.enum(["reject", "allow_once"]).default("allow_once"),
  /** Hard timeout for one dsh agent run (default: 300000 ms) */
  timeout_ms: z.number().min(1000).max(3600000).default(300000),
})

export type DshConfig = z.infer<typeof DshConfigSchema>

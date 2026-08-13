import { z } from "zod"

export const DshConfigSchema = z.object({
  /** Enable the DeepSeek Harness (dsh) ACP executor tool (default: false) */
  enabled: z.boolean().default(false),
  /** Executable to spawn per run (default: npx) */
  command: z.string().default("npx"),
  /** Arguments for the dsh ACP server entry (default: @deepseek-ai/dsh acp) */
  args: z.array(z.string()).default(["@deepseek-ai/dsh", "acp"]),
  /** Optional working-directory override for the child process and its ACP session */
  cwd: z.string().optional(),
  /** Auto-answer policy for the child's permission requests (default: reject) */
  permission: z.enum(["reject", "allow_once"]).default("reject"),
  /** Hard timeout for one dsh agent run (default: 300000 ms) */
  timeout_ms: z.number().min(1000).max(3600000).default(300000),
})

export type DshConfig = z.infer<typeof DshConfigSchema>

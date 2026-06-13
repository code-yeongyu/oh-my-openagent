import { z } from "zod"

/** MetaGovernor config - self-judging agent orchestration layer. */
export const MetaGovernorConfigSchema = z.object({
  /** Master switch. Default false until the feature is proven stable. */
  enabled: z.boolean().default(false),
  /** Hook to enable: listens on tool.execute.after for recoverable errors. */
  hook_enabled: z.boolean().default(true),
  /** Which tools trigger MetaGovernor analysis after execution. */
  observed_tools: z.array(z.string()).default(["edit", "bash", "task"]),
})

export type MetaGovernorConfig = z.infer<typeof MetaGovernorConfigSchema>

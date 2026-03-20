import { z } from "zod"

export const CodeGraphContextConfigSchema = z.object({
  /** Enable code-graph-context MCP (default: false). Requires cgc binary installed. */
  enabled: z.boolean().default(false),
  /** Override path to cgc binary. If omitted, searches PATH and common locations. */
  binary_path: z.string().optional(),
})

export type CodeGraphContextConfig = z.infer<typeof CodeGraphContextConfigSchema>

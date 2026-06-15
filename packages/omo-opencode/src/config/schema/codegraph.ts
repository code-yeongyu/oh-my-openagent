import { z } from "zod"

export const CodegraphConfigSchema = z.object({
  auto_provision: z.boolean().default(true),
  enabled: z.boolean().default(true),
  install_dir: z.string().optional(),
  telemetry: z.boolean().optional(),
  watch_debounce_ms: z.number().nonnegative().optional(),
})

export type CodegraphConfig = z.infer<typeof CodegraphConfigSchema>

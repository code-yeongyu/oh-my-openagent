import { z } from "zod"

export const CodegraphConfigSchema = z.object({
  auto_init: z.boolean().default(true),
  auto_provision: z.boolean().default(true),
  daemon: z.boolean().default(false),
  enabled: z.boolean().default(true),
  excluded_roots: z.array(z.string()).optional(),
  install_dir: z.string().optional(),
  telemetry: z.boolean().optional(),
  watch_debounce_ms: z.number().nonnegative().optional(),
})

export type CodegraphConfig = z.infer<typeof CodegraphConfigSchema>

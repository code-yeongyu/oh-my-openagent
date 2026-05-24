import { z } from "zod"
export const CodeGraphConfigSchema = z.object({
  enabled: z.boolean().default(true),
  auto_init: z.boolean().default(true),
  init_timeout_ms: z.number().min(1000).max(120000).default(30000),
  fallback_on_error: z.boolean().default(true),
  fallback_on_empty: z.boolean().default(true),
  prefer_codegraph: z.boolean().default(true),
})
export type CodeGraphConfig = z.infer<typeof CodeGraphConfigSchema>

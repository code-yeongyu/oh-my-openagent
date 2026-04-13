import { z } from "zod"

export const PreviewAgentConfigSchema = z.object({
  image: z.enum(["node:20", "python:3.11"]).default("node:20"),
  port: z.number().default(3000),
  domain: z.string().default("localhost:8080"),
  watch_interval_ms: z.number().default(1000),
  auto_renew_minutes: z.number().default(10),
})

export type PreviewAgentConfig = z.infer<typeof PreviewAgentConfigSchema>
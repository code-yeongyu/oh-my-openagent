import { z } from "zod"

export const ProviderConfigSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  baseUrl: z.string().url(),
  apiKeyEnv: z.string().optional(),
  models: z.array(z.string()).default(["*"]),
  maxConcurrency: z.number().int().positive().default(1),
  weight: z.number().int().min(0).max(100).default(50),
})

export const MultiProviderConfigSchema = z.object({
  enabled: z.boolean().default(false),
  providers: z.array(ProviderConfigSchema).default([]),
})

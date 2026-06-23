import { z } from "zod"
import { DEFAULT_OPENAI_COMPAT_HOST, DEFAULT_OPENAI_COMPAT_PORT_START } from "./defaults"

export const OpenAICompatConfigSchema = z.object({
  host: z.string().min(1).default(DEFAULT_OPENAI_COMPAT_HOST),
  port: z.number().int().min(0).max(65_535).default(DEFAULT_OPENAI_COMPAT_PORT_START),
  bearer_token: z.string().min(1, "bearer_token is required"),
  version: z.string().min(1).default("0.4.0"),
})

export type OpenAICompatConfig = z.infer<typeof OpenAICompatConfigSchema>

export type OpenAICompatConfigInput = z.input<typeof OpenAICompatConfigSchema>

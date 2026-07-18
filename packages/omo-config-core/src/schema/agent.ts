import * as z from "zod"

export const OmoAgentDefSchema = z.object({
  description: z.string().optional(),
  prompt: z.string().optional(),
  model: z.string().optional(),
  models: z.array(z.string()).optional(),
  tools: z.record(z.string(), z.boolean()).optional(),
  execution_mode: z.enum(["in-process", "process"]).optional(),
  background: z.boolean().optional(),
  max_depth: z.number().int().nonnegative().optional(),
  allowed_subagents: z.array(z.string()).optional(),
  temperature: z.number().min(0).max(2).optional(),
  disable: z.boolean().optional(),
}).strict()

export const OmoAgentsConfigSchema = z.record(z.string(), OmoAgentDefSchema)

export type OmoAgentDef = z.infer<typeof OmoAgentDefSchema>
export type OmoAgentsConfig = z.infer<typeof OmoAgentsConfigSchema>

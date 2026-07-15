import { z } from "zod"

const AgentPermissionRuleSchema = z.object({
  permission: z.string(),
  pattern: z.string(),
  action: z.enum(["allow", "ask", "deny"]),
})

const FinalOpenCodeAgentSchema = z.looseObject({
  name: z.string(),
  mode: z.enum(["subagent", "primary", "all"]),
  native: z.boolean().nullish(),
  hidden: z.boolean().nullish(),
  permission: z.array(AgentPermissionRuleSchema),
  model: z.object({
    providerID: z.string(),
    modelID: z.string(),
  }).nullish(),
  variant: z.string().nullish(),
  prompt: z.string().nullish(),
})

const FinalOpenCodeAgentRegistryResponseSchema = z.union([
  z.array(FinalOpenCodeAgentSchema),
  z.object({ data: z.array(FinalOpenCodeAgentSchema) }),
])

export type FinalOpenCodeAgent = z.infer<typeof FinalOpenCodeAgentSchema>

export class FinalOpenCodeAgentRegistryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "FinalOpenCodeAgentRegistryError"
  }
}

export function parseFinalOpenCodeAgentRegistry(response: unknown): readonly FinalOpenCodeAgent[] {
  const result = FinalOpenCodeAgentRegistryResponseSchema.safeParse(response)
  if (!result.success) {
    throw new FinalOpenCodeAgentRegistryError(`OpenCode returned an invalid final agent registry: ${result.error.message}`)
  }
  return Array.isArray(result.data) ? result.data : result.data.data
}

import { z } from "zod"

const AgentDefinitionPathSchema = z.string().min(1)

export const AgentDefinitionsConfigSchema = z.array(AgentDefinitionPathSchema).optional()

export type AgentDefinitions = z.infer<typeof AgentDefinitionsConfigSchema>

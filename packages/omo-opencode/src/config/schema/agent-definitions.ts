import { z } from "zod"

export const AgentDefinitionPathSchema = z.string().min(1)

export const AgentDefinitionsConfigSchema = z.array(AgentDefinitionPathSchema).optional()

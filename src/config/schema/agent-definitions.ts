import { z } from "zod"

export const AgentDefinitionPathSchema = z.string()

export const AgentDefinitionsConfigSchema = z.array(AgentDefinitionPathSchema).optional()

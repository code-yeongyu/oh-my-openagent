import { z } from "zod"

/**
 * Help JSON schema for the `system-prompt` surface.
 * Defines the structure of system prompt configuration output.
 */
export const SystemPromptVariableSchema = z
  .object({
    name: z.string().describe("Variable name"),
    value: z.string().describe("Variable value"),
    description: z.string().optional().describe("Variable description"),
  })
  .meta({ ref: "SystemPromptVariable" })

export const SystemPromptSectionSchema = z
  .object({
    id: z.string().describe("Section identifier"),
    title: z.string().describe("Section title"),
    content: z.string().describe("Section content (plain text or markdown)"),
    variables: z.array(SystemPromptVariableSchema).optional().describe("Variables used in this section"),
    enabled: z.boolean().describe("Whether this section is active"),
  })
  .meta({ ref: "SystemPromptSection" })

export const SystemPromptResultSchema = z
  .object({
    totalLength: z.number().describe("Total prompt length in characters"),
    sections: z.array(SystemPromptSectionSchema).describe("System prompt sections"),
    effectivePrompt: z.string().describe("Fully resolved system prompt text"),
    generatedAt: z.number().describe("Generation timestamp (epoch ms)"),
  })
  .meta({ ref: "SystemPromptResult" })

export type SystemPromptVariable = z.infer<typeof SystemPromptVariableSchema>
export type SystemPromptSection = z.infer<typeof SystemPromptSectionSchema>
export type SystemPromptResult = z.infer<typeof SystemPromptResultSchema>

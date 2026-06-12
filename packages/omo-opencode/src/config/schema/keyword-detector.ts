import { z } from "zod"

export const KeywordTypeSchema = z.enum(["ultrawork", "team", "hyperplan", "hyperplan-ultrawork"])
export type KeywordType = z.infer<typeof KeywordTypeSchema>

export const KeywordDetectorConfigSchema = z.object({
  enabled_expansions: z.array(KeywordTypeSchema).optional(),
  disabled_keywords: z.array(KeywordTypeSchema).optional(),
})

export type KeywordDetectorConfig = z.infer<typeof KeywordDetectorConfigSchema>

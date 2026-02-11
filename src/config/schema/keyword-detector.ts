import { z } from "zod"

export const KeywordDetectorConfigSchema = z.object({
  /** Additional trigger words/phrases that activate ultrawork mode (alongside built-in "ultrawork" and "ulw") */
  extra_ultrawork_aliases: z.array(z.string()).optional(),
})

export type KeywordDetectorConfig = z.infer<typeof KeywordDetectorConfigSchema>

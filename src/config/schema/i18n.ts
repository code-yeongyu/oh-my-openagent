import { z } from "zod"

export const I18nConfigSchema = z.object({
  /** Override auto-detected locale (e.g. "en", "zh"). Falls back to LANG env var if not set. */
  locale: z.string().optional(),
})

export type I18nConfig = z.infer<typeof I18nConfigSchema>

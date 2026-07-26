import * as z from "zod"

export const OmoCodegraphSettingsSchema = z.object({
  daemon: z.boolean().default(false),
}).strict()

export type OmoCodegraphSettings = z.infer<typeof OmoCodegraphSettingsSchema>

import * as z from "zod"

/**
 * How a client draws the four builtin model-profile lanes as a 2x2 pad. The engine never reads it:
 * it is presentation shared by every client through omo.json, so the desktop and any later
 * surface show the same words. A square's own name and model stay in `model_profiles.<lane id>`.
 *
 * `labels` renames the pad's axes: `daily` / `geeky` are the columns, `heavy` / `normal` the rows.
 * An unset label keeps the builtin word.
 */
const OmoModelPadLabelsSchema = z.object({
  daily: z.string().optional(),
  geeky: z.string().optional(),
  normal: z.string().optional(),
  heavy: z.string().optional(),
}).strict()

export const OmoModelPadSchema = z.object({
  labels: OmoModelPadLabelsSchema.optional(),
}).strict()

export type OmoModelPad = z.infer<typeof OmoModelPadSchema>

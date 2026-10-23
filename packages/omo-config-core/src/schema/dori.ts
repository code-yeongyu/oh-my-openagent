import * as z from "zod"

/**
 * The `dori` section belongs to a separately installed package, which validates it. omo only
 * accepts the key as an object, so an omo.json that carries the section loads without an
 * unknown-key diagnostic; omo itself never reads it.
 */
export const OmoDoriSectionSchema = z
  .record(z.string(), z.unknown())
  .describe("Chat-surface dori settings, owned and validated by a separately installed dori package. omo accepts the key and never reads it.")

export type OmoDoriSection = z.infer<typeof OmoDoriSectionSchema>

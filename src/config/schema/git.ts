import { z } from "zod"

export const NativeGitModeSchema = z.enum(["manual", "tracked", "strict"])

export const NativeGitConfigSchema = z.object({
  /** Native Git tracking mode. strict is schema-only for now; v1 implements manual and tracked behavior. */
  mode: NativeGitModeSchema.default("tracked"),
  /** Write audit records under the Git common dir instead of the working tree. */
  audit_log: z.boolean().default(true),
})

export type NativeGitConfig = z.infer<typeof NativeGitConfigSchema>

import * as z from "zod"

export const OmoProvenanceSettingsSchema = z.object({
  workspaces: z.array(z.object({
    name: z.string().trim().min(1).regex(/\S/),
    git_owners: z.array(z.string().trim().min(1).regex(/\S/)).optional(),
    paths: z.array(z.string().trim().min(1).regex(/\S/)).optional(),
  }).strict()).optional(),
}).strict()

export type OmoProvenanceSettings = z.infer<typeof OmoProvenanceSettingsSchema>

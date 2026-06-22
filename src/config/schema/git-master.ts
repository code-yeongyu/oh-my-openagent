import { z } from "zod"

// Kept for backward compatibility — was previously used for commit attribution.
export const GitMasterConfigSchema = z.object({}).passthrough()

export type GitMasterConfig = z.infer<typeof GitMasterConfigSchema>

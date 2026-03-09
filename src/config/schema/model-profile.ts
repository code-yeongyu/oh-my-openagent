import { z } from "zod"

export const ModelProfileSchema = z.enum(["premium", "balanced", "economy"]).optional()

export type ModelProfile = z.infer<typeof ModelProfileSchema>

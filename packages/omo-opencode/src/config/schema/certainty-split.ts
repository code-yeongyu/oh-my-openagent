import { z } from "zod"

export const CertaintySplitConfigSchema = z
  .object({
    framework_high_threshold: z.number().min(0).max(1).default(0.75),
    framework_medium_threshold: z.number().min(0).max(1).default(0.45),
    world_high_threshold: z.number().min(0).max(1).default(0.75),
    world_medium_threshold: z.number().min(0).max(1).default(0.45),
  })
  .refine((data) => data.framework_high_threshold >= data.framework_medium_threshold, {
    message: "framework_high_threshold must be >= framework_medium_threshold",
    path: ["framework_high_threshold"],
  })
  .refine((data) => data.world_high_threshold >= data.world_medium_threshold, {
    message: "world_high_threshold must be >= world_medium_threshold",
    path: ["world_high_threshold"],
  })

export type CertaintySplitConfig = z.infer<typeof CertaintySplitConfigSchema>

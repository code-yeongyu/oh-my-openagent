import { z } from "zod"

export const EpistemicThresholdsSchema = z
  .object({
    n: z.number().int().min(1).default(3),
    m: z.number().int().min(1).default(5),
    k: z.number().int().min(1).default(10),
    t: z.number().int().min(1).default(50),
  })
  .refine((data) => data.m >= data.n, {
    message: "m must be >= n",
    path: ["m"],
  })
  .refine((data) => data.k >= data.m, {
    message: "k must be >= m",
    path: ["k"],
  })

export type EpistemicThresholds = z.infer<typeof EpistemicThresholdsSchema>

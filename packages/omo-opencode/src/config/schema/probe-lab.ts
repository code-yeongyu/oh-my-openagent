import { z } from "zod"

export const ProbeLabConfigSchema = z.object({
  force_drivers_register: z.boolean().optional().default(false),
})

export type ProbeLabConfig = z.infer<typeof ProbeLabConfigSchema>

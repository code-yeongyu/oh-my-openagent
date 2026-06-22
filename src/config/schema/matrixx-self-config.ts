import { z } from "zod"

export const MatrixxSelfConfigSkillConfigSchema = z.object({
  /** Enable matrixx-self-config skill (default: false - opt-in feature) */
  enabled: z.boolean().default(false),
  /** Enable proactive mode for matrixx-self-config skill (default: false - opt-in) */
  proactive: z.boolean().default(false),
})

export type MatrixxSelfConfigSkillConfig = z.infer<typeof MatrixxSelfConfigSkillConfigSchema>

import { z } from "zod"

export const VerificationReminderConfigSchema = z.object({
  /** Enable verification reminder (default: true). Can also be disabled via disabled_hooks. */
  enabled: z.boolean().optional(),
  /** Tools that trigger verification tracking (default: edit, write, hashline_edit, apply_patch, multi_edit, notepad_edit) */
  tracked_tools: z.array(z.string()).optional(),
  /** Custom verification prompt. Use {original_request} and {changes} as placeholders. */
  custom_prompt: z.string().max(4096).optional(),
  /** Delay in ms before prompting verification after idle (default: 150) */
  settle_ms: z.number().min(0).max(5000).optional(),
})

export type VerificationReminderConfig = z.infer<typeof VerificationReminderConfigSchema>

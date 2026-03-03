import { z } from "zod"
import { COUNCIL_DEFAULTS } from "../../agents/athena/constants"
import { parseModelString } from "../../tools/delegate-task/model-string-parser"

/** Validates model string format: "provider/model-id" (e.g., "openai/gpt-5.3-codex"). */
const ModelStringSchema = z
  .string()
  .min(1)
  .refine(
    (model) => parseModelString(model) !== undefined,
    { message: 'Model must be in "provider/model-id" format (e.g., "openai/gpt-5.3-codex")' }
  )

export const CouncilMemberSchema = z.object({
  model: ModelStringSchema,
  variant: z.string().optional(),
  name: z.string().min(1).trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9 .\-]*$/, {
    message: "Council member name must contain only letters, numbers, spaces, hyphens, and dots",
  }),
  temperature: z.number().min(0).max(2).optional(),
}).strict()

export const CouncilConfigSchema = z.object({
  members: z.array(CouncilMemberSchema).min(2),
  retry_on_fail: z.number().min(0).max(5).default(0),
  retry_failed_if_others_finished: z.boolean().default(false),
  cancel_retrying_on_quorum: z.boolean().default(true),
  stuck_threshold_seconds: z.number().min(30).default(COUNCIL_DEFAULTS.STUCK_THRESHOLD_SECONDS),
  member_max_running_seconds: z.number().min(60).default(COUNCIL_DEFAULTS.MEMBER_MAX_RUNNING_SECONDS),
}).strict()

export type CouncilMemberConfig = z.infer<typeof CouncilMemberSchema>
export type CouncilConfig = z.infer<typeof CouncilConfigSchema>

export const AthenaConfigSchema = z.object({
  council: CouncilConfigSchema,
  bulk_launch: z.boolean().default(false).optional(),
  non_interactive_mode: z.enum(["delegation", "solo"]).default("delegation").optional(),
  non_interactive_members: z.enum(["all", "custom"]).default("all").optional(),
  non_interactive_member_list: z.array(z.string()).optional(),
}).strict()

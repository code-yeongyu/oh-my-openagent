import { z } from "zod"

/**
 * Display config — surfaces the model + provider behind each role so the
 * user (and team leaders) can see which model is actually answering and
 * pick a different chain entry mid-session.
 *
 * Surface: a markdown panel injected by /show-models (and optionally on
 * session start / on fallback events). See src/features/roles-models/.
 */
export const DisplayConfigSchema = z.object({
  /** Print the roles-models panel once when a session starts. */
  show_models_on_session_start: z.boolean().default(false),
  /** Print the panel into the next message after a fallback/substitution event. */
  show_models_on_fallback: z.boolean().default(false),
  /**
   * Allow agents (and team leaders) to swap a role's active model
   * mid-session via the pick_model tool. Off by default to keep behavior
   * deterministic.
   */
  auto_pick: z.boolean().default(false),
  /** Max model swaps an agent can make for a single role within one session. */
  auto_pick_budget: z.number().int().min(0).default(2),
})

export type DisplayConfig = z.infer<typeof DisplayConfigSchema>

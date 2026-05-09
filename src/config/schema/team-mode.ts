import { z } from "zod"

export const MemberSelectionModeSchema = z.enum(["stable", "creative"])
export type MemberSelectionMode = z.infer<typeof MemberSelectionModeSchema>

/** Team Mode config - see .sisyphus/plans/team-mode.md (D-01/D-25). */
export const TeamModeConfigSchema = z.object({
  enabled: z.boolean().default(false),
  tmux_visualization: z.boolean().default(false),
  max_parallel_members: z.number().int().min(1).max(8).default(4),
  max_members: z.number().int().min(1).max(8).default(8),
  max_messages_per_run: z.number().int().min(1).default(10000),
  max_wall_clock_minutes: z.number().int().min(1).default(120),
  max_member_turns: z.number().int().min(1).default(500),
  base_dir: z.string().optional(),
  message_payload_max_bytes: z.number().int().min(1024).default(32768),
  recipient_unread_max_bytes: z.number().int().min(1024).default(262144),
  mailbox_poll_interval_ms: z.number().int().min(500).default(3000),
  // "stable" (default) broadcasts the lead's resolved model to followers
  // that lack their own pick — produces deterministic, reproducible team
  // runs. "creative" round-robins each follower across the agent's
  // reachable fallback chain — deliberate diversity for adversarial review
  // / ensemble flows. In both modes every member ends up with
  // modelIntent: "explicit", so sticky-mode protects all of them.
  member_selection: MemberSelectionModeSchema.default("stable"),
})

export type TeamModeConfig = z.infer<typeof TeamModeConfigSchema>

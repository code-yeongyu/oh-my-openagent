import { z } from "zod"
import { TMUX_ISOLATION_VALUES, TMUX_LAYOUT_VALUES } from "@oh-my-opencode/tmux-core"
import type { TmuxConfig, TmuxIsolation, TmuxLayout } from "@oh-my-opencode/tmux-core"

export const TmuxLayoutSchema = z.enum(TMUX_LAYOUT_VALUES)

export const TmuxIsolationSchema = z.enum(TMUX_ISOLATION_VALUES)

export const TmuxConfigSchema = z.object({
  enabled: z.boolean().default(false),
  layout: TmuxLayoutSchema.default("main-vertical"),
  main_pane_size: z.number().min(20).max(80).default(60),
  main_pane_min_width: z.number().min(40).default(120),
  agent_pane_min_width: z.number().min(20).default(40),
  isolation: TmuxIsolationSchema.default("inline"),
  // Override when opencode auto-detects the wrong IP (e.g. Tailscale).
  // Empty string / null are treated as unset.
  server_url_override: z.preprocess(
    (val) => (val === "" || val === null ? undefined : val),
    z.string().url().optional(),
  ),
}) satisfies z.ZodType<TmuxConfig>

export type { TmuxConfig, TmuxIsolation, TmuxLayout }

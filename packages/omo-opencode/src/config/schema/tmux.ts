import { z } from "zod"
import { MULTIPLEXER_VALUES, TMUX_ISOLATION_VALUES, TMUX_LAYOUT_VALUES } from "@oh-my-opencode/tmux-core"
import type { MultiplexerBackend, TmuxConfig, TmuxIsolation, TmuxLayout } from "@oh-my-opencode/tmux-core"

export const TmuxLayoutSchema = z.enum(TMUX_LAYOUT_VALUES)

export const TmuxIsolationSchema = z.enum(TMUX_ISOLATION_VALUES)

export const MultiplexerBackendSchema = z.enum(MULTIPLEXER_VALUES)

export const TmuxConfigSchema = z.object({
  enabled: z.boolean().default(false),
  layout: TmuxLayoutSchema.default("main-vertical"),
  main_pane_size: z.number().min(20).max(80).default(60),
  main_pane_min_width: z.number().min(40).default(120),
  agent_pane_min_width: z.number().min(20).default(40),
  isolation: TmuxIsolationSchema.default("inline"),
  multiplexer: MultiplexerBackendSchema.default("tmux"),
}) satisfies z.ZodType<TmuxConfig>

export type { MultiplexerBackend, TmuxConfig, TmuxIsolation, TmuxLayout }

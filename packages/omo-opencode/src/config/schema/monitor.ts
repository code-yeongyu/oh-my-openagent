import { z } from "zod"

export const MonitorConfigSchema = z.object({
  enabled: z.boolean().default(false),
  live_mode_enabled: z.boolean().default(false),
  allowed_commands: z.array(z.string()).optional(),
  max_monitors_per_session: z.number().int().min(1).max(16).default(3),
  /** Longest a monitor may run before it is stopped, whatever timeout_ms its call asks for, in milliseconds (0 = no cap). */
  max_runtime_ms: z.union([z.literal(0), z.number().int().min(1000)]).default(1800000),
  batch_max_lines: z.number().int().min(1).default(50),
  batch_max_bytes: z.number().int().min(1024).default(16384),
  /** Output lines arriving within this window form one event batch. */
  flush_interval_ms: z.number().int().min(50).default(200),
  ring_max_lines: z.number().int().min(1).default(1000),
  line_max_bytes: z.number().int().min(256).default(8192),
  pattern_max_length: z.number().int().min(1).default(512),
})

export type MonitorConfig = z.infer<typeof MonitorConfigSchema>

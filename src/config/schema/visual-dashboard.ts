import { z } from "zod"

export const VisualDashboardConfigSchema = z.object({
  enabled: z.boolean().default(false),
  inline_indicators: z.boolean().default(true),
  web_dashboard: z.boolean().default(false),
  web_dashboard_port: z.number().int().min(1024).max(65535).default(4321),
  tmux_status_bar: z.boolean().default(false),
  notifications: z.object({
    on_task_complete: z.boolean().default(true),
    on_error: z.boolean().default(true),
    on_team_member_join: z.boolean().default(false),
    desktop: z.boolean().default(false),
    sound: z.boolean().default(false),
  }).default({
    on_task_complete: true,
    on_error: true,
    on_team_member_join: false,
    desktop: false,
    sound: false,
  }),
  cli_dashboard: z.boolean().default(false),
})

export type VisualDashboardConfig = z.infer<typeof VisualDashboardConfigSchema>

import * as z from "zod"

/**
 * Operator alerts (#14430). `error_streak`: when one session ends `threshold` runs in a row with `stopReason: "error"`,
 * one alert goes to each address in `threads` (through thread_send, as the failing session) and to the JSON webhook whose
 * URL is in the environment variable `webhook_url_env` names; the URL itself never sits in a config file. While the streak
 * lasts, a "still failing" alert follows every `realert_minutes` (0: none), and the first normal stop sends "recovered".
 */
export const OmoOperatorAlertsSettingsSchema = z
  .object({
    error_streak: z
      .object({
        threshold: z.number().int().min(1).optional(),
        realert_minutes: z.number().min(0).optional(),
        threads: z.array(z.string().trim().min(1)).optional(),
        webhook_url_env: z
          .string()
          .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

export type OmoOperatorAlertsSettings = z.infer<typeof OmoOperatorAlertsSettingsSchema>

export type ResolvedErrorStreakSettings = {
  readonly threshold: number
  readonly realertMs: number
  readonly threads: readonly string[]
  readonly webhookUrlEnv: string | undefined
}

const ERROR_STREAK_DEFAULT_THRESHOLD = 10
const ERROR_STREAK_DEFAULT_REALERT_MINUTES = 60

export function resolveErrorStreakSettings(config: {
  readonly operator_alerts?: OmoOperatorAlertsSettings | undefined
}): ResolvedErrorStreakSettings {
  const streak = config.operator_alerts?.error_streak
  return {
    threshold: streak?.threshold ?? ERROR_STREAK_DEFAULT_THRESHOLD,
    realertMs: (streak?.realert_minutes ?? ERROR_STREAK_DEFAULT_REALERT_MINUTES) * 60_000,
    threads: [...new Set(streak?.threads ?? [])],
    webhookUrlEnv: streak?.webhook_url_env,
  }
}

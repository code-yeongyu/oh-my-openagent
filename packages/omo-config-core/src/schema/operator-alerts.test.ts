import { expect, test } from "bun:test"

import {
  OmoConfigLayerSchema,
  OmoConfigProfileSchema,
  OmoConfigSchema,
  OmoTypedHarnessConfigSchema,
  resolveErrorStreakSettings,
} from "../index"

// Config contract (#14430): with no operator_alerts table the error-streak alert fires at 10 errors in a row, repeats
// hourly and has no target; the webhook is named by an environment variable, never by a URL in a config file.

test("#given no operator_alerts table #when the settings are resolved #then the threshold is 10, the re-alert interval an hour, and no target is set", () => {
  expect(resolveErrorStreakSettings(OmoConfigSchema.parse({}))).toEqual({
    threshold: 10,
    realertMs: 60 * 60_000,
    threads: [],
    webhookUrlEnv: undefined,
  })
})

test("#given an error_streak table on every config layer #when it is parsed and resolved #then its values survive and a repeated thread is kept once", () => {
  const operator_alerts = {
    error_streak: { threshold: 3, realert_minutes: 0, threads: ["duty", "duty", "ops"], webhook_url_env: "ALERT_HOOK" },
  }
  for (const schema of [OmoConfigSchema, OmoConfigLayerSchema, OmoConfigProfileSchema, OmoTypedHarnessConfigSchema]) {
    expect(schema.parse({ operator_alerts }).operator_alerts).toEqual(operator_alerts)
  }
  expect(resolveErrorStreakSettings(OmoConfigSchema.parse({ operator_alerts }))).toEqual({
    threshold: 3,
    realertMs: 0,
    threads: ["duty", "ops"],
    webhookUrlEnv: "ALERT_HOOK",
  })
})

test("#given a webhook URL or a zero threshold in the config #when it is parsed #then it is refused", () => {
  expect(
    OmoConfigSchema.safeParse({ operator_alerts: { error_streak: { webhook_url_env: "https://hooks.example/x" } } })
      .success,
  ).toBe(false)
  expect(OmoConfigSchema.safeParse({ operator_alerts: { error_streak: { threshold: 0 } } }).success).toBe(false)
})

import { restoreEnvironment } from "./environment-integrity"

const TELEMETRY_ENV_KEYS = [
  "DO_NOT_TRACK",
  "OMO_DISABLE_TELEMETRY",
  "OMO_DISABLE_POSTHOG",
  "OMO_SEND_ANONYMOUS_TELEMETRY",
  "OMO_CODEX_DISABLE_POSTHOG",
  "OMO_CODEX_SEND_ANONYMOUS_TELEMETRY",
  "POSTHOG_API_KEY",
  "POSTHOG_HOST",
] as const

export function isolateTelemetryEnv(): () => void {
  const snapshot = { ...process.env }
  for (const key of TELEMETRY_ENV_KEYS) delete process.env[key]
  return () => restoreEnvironment(snapshot)
}

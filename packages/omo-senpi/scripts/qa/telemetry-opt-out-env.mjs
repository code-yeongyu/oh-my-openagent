// The one place a QA driver decides what a child it launches may report. Every driver that boots the
// real plugin or runtime passes the child environment through withTelemetryOptOut, so QA traffic never
// reaches the production analytics project. A driver that proves telemetry itself opts back in only
// toward a loopback sink, through telemetryLocalSinkEnv. telemetry-opt-out-env.test.mjs fails when a
// driver spawns the runtime without this module (or isolatedChildEnv, which uses it).

/** Every opt-out the runtime honors (telemetry-core `shouldDisableTelemetry`). */
export const TELEMETRY_OPT_OUT_NAMES = [
  "DO_NOT_TRACK",
  "OMO_DISABLE_TELEMETRY",
  "OMO_DISABLE_POSTHOG",
  "OMO_SENPI_DISABLE_POSTHOG",
  "OMO_SEND_ANONYMOUS_TELEMETRY",
  "OMO_SENPI_SEND_ANONYMOUS_TELEMETRY",
]

export const TELEMETRY_OPT_OUT_ENV = Object.freeze({ DO_NOT_TRACK: "1", OMO_DISABLE_TELEMETRY: "1" })

/** `env` with telemetry forced off, whatever the caller exported. */
export function withTelemetryOptOut(env) {
  return { ...env, ...TELEMETRY_OPT_OUT_ENV }
}

/**
 * Overrides that turn telemetry back on for a child, pointed at a local capture server. Spread it AFTER
 * withTelemetryOptOut (or isolatedChildEnv). A non-loopback sink is refused: QA never opts in toward a
 * real analytics host.
 */
export function telemetryLocalSinkEnv(sinkUrl) {
  const { hostname } = new URL(sinkUrl)
  if (!["127.0.0.1", "localhost", "[::1]"].includes(hostname)) {
    throw new Error(`telemetry QA sink must be loopback, got ${hostname}`)
  }
  return { ...Object.fromEntries(TELEMETRY_OPT_OUT_NAMES.map((name) => [name, ""])), POSTHOG_HOST: sinkUrl }
}

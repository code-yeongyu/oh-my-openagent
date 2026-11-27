import { isOmoTelemetryEnabled, loadOmoConfig } from "@oh-my-opencode/omo-config-core"

/**
 * The config half of the one opt-out (#14920): `telemetry.enabled: false` in omo.json stops the
 * codex daily ping like every other sender. An unreadable config keeps the documented default (on);
 * the env opt-outs still apply independently.
 */
export function isOmoConfigTelemetryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    return isOmoTelemetryEnabled(loadOmoConfig({ env, harness: "codex" }).config)
  } catch {
    return true
  }
}

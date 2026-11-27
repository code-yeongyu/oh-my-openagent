import type { DesktopSessionOpenParams } from "./session-state"

/**
 * Defaults of the feature-gated `session.open` keys. `reportMode` is the omo default (every omo session asks for an
 * `ActionReport` per exec); the others are the engine's own defaults, which the engine never moves.
 */
const GATED_OPTION_DEFAULTS = {
  reportMode: "object",
  intervention: "pause",
  macosKeyPriming: "off",
  trace: false,
} as const

/**
 * The `session.open` params this engine accepts. An engine rejects keys it does not know
 * (`additionalProperties: false`), so each newer key goes out only when hello advertises its feature:
 * each always, with the caller's value or else the default (`reportMode: "object"` unless the caller asked for
 * `"null"`).
 */
export function sessionOpenWire(
  params: DesktopSessionOpenParams,
  features: readonly string[],
): DesktopSessionOpenParams {
  const { reportMode, intervention, macosKeyPriming, trace, ...base } = params
  const has = (feature: string) => features.includes(feature)
  return {
    ...base,
    ...(has("action-report") ? { reportMode: reportMode ?? GATED_OPTION_DEFAULTS.reportMode } : {}),
    ...(has("intervention-policy") ? { intervention: intervention ?? GATED_OPTION_DEFAULTS.intervention } : {}),
    ...(has("key-priming") ? { macosKeyPriming: macosKeyPriming ?? GATED_OPTION_DEFAULTS.macosKeyPriming } : {}),
    ...(has("trace") ? { trace: trace ?? GATED_OPTION_DEFAULTS.trace } : {}),
  }
}

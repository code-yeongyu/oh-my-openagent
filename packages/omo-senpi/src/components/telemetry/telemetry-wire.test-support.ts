import { OMO_NATIVE_COMMON_PROPERTY_SCHEMAS } from "./event-schemas"
import { buildTelemetryArtifacts, wireKeyOf, type TelemetryArtifact } from "./telemetry-artifact"

const SENPI = buildTelemetryArtifacts().find(({ product }) => product === "omo-senpi") as TelemetryArtifact
const COMMON: ReadonlySet<string> = new Set(Object.keys(OMO_NATIVE_COMMON_PROPERTY_SCHEMAS))

/**
 * Projects one emitted PostHog property bag onto the omo-senpi artifact the way the collector sees
 * it (wire key per D-P) and lists every rule it breaks. Common properties travel in the Resource or
 * are added by the relay, so they are not part of the record and are skipped. `$session_id` is
 * checked for presence only: tests inject readable fake hashes, production always sends sha256 hex.
 */
export function wireViolations(event: string, properties: Readonly<Record<string, unknown>>): string[] {
  const attributes = SENPI.events[`omo.${event}`]
  if (attributes === undefined) return [`${event}: no such event in the artifact`]
  const projection = SENPI.resource_projections[`omo.${event}`] ?? {}
  const derived = SENPI.derived_properties[`omo.${event}`] ?? {}
  const violations: string[] = []
  const present = new Set<string>(["log.record.uid"])
  for (const [name, value] of Object.entries(properties)) {
    if (COMMON.has(name) || Object.hasOwn(projection, name) || Object.hasOwn(derived, name)) continue
    const key = wireKeyOf(event, name).key
    const spec = attributes[key]
    if (spec === undefined) {
      violations.push(`${name}: ${key} is not in the artifact`)
      continue
    }
    present.add(key)
    if (name === "$session_id") continue
    if (typeof value !== spec.type) violations.push(`${name}: ${typeof value} is not ${spec.type}`)
    else if (typeof value === "string") {
      if (spec.values !== undefined && !spec.values.includes(value)) violations.push(`${name}: value outside the enum`)
      if (spec.pattern !== undefined && !new RegExp(spec.pattern, "u").test(value)) violations.push(`${name}: value outside the pattern`)
    } else if (typeof value === "number") {
      if (spec.integer === true && !Number.isInteger(value)) violations.push(`${name}: not an integer`)
      if (spec.min !== undefined && value < spec.min) violations.push(`${name}: below min`)
      if (spec.max !== undefined && value > spec.max) violations.push(`${name}: above max`)
    }
  }
  for (const [key, spec] of Object.entries(attributes)) {
    if (spec.required && spec.posthog_name !== undefined && !present.has(key)) violations.push(`${key}: required but missing`)
  }
  return violations
}

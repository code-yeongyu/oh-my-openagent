import semconvMapJson from "./schema-registry/semconv-map.json"

/**
 * The vendored OpenTelemetry attribute contract (plan D-P), byte-identical to the collector's
 * `packages/schema-registry/semconv-map.json` (`schema-registry/PINS.json` records the hash).
 * Imported statically so the bundle inlines it.
 */

export type SemconvKey = {
  readonly wire_key: string
  readonly location: "resource" | "record" | "span"
  readonly posthog_name: string | null
  readonly span_attribute?: boolean
  readonly relay_only?: boolean
}
export type ValueTable = { readonly rows: readonly { readonly id: string; readonly wire: string }[] }
export type SemconvMap = {
  readonly keys: readonly SemconvKey[]
  readonly values: Readonly<Record<string, ValueTable>>
}

export const SEMCONV_MAP: SemconvMap = semconvMapJson as unknown as SemconvMap

/** Our value -> the wire value through a VALUE table; undefined outside the table. */
export function toWireValue(table: string, id: string): string | undefined {
  return SEMCONV_MAP.values[table]?.rows.find((row) => row.id === id)?.wire
}

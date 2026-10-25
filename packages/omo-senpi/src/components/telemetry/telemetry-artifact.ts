import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"

import {
  INSTALL_HASH_PATTERN,
  INSTANCE_ID_PATTERN,
  isPropertyRequired,
  OS_VERSION_PATTERN,
  OTEL_EXCLUDED_PROPERTIES,
  OTEL_NAME_OVERRIDES,
  propertyConstraint,
  SESSION_ID_PATTERN,
  UUID_PATTERN,
  VERSION_PATTERN,
  type PropertyConstraint,
} from "./event-schema-constraints"
import {
  OMO_NATIVE_COMMON_PROPERTY_SCHEMAS,
  OMO_NATIVE_EVENT_SCHEMAS,
  type OmoNativePropertySchema,
} from "./event-schemas"
import { ALL_KNOWN_MODEL_IDS } from "./model-vocabulary"
import { OMO_NATIVE_SCHEMA_VERSION } from "./product-identity"
import { SEMCONV_MAP, type SemconvKey, type ValueTable } from "./semconv-map"
import { TELEMETRY_SESSION_ROLES } from "./session-role"

/**
 * The engine's published telemetry schema artifacts (plan D-I, D-P; todo 11): one per product that
 * sends the engine's events, generated from `OMO_NATIVE_EVENT_SCHEMAS`, the constraints sidecar and
 * the vendored `schema-registry/semconv-map.json`. The collector pins these files and enforces them;
 * `scripts/telemetry-schema-artifact.ts` writes them and a drift test keeps them byte-exact.
 */

const REGISTRY_DIR = new URL("./schema-registry/", import.meta.url)
const SEMCONV_MAP_JSON: unknown = JSON.parse(readFileSync(new URL("semconv-map.json", REGISTRY_DIR), "utf8"))

export const PROTO_TAG = "v1.7.0"
/** The collector's pin: sha256 of the canonical body, so a reformat of the file does not move it. */
export const SEMCONV_MAP_SHA256 = createHash("sha256").update(canonicalJson(SEMCONV_MAP_JSON)).digest("hex")

/**
 * Bare property names that name a concept with an OpenTelemetry semantic convention. Such a property
 * must be mapped in semconv-map.json; giving it an `omo.` key would invent a key the conventions
 * already define, so the generator refuses.
 */
const CONVENTION_NAMES: ReadonlySet<string> = new Set([
  "$os", "$os_version", "os", "os_type", "os_version", "arch", "host_arch", "$session_id", "session_id",
  "event_id", "service_name", "service_version", "package_version", "install_hash", "provider_name",
  "operation_name", "request_model", "response_model", "error_type", "http_method", "status_code", "url",
  "user_id", "thread_id", "exit_code",
])

/**
 * Where each common (shared-block) property travels on the wire. `resource`: the Resource carries it;
 * `record`: every record carries it; `relay`: the PostHog relay adds it, the wire never does.
 */
const COMMON_PROPERTY_PLACEMENT: Readonly<Record<keyof typeof OMO_NATIVE_COMMON_PROPERTY_SCHEMAS, "resource" | "record" | "relay">> = {
  $process_person_profile: "relay",
  ci: "resource",
  event_id: "record",
  install_hash: "resource",
  machine_hash: "record",
  package_version: "resource",
  platform: "relay",
  product_name: "relay",
  schema_version: "resource",
  surface: "resource",
}

/**
 * Mapped keys that apply only to some events: the GenAI usage keys describe ONE model operation, so a
 * window or task aggregate (session_summary, delegation_completed, kibitzer_summary) keeps `omo.` keys.
 */
const EVENT_SCOPED_KEYS: Readonly<Record<string, ReadonlySet<string>>> = {
  "gen_ai.usage.input_tokens": new Set(["turn_completed"]),
  "gen_ai.usage.cache_read.input_tokens": new Set(["turn_completed"]),
  "gen_ai.usage.cache_creation.input_tokens": new Set(["turn_completed"]),
  "gen_ai.usage.output_tokens": new Set(["turn_completed"]),
  "gen_ai.usage.reasoning.output_tokens": new Set(["turn_completed"]),
  "omo.usage.total_tokens": new Set(["turn_completed"]),
}

/** PostHog properties that are derived from a wire attribute rather than sent (D-P: cost_usd). */
const DERIVED_PROPERTIES: Readonly<Record<string, { readonly from: string; readonly divide_by: number; readonly events: ReadonlySet<string> }>> = {
  cost_usd: { from: "omo.cost.usd_1e4", divide_by: 10_000, events: new Set(["turn_completed", "session_summary"]) },
}

export type ArtifactAttribute = {
  readonly type: "boolean" | "number" | "string"
  readonly values?: readonly string[]
  readonly pattern?: string
  readonly integer?: boolean
  readonly min?: number
  readonly max?: number
  readonly required: boolean
  readonly relay_only?: boolean
  readonly posthog_name?: string
}

type AttributeMap = Record<string, ArtifactAttribute>

export type TelemetryArtifact = {
  readonly artifact_format: 1
  readonly product: "omo-senpi" | "omo-cloud"
  readonly schema_version: number
  readonly proto_tag: string
  readonly identity: "install" | "none"
  readonly relay: boolean
  readonly semconv_map_sha256: string
  readonly resource: AttributeMap
  readonly scope: { readonly name: readonly string[]; readonly version: string }
  readonly events: Record<string, AttributeMap>
  readonly spans: Record<string, AttributeMap>
  readonly values: Readonly<Record<string, ValueTable>>
  readonly resource_projections: Record<string, Record<string, string>>
  readonly derived_properties: Record<string, Record<string, { readonly from: string; readonly divide_by: number }>>
  readonly sha256: string
}

const MODEL_VALUES = [...ALL_KNOWN_MODEL_IDS, "custom"]

function valueTable(name: string): ValueTable {
  const table = SEMCONV_MAP.values[name]
  if (table === undefined) throw new Error(`semconv-map.json has no VALUE table ${name}`)
  return table
}

function wireValues(table: string): string[] {
  return [...new Set(valueTable(table).rows.map((row) => row.wire))]
}

/**
 * The wire key of one PostHog property of one event (D-P): the semantic-convention key when the map
 * names one for this property and event, else `omo.` + the bare name. Throws when the name has a
 * convention the map does not cover.
 */
export function wireKeyOf(event: string, property: string): { readonly key: string; readonly location: SemconvKey["location"] } {
  const mapped = SEMCONV_MAP.keys.find((entry) => entry.posthog_name === property)
  if (mapped !== undefined) {
    const scope = EVENT_SCOPED_KEYS[mapped.wire_key]
    if (scope === undefined || scope.has(event)) return { key: mapped.wire_key, location: mapped.location }
  } else if (CONVENTION_NAMES.has(property)) {
    throw new Error(`${event}.${property} has a semantic convention but no entry in semconv-map.json`)
  }
  return { key: `omo.${OTEL_NAME_OVERRIDES[property] ?? property}`, location: "record" }
}

function attribute(owner: string, property: string, schema: OmoNativePropertySchema, required: boolean): ArtifactAttribute {
  const constraint: PropertyConstraint | undefined = propertyConstraint(property, schema)
  if (constraint === undefined) {
    throw new Error(`${owner}.${property}: string property without values or pattern; declare it in event-schema-constraints.ts`)
  }
  return { type: schema.type, ...constraint, required, posthog_name: OTEL_NAME_OVERRIDES[property] ?? property }
}

function sortedObject<T>(entries: Iterable<readonly [string, T]>): Record<string, T> {
  return Object.fromEntries([...entries].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)))
}

function eventAttributes(event: string, properties: Readonly<Record<string, OmoNativePropertySchema>>): {
  readonly attributes: AttributeMap
  readonly projection: Record<string, string>
} {
  const attributes: [string, ArtifactAttribute][] = [
    ["log.record.uid", { type: "string", pattern: UUID_PATTERN, required: true, posthog_name: "event_id" }],
    ["omo.machine_hash", { type: "string", pattern: INSTALL_HASH_PATTERN, required: false, relay_only: true, posthog_name: "machine_hash" }],
  ]
  const projection: Record<string, string> = {}
  for (const [property, schema] of Object.entries(properties)) {
    if (Object.hasOwn(OTEL_EXCLUDED_PROPERTIES, property)) continue
    const derived = DERIVED_PROPERTIES[property]
    if (derived !== undefined && derived.events.has(event)) {
      // The OTel wire carries the cost as an integer (rule.from); the relay derives the PostHog value (derived_properties).
      attributes.push([derived.from, { type: "number", integer: true, min: 0, max: 1e10, required: isPropertyRequired(event, property) }])
      continue
    }
    const wire = wireKeyOf(event, property)
    if (wire.location === "resource") {
      projection[property] = wire.key
      continue
    }
    if (attributes.some(([key]) => key === wire.key)) throw new Error(`${event}: two properties map to ${wire.key}`)
    attributes.push([wire.key, attribute(event, property, schema, isPropertyRequired(event, property))])
  }
  if (event === "turn_completed") {
    attributes.push(...turnGenAiAttributes())
    // OTel-only (the session-role slice): which session a turn ran in; optional, closed vocabulary.
    attributes.push(["omo.session.role", { type: "string", values: [...TELEMETRY_SESSION_ROLES], required: false, posthog_name: "session_role" }])
  }
  return { attributes: sortedObject(attributes), projection: sortedObject(Object.entries(projection)) }
}

/** turn_completed's wire-only GenAI attributes (toGenAiModel); the relay never sends them to PostHog. */
function turnGenAiAttributes(): [string, ArtifactAttribute][] {
  return [
    ["gen_ai.provider.name", { type: "string", values: wireValues("gen_ai.provider.name"), required: true }],
    ["gen_ai.request.model", { type: "string", values: MODEL_VALUES, required: false, posthog_name: "request_model_id" }],
    ["gen_ai.response.model", { type: "string", values: MODEL_VALUES, required: false, posthog_name: "response_model_id" }],
  ]
}

function turnSpanAttributes(): AttributeMap {
  const providers = OMO_NATIVE_EVENT_SCHEMAS.turn_completed.provider.values
  return sortedObject<ArtifactAttribute>([
    ["gen_ai.operation.name", { type: "string", values: ["chat"], required: true }],
    ["gen_ai.provider.name", { type: "string", values: wireValues("gen_ai.provider.name"), required: true }],
    ["gen_ai.request.model", { type: "string", values: MODEL_VALUES, required: false }],
    ["gen_ai.response.model", { type: "string", values: MODEL_VALUES, required: false }],
    ["omo.model_id", { type: "string", values: MODEL_VALUES, required: true }],
    ["omo.provider", { type: "string", values: providers, required: true }],
    ["omo.session.role", { type: "string", values: TELEMETRY_SESSION_ROLES, required: true }],
    ["omo.turn.index", { type: "number", integer: true, min: 0, max: 1e7, required: true }],
    ["session.id", { type: "string", pattern: SESSION_ID_PATTERN, required: true }],
  ])
}

type ProductSpec = {
  readonly product: TelemetryArtifact["product"]
  readonly identity: TelemetryArtifact["identity"]
  readonly relay: boolean
  readonly surfaces: readonly string[]
}

const PRODUCTS: readonly ProductSpec[] = [
  { product: "omo-senpi", identity: "install", relay: true, surfaces: ["cli", "desktop"] },
  // The hosted runtime (todo 43): the engine's events, no install identity, never relayed to PostHog.
  { product: "omo-cloud", identity: "none", relay: false, surfaces: ["cloud"] },
]

/** Approved SDK identifiers (D-I): the stock SDK, or the in-house fallback provider of spike 13 (g). */
export const TELEMETRY_SDK_NAMES = ["opentelemetry", "omo-otel-minimal"] as const

function resourceAttributes(spec: ProductSpec): AttributeMap {
  const posthog = (key: string): { posthog_name?: string } => {
    const name = SEMCONV_MAP.keys.find((entry) => entry.wire_key === key)?.posthog_name
    return name === null || name === undefined ? {} : { posthog_name: name }
  }
  const entries: [string, ArtifactAttribute][] = [
    ["service.name", { type: "string", values: [spec.product], required: true }],
    ["service.version", { type: "string", pattern: VERSION_PATTERN, required: true }],
    ["service.instance.id", { type: "string", pattern: INSTANCE_ID_PATTERN, required: true }],
    ["os.type", { type: "string", values: wireValues("os.type"), required: true }],
    ["os.version", { type: "string", pattern: OS_VERSION_PATTERN, required: false }],
    ["host.arch", { type: "string", values: wireValues("host.arch"), required: true }],
    ["telemetry.sdk.name", { type: "string", values: TELEMETRY_SDK_NAMES, required: true }],
    ["telemetry.sdk.language", { type: "string", values: ["nodejs"], required: true }],
    ["telemetry.sdk.version", { type: "string", pattern: VERSION_PATTERN, required: true }],
    ["omo.schema.version", { type: "number", integer: true, min: 1, max: 1000, required: true }],
    ["omo.surface", { type: "string", values: spec.surfaces, required: true }],
    ["omo.ci", { type: "boolean", required: true }],
  ]
  if (spec.identity === "install") {
    entries.push(["omo.install.hash", { type: "string", pattern: INSTALL_HASH_PATTERN, required: true }])
  }
  return sortedObject(entries.map(([key, value]) => [key, { ...value, ...posthog(key) }] as const))
}

function compareCodePoints(left: string, right: string): number {
  const a = Array.from(left)
  const b = Array.from(right)
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const delta = (a[index]?.codePointAt(0) ?? 0) - (b[index]?.codePointAt(0) ?? 0)
    if (delta !== 0) return delta
  }
  return a.length - b.length
}

/**
 * JSON with object keys sorted by Unicode code point at every depth and no whitespace: the hash input
 * for artifacts and the semconv map, identical to the collector's `canonicalJson`.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => compareCodePoints(left, right))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`
  }
  return JSON.stringify(value)
}

export function artifactSha256(artifact: object): string {
  const { sha256: _excluded, ...body } = artifact as { sha256?: unknown }
  return createHash("sha256").update(canonicalJson(body)).digest("hex")
}

export function buildTelemetryArtifacts(
  schemas: Readonly<Record<string, Readonly<Record<string, OmoNativePropertySchema>>>> = OMO_NATIVE_EVENT_SCHEMAS,
): TelemetryArtifact[] {
  for (const property of Object.keys(OMO_NATIVE_COMMON_PROPERTY_SCHEMAS)) {
    if (!Object.hasOwn(COMMON_PROPERTY_PLACEMENT, property)) {
      throw new Error(`common property ${property} has no wire placement; add it to COMMON_PROPERTY_PLACEMENT`)
    }
  }
  const events: Record<string, AttributeMap> = {}
  const projections: Record<string, Record<string, string>> = {}
  const derived: Record<string, Record<string, { from: string; divide_by: number }>> = {}
  for (const [event, properties] of Object.entries(schemas)) {
    const { attributes, projection } = eventAttributes(event, properties)
    events[`omo.${event}`] = attributes
    if (Object.keys(projection).length > 0) projections[`omo.${event}`] = projection
    for (const [property, rule] of Object.entries(DERIVED_PROPERTIES)) {
      if (rule.events.has(event) && Object.hasOwn(properties, property)) {
        derived[`omo.${event}`] = { [property]: { from: rule.from, divide_by: rule.divide_by } }
      }
    }
  }
  return PRODUCTS.map((spec) => {
    const body = {
      artifact_format: 1 as const,
      product: spec.product,
      schema_version: OMO_NATIVE_SCHEMA_VERSION,
      proto_tag: PROTO_TAG,
      identity: spec.identity,
      relay: spec.relay,
      semconv_map_sha256: SEMCONV_MAP_SHA256,
      resource: resourceAttributes(spec),
      scope: { name: [spec.product], version: VERSION_PATTERN },
      events: sortedObject(Object.entries(events)),
      spans: { "omo.turn": turnSpanAttributes() },
      values: SEMCONV_MAP.values,
      resource_projections: sortedObject(Object.entries(projections)),
      derived_properties: sortedObject(Object.entries(derived)),
    }
    return { ...body, sha256: artifactSha256(body) }
  })
}

/** The file each product's artifact is published as, next to this module. */
export function artifactFileName(product: TelemetryArtifact["product"]): string {
  return product === "omo-senpi" ? "telemetry-schema.json" : `telemetry-schema.${product}.json`
}

export function serializeArtifact(artifact: TelemetryArtifact): string {
  return `${JSON.stringify(artifact, null, 2)}\n`
}

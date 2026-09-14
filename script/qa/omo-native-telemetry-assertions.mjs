import {
  KNOWN_MODELS,
  KNOWN_PROVIDERS,
  OMO_NATIVE_PROPERTY_ALLOWLISTS,
} from "../../packages/omo-senpi/src/components/telemetry/product-identity.ts"

import { prompts } from "./omo-native-telemetry-provider.mjs"

const expectedNativeEvents = new Set([
  "daily_active",
  "session_started",
  "prompt_submitted",
  "turn_completed",
  "skill_loaded",
  "delegation_started",
  "delegation_completed",
  "category_config",
  "feature_used",
  "parallelism_summary",
])

export function assertAllowlistCoverage(allowlists) {
  const actual = new Set(Object.keys(allowlists))
  const missing = [...expectedNativeEvents].filter((name) => !actual.has(name)).sort()
  const extra = [...actual].filter((name) => !expectedNativeEvents.has(name)).sort()
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`OmO Native QA allowlist event coverage diverged: missing=${missing.join(",") || "none"}; extra=${extra.join(",") || "none"}`)
  }
}

assertAllowlistCoverage(OMO_NATIVE_PROPERTY_ALLOWLISTS)
const nativeEvents = new Set(Object.keys(OMO_NATIVE_PROPERTY_ALLOWLISTS))
const sharedKeys = new Set(["$process_person_profile", "package_version", "platform", "product_name", "schema_version", "surface", "install_id"])
const sdkAddedKeys = new Set(["$lib", "$lib_version", "$geoip_disable", "$is_server"])
const sdkWireKeys = new Set(["distinct_id", "uuid"])
const knownModels = new Set(Object.values(KNOWN_MODELS).flat())
const knownProviders = new Set(KNOWN_PROVIDERS)
export function parseCapturedEvents(requests) {
  const events = []
  for (const request of requests) {
    let body
    try { body = JSON.parse(request.raw) } catch { continue }
    collectEvents(body, request.path, events)
  }
  return events
}

function collectEvents(value, path, output) {
  if (Array.isArray(value)) {
    for (const item of value) collectEvents(item, path, output)
    return
  }
  if (!isRecord(value)) return
  if (typeof value.event === "string" && isRecord(value.properties)) {
    output.push({ event: value.event, properties: value.properties, timestamp: value.timestamp, distinct_id: value.distinct_id, path })
  }
  if (Array.isArray(value.batch)) collectEvents(value.batch, path, output)
}

export function assertEnabled(events) {
  const checks = []
  const check = (name, condition, detail) => {
    if (!condition) throw new Error(`${name}: ${detail}`)
    checks.push({ name, result: "PASS", detail })
  }
  const native = events.filter((event) => nativeEvents.has(event.event))
  const realPrompts = native.filter((event) => event.event === "prompt_submitted" && event.properties.is_real_user_prompt === true)
  check("exactly-three-real-prompts", realPrompts.length === 3, `observed ${realPrompts.length}; events=${events.map((event) => event.event).join(",")}`)
  const first = realPrompts.find((event) => event.properties.real_prompt_ordinal_bucket === "1")
  check("first-prompt-ulw-classification", first !== undefined && first.properties.is_effective_ultrawork_invocation === true && first.properties.keyword_variant === "ulw" && first.properties.keyword_occurrence_bucket === "1" && first.properties.invocation_stage === "first_arm", JSON.stringify(first?.properties ?? null))
  const controls = realPrompts.filter((event) => event !== first)
  check("two-keyword-negative-controls", controls.length === 2 && controls.every((event) => event.properties.keyword_any === false), controls.map((event) => JSON.stringify(event.properties)).join(" | "))
  for (const name of nativeEvents) check(`event-present-${name}`, native.some((event) => event.event === name), `captured ${name}`)
  check("turn-completed-positive-tokens", native.some((event) => event.event === "turn_completed" && Number(event.properties.total_tokens) > 0), "at least one turn_completed has total_tokens > 0")
  check("feature-goal-tool", native.some((event) => event.event === "feature_used" && event.properties.feature === "goal_tool"), "captured feature_used goal_tool")
  check("legacy-dual-emit-presence-only", events.some((event) => event.event === "omo_senpi_daily_active"), "legacy event present and excluded from all scans")
  privacyScan(native, checks)
  return checks
}

export function privacyScan(events, checks) {
  const addPass = (name, detail) => checks.push({ name, result: "PASS", detail })
  for (const event of events) {
    const allowed = new Set([...OMO_NATIVE_PROPERTY_ALLOWLISTS[event.event], ...sharedKeys, ...sdkAddedKeys, ...sdkWireKeys])
    if ("$is_server" in event.properties && event.properties.$is_server !== true) throw new Error("invalid SDK server attribution")
    if (event.properties.surface !== "cli" && event.properties.surface !== "desktop") throw new Error("invalid attribution surface")
    if (typeof event.properties.install_id !== "string" || !/^[a-f0-9]{64}$/.test(event.properties.install_id)) throw new Error("invalid attribution install_id")
    for (const key of Object.keys(event.properties)) {
      if (!allowed.has(key)) throw new Error(`property-allowlist: ${event.event}.${key} is not documented or SDK-added`)
      if (key.startsWith("$") && !OMO_NATIVE_PROPERTY_ALLOWLISTS[event.event].includes(key) && !sharedKeys.has(key) && !sdkAddedKeys.has(key)) {
        throw new Error(`dollar-property-allowlist: ${event.event}.${key} is not permitted`)
      }
    }
    for (const [key, value] of walkValues(event.properties)) {
      if (typeof value !== "string") continue
      if (key === "model_id" || key === "default_model") {
        if (value !== "custom" && !knownModels.has(value)) throw new Error(`known-model-allowlist: ${key}=${value}`)
        continue
      }
      if (key === "provider" || key === "default_provider") {
        if (value !== "custom" && !knownProviders.has(value)) throw new Error(`known-provider-allowlist: ${key}=${value}`)
        continue
      }
      if (key === "providers") {
        const providers = value === "" ? [] : value.split(",")
        if (providers.some((provider) => !knownProviders.has(provider))) throw new Error(`known-provider-allowlist: ${key}=${value}`)
        continue
      }
      if (/(^|\s)(\/|~\/|[A-Za-z]:\\)/.test(value)) throw new Error(`path-privacy: ${event.event}.${key}=${value}`)
      for (const prompt of prompts) {
        for (const fragment of promptFragments(prompt)) {
          if (value.toLowerCase().includes(fragment)) throw new Error(`prompt-fragment-privacy: ${event.event}.${key} contains ${JSON.stringify(fragment)}`)
        }
      }
    }
  }
  addPass("native-event-property-allowlists", `all ${events.length} OmO Native events use documented or SDK-added keys`)
  addPass("native-event-path-privacy", "no scanned value contains an absolute/home path pattern; model fields use known-model or custom masking")
  addPass("native-event-prompt-fragment-privacy", "no scanned value contains any 8+ character driven-prompt substring")
  addPass("legacy-event-scan-exclusion", "omo_senpi_daily_active was presence-checked only")
}

function promptFragments(prompt) {
  const normalized = prompt.toLowerCase()
  const fragments = new Set()
  for (let index = 0; index <= normalized.length - 8; index += 1) fragments.add(normalized.slice(index, index + 8))
  return fragments
}

function* walkValues(value, key = "") {
  if (Array.isArray(value)) {
    for (const item of value) yield* walkValues(item, key)
    return
  }
  if (isRecord(value)) {
    for (const [childKey, child] of Object.entries(value)) yield* walkValues(child, childKey)
    return
  }
  yield [key, value]
}

export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

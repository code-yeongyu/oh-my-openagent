import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { describe, expect, test } from "bun:test"

import { OS_VERSION_PATTERN, VERSION_PATTERN } from "./event-schema-constraints"
import { processCrashedProperties } from "./omo-native-crash"
import { buildTelemetryArtifacts, canonicalJson, type ArtifactAttribute, type TelemetryArtifact } from "./telemetry-artifact"
import { createOsProvider } from "./telemetry.test-support"
import { wireViolations } from "./telemetry-wire.test-support"

// Collector registry sisyphuslabs/omo-telemetry packages/schema-registry at 207ea5a905d8c06cf9c3a782427204904c32c801 (main).
const COLLECTOR_SEMCONV_CANONICAL_SHA256 = "2cf8b859a1fbad492a3ee51864f73762ea7263f34423d4965e7a557184d1f053"
const COLLECTOR_ARTIFACT_SCHEMA_SHA256 = "18ebd67bbf785d83f1a339e79c6f5e6a5d7cc5c2e59f7ec9a33f51f4e60158d7"

const REGISTRY = new URL("./schema-registry/", import.meta.url)
type SchemaDefs = {
  readonly safePattern?: { readonly oneOf: readonly { readonly title: string; readonly const: string }[] }
  readonly forbiddenKeys: { readonly enum: readonly string[] }
  readonly fieldName?: { readonly allOf: readonly { readonly not?: { readonly pattern?: string } }[] }
  readonly wireKey?: { readonly allOf: readonly { readonly not?: { readonly pattern?: string } }[] }
}
const DEFS: SchemaDefs = JSON.parse(readFileSync(new URL("artifact.schema.json", REGISTRY), "utf8")).$defs
const ARTIFACTS = buildTelemetryArtifacts()

function* attributesOf(artifact: TelemetryArtifact): Generator<[string, ArtifactAttribute]> {
  for (const [key, spec] of Object.entries(artifact.resource)) yield [key, spec]
  for (const attributes of [...Object.values(artifact.events), ...Object.values(artifact.spans)]) {
    for (const entry of Object.entries(attributes)) yield entry
  }
}

describe("engine artifacts against the collector's hardened registry", () => {
  test("#given the vendored registry #then artifact.schema.json is the collector's file and the semconv pin is its canonical-body sha256", () => {
    expect(createHash("sha256").update(readFileSync(new URL("artifact.schema.json", REGISTRY))).digest("hex")).toBe(COLLECTOR_ARTIFACT_SCHEMA_SHA256)
    expect(readFileSync(new URL("semconv-map.sha256", REGISTRY), "utf8").trim()).toBe(COLLECTOR_SEMCONV_CANONICAL_SHA256)
    const semconv: unknown = JSON.parse(readFileSync(new URL("semconv-map.json", REGISTRY), "utf8"))
    expect(createHash("sha256").update(canonicalJson(semconv)).digest("hex")).toBe(COLLECTOR_SEMCONV_CANONICAL_SHA256)
    for (const artifact of ARTIFACTS) expect(artifact.semconv_map_sha256).toBe(COLLECTOR_SEMCONV_CANONICAL_SHA256)
  })

  test("#then every pattern in both artifacts is one of the registry's named safe shapes, byte exact", () => {
    const shape = (title: string) => DEFS.safePattern?.oneOf.find((entry) => entry.title === title)?.const
    expect(VERSION_PATTERN).toBe(shape("semver") ?? "missing semver shape")
    expect(OS_VERSION_PATTERN).toBe(shape("os_version") ?? "missing os_version shape")
    const safe = new Set((DEFS.safePattern?.oneOf ?? []).map((entry) => entry.const))
    expect(safe.size).toBeGreaterThan(1)
    const outside: string[] = []
    for (const artifact of ARTIFACTS) {
      if (!safe.has(artifact.scope.version)) outside.push(`${artifact.product} scope.version`)
      for (const [key, spec] of attributesOf(artifact)) {
        if (spec.pattern !== undefined && !safe.has(spec.pattern)) outside.push(`${artifact.product} ${key}`)
      }
    }
    expect(outside).toEqual([])
  })

  test("#then no wire key and no PostHog name hits a forbidden key or any field-name rule of the collector", () => {
    const rules = (DEFS.fieldName?.allOf ?? []).flatMap(({ not }) => (not?.pattern === undefined ? [] : [new RegExp(not.pattern, "u")]))
    expect(rules.length).toBeGreaterThan(4)
    const forbidden = (name: string) => DEFS.forbiddenKeys.enum.includes(name) || rules.some((rule) => rule.test(name))
    for (const artifact of ARTIFACTS) {
      for (const [key, spec] of attributesOf(artifact)) {
        expect(`${key} ${forbidden(key)}`).toBe(`${key} false`)
        if (spec.posthog_name !== undefined) expect(`${key} ${spec.posthog_name} ${forbidden(spec.posthog_name)}`).toBe(`${key} ${spec.posthog_name} false`)
      }
    }
  })

  test("#then the renamed attributes travel under their new wire key and PostHog name, and the old names are gone", () => {
    const renamed: readonly [string, string, string][] = [
      ["omo.session_started", "omo.start_trigger", "start_trigger"],
      ["omo.daily_active", "omo.start_trigger", "start_trigger"],
      ["omo.delegation_completed", "omo.start_trigger", "start_trigger"],
      ["omo.prompt_submitted", "omo.suppression_cause", "suppression_cause"],
      ["omo.prompt_submitted", "omo.is_real_user", "is_real_user"],
      ["omo.category_config", "omo.custom_category_count", "custom_category_count"],
    ]
    const retired = new Set(["reason", "start_reason", "suppression_reason", "user_category_count", "is_real_user_prompt"])
    for (const artifact of ARTIFACTS) {
      for (const [event, key, posthog] of renamed) expect(`${event} ${key} ${artifact.events[event]?.[key]?.posthog_name}`).toBe(`${event} ${key} ${posthog}`)
      for (const [event, attributes] of Object.entries(artifact.events)) {
        for (const [key, spec] of Object.entries(attributes)) {
          expect(`${event} ${key} ${retired.has(spec.posthog_name ?? "")}`).toBe(`${event} ${key} false`)
        }
        expect(Object.keys(attributes).filter((key) => /^omo\.(?:reason|start_reason|suppression_reason|user_category_count|prompt\.is_real_user)$/.test(key))).toEqual([])
      }
    }
    expect(wireViolations("session_started", { $session_id: "a".repeat(64), start_trigger: "fork" })).toEqual([])
    expect(wireViolations("daily_active", { $session_id: "a".repeat(64), start_trigger: "session_start", day_utc: "2026-10-15" })).toEqual([])
  })

  test("#then the old free-shape attributes are gone from the artifacts", () => {
    for (const artifact of ARTIFACTS) {
      expect(artifact.events["omo.session_started"]).not.toHaveProperty(["omo.providers"])
      expect(artifact.events["omo.session_started"]).not.toHaveProperty(["omo.timezone"])
      expect(artifact.events["omo.parallelism_summary"]).not.toHaveProperty(["omo.non_eval_wave_size_histogram"])
      expect(Object.keys(artifact.events["omo.category_config"] ?? {}).filter((key) => /^omo\.cat_[a-z_]+$/.test(key) && !/_(?:state|provider|model|reasoning|depth)$/.test(key))).toEqual([])
    }
  })

  test("#given crash records with a version, a path and nothing #when projected #then only the semver-shaped version ships and the record validates", () => {
    const properties = processCrashedProperties(
      {
        record: { at: "2026-10-15T00:00:00.000Z", kind: "print", uptimeMs: 10, code: 1, bunVersion: "1.4.2", productVersion: "/Users/someone/bin" },
        source: "process",
        shardKind: "none",
      } as unknown as Parameters<typeof processCrashedProperties>[0],
      createOsProvider("crash-host"),
    )
    expect(properties.crashed_bun_version).toBe("1.4.2")
    expect(properties).not.toHaveProperty("crashed_omo_version")
    expect(properties).not.toHaveProperty("crashed_engine_version")
    expect(wireViolations("process_crashed", properties)).toEqual([])
  })
})

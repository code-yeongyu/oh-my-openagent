import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { describe, expect, test } from "bun:test"

import { VERSION_PATTERN } from "./event-schema-constraints"
import { processCrashedProperties } from "./omo-native-crash"
import { buildTelemetryArtifacts, canonicalJson, type ArtifactAttribute, type TelemetryArtifact } from "./telemetry-artifact"
import { createOsProvider } from "./telemetry.test-support"
import { wireViolations } from "./telemetry-wire.test-support"

// Collector registry sisyphuslabs/omo-telemetry packages/schema-registry at 5c4503de6c393e970d2b16b47831b3ed1a821db4.
const COLLECTOR_SEMCONV_CANONICAL_SHA256 = "246f23be0254c1ff03cacff2bcf238887f2f95e46e5fe1bed861d76b935044f6"
const COLLECTOR_ARTIFACT_SCHEMA_SHA256 = "38e9dfc60903d817e61134980042286c6c02ad84137b81e5e8420b7ad430a11e"

// The collector's tightened `semver` safe shape (omo-telemetry #4, "version shapes carry no free suffix"). The vendored
// artifact.schema.json above predates it; until it is re-pinned, this is the one engine pattern allowed outside it.
const COLLECTOR_HARDENED_SEMVER =
  "^[0-9]{1,6}\\.[0-9]{1,6}\\.[0-9]{1,6}(-(alpha|beta|rc|dfa)\\.[0-9]{1,6}|-(nightly|preview)\\.[0-9]{8}\\.[0-9]{1,6}|-[0-9]{1,6})?$"

const REGISTRY = new URL("./schema-registry/", import.meta.url)
type SchemaDefs = {
  readonly safePattern?: { readonly oneOf: readonly { readonly title: string; readonly const: string }[] }
  readonly forbiddenKeys: { readonly enum: readonly string[] }
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
    expect(VERSION_PATTERN).toBe(COLLECTOR_HARDENED_SEMVER)
    const safe = new Set([...(DEFS.safePattern?.oneOf ?? []).map((shape) => shape.const), COLLECTOR_HARDENED_SEMVER])
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

  test("#then no wire key hits a forbidden key or a forbidden leaf rule (omo.reason is gone, omo.start_reason carries it)", () => {
    const rules = (DEFS.wireKey?.allOf ?? []).flatMap(({ not }) => (not?.pattern === undefined ? [] : [new RegExp(not.pattern, "u")]))
    expect(rules.length).toBeGreaterThan(0)
    for (const artifact of ARTIFACTS) {
      for (const [key] of attributesOf(artifact)) {
        expect(`${key} ${DEFS.forbiddenKeys.enum.includes(key) || rules.some((rule) => rule.test(key))}`).toBe(`${key} false`)
      }
      for (const event of ["omo.session_started", "omo.daily_active"]) {
        expect(artifact.events[event]).not.toHaveProperty(["omo.reason"])
        expect(artifact.events[event]?.["omo.start_reason"]?.posthog_name).toBe("reason")
      }
    }
    expect(wireViolations("session_started", { $session_id: "a".repeat(64), reason: "fork" })).toEqual([])
    expect(wireViolations("daily_active", { $session_id: "a".repeat(64), reason: "session_start", day_utc: "2026-10-15" })).toEqual([])
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

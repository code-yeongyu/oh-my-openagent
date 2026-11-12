import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

import {
  discoverGeneratedOutputs,
  discoverPluginBuiltRuntimes,
  evaluateBuiltRuntimeProbe,
  evaluateGeneratedOutputProbe,
  KNOWN_BUILT_RUNTIMES,
} from "./no-raw-tls-client-scan"

describe("built omowright runtime probe (CI)", () => {
  test("#given CI and a missing KNOWN_BUILT_RUNTIMES file #when probed #then the failure names the expected path", () => {
    const verdict = evaluateBuiltRuntimeProbe({
      known: KNOWN_BUILT_RUNTIMES,
      present: () => false,
      discovered: [],
      ci: "true",
    })
    expect(
      verdict.failures.some((line) =>
        line.includes("packages/omo-codex/plugin/skills/browser/runtime/omowright/index.js"),
      ),
      JSON.stringify(verdict),
    ).toBe(true)
    expect(verdict.scanned).toEqual([])
  })

  test("#given CI and a staged runtime file missing from KNOWN_BUILT_RUNTIMES #when probed #then the failure names the file", () => {
    const staged = "packages/omo-codex/plugin/skills/browser/runtime/omowright/worker.js"
    const verdict = evaluateBuiltRuntimeProbe({
      known: KNOWN_BUILT_RUNTIMES,
      present: () => true,
      discovered: [...KNOWN_BUILT_RUNTIMES, staged],
      ci: "true",
    })
    expect(
      verdict.failures.some((line) => line.includes(staged) && line.includes("KNOWN_BUILT_RUNTIMES")),
      JSON.stringify(verdict),
    ).toBe(true)
  })

  test("#given no CI #when a runtime is absent or unlisted #then the probe scans what exists without failing", () => {
    const verdict = evaluateBuiltRuntimeProbe({
      known: KNOWN_BUILT_RUNTIMES,
      present: (file) => file === KNOWN_BUILT_RUNTIMES[0],
      discovered: [KNOWN_BUILT_RUNTIMES[0], "packages/omo-codex/plugin/skills/browser/runtime/omowright/worker.js"],
      ci: undefined,
    })
    expect(verdict).toEqual({ scanned: [KNOWN_BUILT_RUNTIMES[0]], failures: [] })
  })

  test("#given the built tree #when runtime directories are discovered #then every staged omowright file is a KNOWN_BUILT_RUNTIMES entry", () => {
    const unlisted = discoverPluginBuiltRuntimes().filter((file) => !KNOWN_BUILT_RUNTIMES.includes(file))
    expect(unlisted, "built omowright runtimes missing from KNOWN_BUILT_RUNTIMES").toEqual([])
  })
})

// The shipped bundles are untracked build outputs (#13192); the scan reads them from the built tree, so in CI a listed
// output that is absent means the job did not build and the guard would silently stop looking at what ships.
describe("built generated outputs probe (CI)", () => {
  const patterns: string[] = JSON.parse(
    readFileSync(new URL("./generated-bundles.json", import.meta.url), "utf8"),
  ).patterns
  const built = [
    "packages/omo-senpi/plugin/extensions/omo.js",
    "packages/omo-senpi/plugin/runtime/agent-toolkit-sdk/sdk.js",
    "packages/omo-senpi/plugin/runtime/rollback-migrate.js",
    "packages/omo-codex/scripts/install-dist/install-local.mjs",
    "packages/omo-native/bin/lib/service-auth.generated.js",
    "packages/omo-senpi/plugin/scripts/install.mjs",
    "packages/omo-native/bin/lib/reflection-lock.generated.js",
    "packages/omo-native/bin/lib/brand-logo.generated.js",
  ]

  test("#given CI and every listed output built #when probed #then it passes", () => {
    expect(evaluateGeneratedOutputProbe({ patterns, discovered: built, ci: "true" })).toEqual([])
  })

  test.each(built)("#given CI and %s absent #when probed #then it fails naming its pattern", (absent) => {
    const failures = evaluateGeneratedOutputProbe({
      patterns,
      discovered: built.filter((file) => file !== absent),
      ci: "true",
    })
    expect(failures.length, JSON.stringify(failures)).toBe(1)
  })

  test("#given no CI and nothing built #when probed #then it does not fail", () => {
    expect(evaluateGeneratedOutputProbe({ patterns, discovered: [], ci: undefined })).toEqual([])
  })

  test("#given the built tree #when discovered #then every discovered output is a listed path", () => {
    for (const file of discoverGeneratedOutputs())
      expect(
        patterns.some((pattern) => new RegExp(pattern).test(file)),
        file,
      ).toBe(true)
  })
})

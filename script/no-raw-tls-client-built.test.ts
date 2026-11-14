import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

import {
  discoverGeneratedOutputs,
  discoverPluginBuiltRuntimes,
  evaluateBuiltRuntimeProbe,
  evaluateGeneratedOutputProbe,
  generatedOutputScanRequirements,
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

// The shipped bundles are untracked build outputs (#13192); the scan reads them from the built tree, so in CI an
// output the plugin needs that is absent means the job did not build it, and the guard would silently stop looking at
// what ships. The requirement is per output: a list pattern is never met by any one built file.
describe("built generated outputs probe (CI)", () => {
  const requirements = generatedOutputScanRequirements()
  const built = requirements.map((requirement) => requirement.label)

  test("#given the requirements #when derived #then each names one output", () => {
    expect(built.filter((label) => label.startsWith("a path matching"))).toEqual([])
    expect(built).toContain("packages/omo-senpi/plugin/runtime/bunshin-ts/sdk.js")
    expect(built).toContain("packages/omo-senpi/plugin/extensions/omo-task.js")
  })

  test("#given CI and every required output built #when probed #then it passes", () => {
    expect(evaluateGeneratedOutputProbe({ requirements, discovered: built, ci: "true" })).toEqual([])
  })

  test.each([
    "packages/omo-senpi/plugin/runtime/bunshin-ts/sdk.js",
    "packages/omo-senpi/plugin/extensions/omo-task.js",
    "packages/omo-senpi/plugin/extensions/omo-side-panel.js",
  ])(
    "#given CI and %s absent while its pattern's other outputs are built #when probed #then it fails naming it",
    (absent) => {
      const failures = evaluateGeneratedOutputProbe({
        requirements,
        discovered: built.filter((file) => file !== absent),
        ci: "true",
      })
      expect(failures.length, JSON.stringify(failures)).toBe(1)
      expect(failures[0]).toContain(absent)
    },
  )

  test.each(built)("#given CI and %s absent #when probed #then it fails", (absent) => {
    expect(
      evaluateGeneratedOutputProbe({ requirements, discovered: built.filter((file) => file !== absent), ci: "true" }),
    ).toHaveLength(1)
  })

  test("#given no CI and nothing built #when probed #then it does not fail", () => {
    expect(evaluateGeneratedOutputProbe({ requirements, discovered: [], ci: undefined })).toEqual([])
  })

  test("#given the built tree #when discovered #then every discovered output is a listed path", () => {
    const patterns: string[] = JSON.parse(
      readFileSync(new URL("./generated-bundles.json", import.meta.url), "utf8"),
    ).patterns
    for (const file of discoverGeneratedOutputs())
      expect(
        patterns.some((pattern) => new RegExp(pattern).test(file)),
        file,
      ).toBe(true)
  })
})

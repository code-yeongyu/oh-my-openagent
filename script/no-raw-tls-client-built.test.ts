import { describe, expect, test } from "bun:test"
import { discoverPluginBuiltRuntimes, evaluateBuiltRuntimeProbe, KNOWN_BUILT_RUNTIMES } from "./no-raw-tls-client-scan"

describe("built omowright runtime probe (CI)", () => {
  test("#given CI and a missing KNOWN_BUILT_RUNTIMES file #when probed #then the failure names the expected path", () => {
    const verdict = evaluateBuiltRuntimeProbe({
      known: KNOWN_BUILT_RUNTIMES,
      present: () => false,
      discovered: [],
      ci: "true",
    })
    expect(
      verdict.failures.some((line) => line.includes("packages/omo-codex/plugin/skills/browser/runtime/omowright/index.js")),
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

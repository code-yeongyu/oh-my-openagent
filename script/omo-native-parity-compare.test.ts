import { describe, expect, test } from "bun:test"
import { binaryOnlyFailures, compareRuns, normalizeText, PARITY_STEPS } from "./qa/omo-native-parity-compare.mjs"

function run(overrides: Partial<Parameters<typeof compareRuns>[0]> = {}) {
  const results = Object.fromEntries(PARITY_STEPS.map((step) => [step.id, { isError: false, text: `${step.id} ok` }]))
  return {
    tools: ["eval", "read", "webfetch"],
    results,
    doctor: ["PASS extension: plugin/extensions/omo.js", "INFO Update: omo update", "WARN task categories: 0 of 10 usable"],
    setup: ["No OpenCode setup found", "  categories    0 of 10 usable with these providers"],
    extensionFailures: [],
    exitCodes: { session: 0, doctor: 0, setup: 0 },
    ...overrides,
  }
}

describe("binary/npm parity comparison", () => {
  test("#given identical runs #when compared #then there is no difference", () => {
    expect(compareRuns(run(), run())).toEqual([])
  })

  test("#given the binary lacks a tool and fails a step #when compared #then both differences are reported", () => {
    const binary = run({ tools: ["read", "webfetch"] })
    binary.results["eval-js"] = { isError: true, text: "Tool eval not found" }
    const differences = compareRuns(binary, run())
    expect(differences.some((line) => line.startsWith('tools: npm registers "eval"'))).toBe(true)
    expect(differences.some((line) => line.startsWith("eval-js: binary error"))).toBe(true)
  })

  test("#given the binary doctor misses a section #when compared #then the missing section is reported", () => {
    const binary = run({ doctor: ["PASS extension: plugin/extensions/omo.js", "INFO Update: omo update"] })
    expect(compareRuns(binary, run())).toEqual(['doctor: npm prints "WARN task categories", the binary does not'])
  })

  test("#given distribution-specific doctor lines #when compared #then they are not differences", () => {
    const npm = run({ doctor: [...run().doctor, "PASS senpi version 2026.9.29-5", "INFO computer use engine: not installed yet"] })
    const binary = run({ doctor: [...run().doctor, "INFO omo 5.1.4 (engine: senpi 2026.9.29-5)", "PASS computer use engine: native/senpi-desktop-engine", "INFO Claude Code 2.1.284: not downloaded yet"] })
    expect(compareRuns(binary, npm)).toEqual([])
  })

  test("#given an extension load failure on one side #when compared #then it is reported", () => {
    const binary = run({ extensionFailures: ["Warning: Failed to load extension codemode"] })
    expect(compareRuns(binary, run())).toEqual(["binary: Warning: Failed to load extension codemode"])
  })

  test("#given a binary-only run whose pty step fails and session exits non-zero #when checked #then both are failures", () => {
    const broken = run({ exitCodes: { session: 1, doctor: 0, setup: 0 } })
    broken.results["pty-bash"] = { isError: true, text: "@earendil-works/pi-pty package.json is missing a string version" }
    expect(binaryOnlyFailures("first run", run())).toEqual([])
    expect(binaryOnlyFailures("first run", broken)).toEqual([
      "first run: session exited 1",
      'first run: pty-bash failed "@earendil-works/pi-pty package.json is missing a string version"',
    ])
  })

  test("#given sandbox paths and timings #when normalized #then they collapse to stable tokens", () => {
    expect(normalizeText("/tmp/x/home/a.txt elapsedMs=41 searched=9 in 12ms", ["/tmp/x"])).toBe("<root>/home/a.txt elapsedMs=<n> searched=<n> in <n>ms")
  })
})

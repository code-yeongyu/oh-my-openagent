import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import * as comparison from "./dependency-audit/comparison"
import "./dependency-audit/compare-cli.cases"
import {
  classifyFailure, graphArguments, parseCaptureArgs, parseModuleCount,
  parseTimings, timingGate, byteGate, normalizeReceipt,
} from "./dependency-audit/contracts"

describe("dependency audit parsers", () => {
  test.each(["Bundled 4476 modules in 300ms", "[100ms] bundle 3995 modules"])("reads module counts when Bun emits %s", (output) => {
    // given
    const expected = output.includes("4476") ? 4476 : 3995
    // when
    const count = parseModuleCount(output)
    // then
    expect(count).toBe(expected)
  })
  test.each(["build succeeded", "Bundled 7 modules in 1ms", "Bundled NaN modules"])("rejects misleading graph success when output is %s", (output) => {
    // given / when / then
    expect(() => parseModuleCount(output)).toThrow()
  })
  test("strips compile-only arguments when constructing the graph command", () => {
    // given
    const release = ["build", "--compile", "--target=bun-darwin-arm64", "--asset=/stage", "--compile-autoload-package-json", "--no-compile-autoload-dotenv", "--minify-whitespace", "entry.ts", "worker.ts", "--outfile", "/binary"]
    // when
    const result = graphArguments(release, "/graph")
    // then
    expect(result).toEqual(["build", "--target=bun", "--minify-whitespace", "entry.ts", "worker.ts", "--outdir", "/graph", `--metafile=${join("/graph", "meta.json")}`])
  })
  test("rejects malformed CLI input when a case can escape the output directory", () => {
    // given
    const args = ["--phase", "baseline", "--binary", "/tmp/audit/native-artifact", "--out", "/tmp/audit", "--case", "../summary"]
    // when / then
    expect(() => parseCaptureArgs(args)).toThrow()
  })
  test("normalizes only ephemeral addresses when recording evidence", () => {
    // given
    const input = "http://127.0.0.1:48123/fixtures/base/final /tmp/audit/run/a.ts"
    // when
    const normalized = normalizeReceipt(input, [["/tmp/audit/run", "$SANDBOX"]])
    // then
    expect(normalized).toBe("http://127.0.0.1:PORT/fixtures/base/final $SANDBOX/a.ts")
  })
  test.each([
    ["Cannot find module './bedrock.js'", "module-resolution"],
    ["ERR_MODULE_NOT_FOUND", "module-resolution"],
    ["ModuleNotFound: cursor", "module-resolution"],
    ["403 UnrecognizedClientException: security token invalid", "auth"],
    ["401 Unauthorized", "auth"],
    ["HTTP/2 connection error: protocol error", "network"],
    ["ECONNREFUSED", "network"],
    ["unexpected response", "other"],
  ] as const)("classifies %s when a provider terminates", (message, expected) => {
    // given / when
    const result = classifyFailure(message)
    // then
    expect(result).toBe(expected)
  })
})

test("rejects forged photon success when independent dimensions are wrong", () => {
  // given
  const receipt = { pass: true, exitCode: 0, width: 1, height: 1, wasResized: true, outputBytes: 100 }
  // when
  const result = comparison.behaviorPass("photon", receipt)
  // then
  expect(result).toBe(false)
})

describe("dependency audit numeric gates", () => {
  test.each([
    [104857600, "p0", true], [104857601, "p0", false],
    [94371840, "p1", true], [94371841, "p1", false],
    [130850802, "p0", false],
  ] as const)("gates %d bytes at %s when comparing a native artifact", (size, gate, expected) => {
    // given / when
    const result = byteGate({ size, target: "darwin-arm64" }, { size: 130850802, target: "darwin-arm64" }, gate)
    // then
    expect(result.pass).toBe(expected)
  })
  test("enforces both relative and absolute bounds when another target has a baseline", () => {
    // given / when
    const result = byteGate({ size: 150000000, target: "linux-x64" }, { size: 180000000, target: "linux-x64" }, "p0")
    // then
    expect(result.pass).toBe(false)
  })
  test("uses the ceiling alone when a target has no baseline", () => {
    // given / when
    const result = byteGate({ size: 157286400, target: "windows-arm64" }, undefined, "p1")
    // then
    expect(result.pass).toBe(true)
  })
  test.each([["version", 1.10, true], ["version", 1.1001, false], ["oneshot", 1.15, true], ["oneshot", 1.1501, false]] as const)("gates %s at %f when variance is zero", (kind, mean, expected) => {
    // given
    const baseline = { mean: 1, stddev: 0, times: Array.from({ length: 30 }, () => 1), exit_codes: Array.from({ length: 30 }, (): 0 => 0) }
    // when
    const result = timingGate(baseline, { ...baseline, mean }, kind)
    // then
    expect(result.pass).toBe(expected)
  })
  test("adds three combined standard errors when measurements have variance", () => {
    // given
    const baseline = { mean: 1, stddev: 0.1, times: Array.from({ length: 30 }, () => 1), exit_codes: Array.from({ length: 30 }, (): 0 => 0) }
    const post = { ...baseline, mean: 1.17, stddev: 0.2 }
    // when
    const result = timingGate(baseline, post, "version")
    // then
    expect(result.limit).toBeCloseTo(1.1 + 3 * Math.sqrt(0.1 ** 2 / 30 + 0.2 ** 2 / 30), 10)
    expect(result.pass).toBe(true)
  })
  test("rejects timing receipts when a measured command failed", () => {
    // given
    const raw = { mean: 0.1, stddev: 0, times: Array.from({ length: 30 }, () => 0.1), exit_codes: [...Array.from({ length: 29 }, () => 0), 1] }
    // when / then
    expect(() => parseTimings(raw)).toThrow()
  })
  test("rejects stale short timing receipts when fewer than 30 runs were recorded", () => {
    // given
    const raw = { mean: 0.1, stddev: 0, times: [0.1], exit_codes: [0] }
    // when / then
    expect(() => parseTimings(raw)).toThrow()
  })
})

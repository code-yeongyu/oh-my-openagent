/// <reference types="bun-types" />

// Platform contract (#10856): every path a macOS/Windows-only CI step names is a
// platform path for the pull-request classifier. The structural check below parses
// ci.yml independently of the classifier's line scanner, so a new macOS/Windows
// invocation the classifier does not cover fails here.

import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { load } from "js-yaml"
import { isPlatformSensitivePath } from "./ci-fast-path.mjs"
import { platformInvocationCoverage, readCiInvocationCoverage } from "./ci-platform-invocations.mjs"

const repoRoot = fileURLToPath(new URL("..", import.meta.url))
const ciWorkflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8")
const platformOnlyCondition = /runner\.os == '(?:Windows|macOS)'|matrix\.suite == 'platform'/
const namedPath = /(?:packages|script|\.github|bin|crates)\/[\w.@/-]*[\w-]|bunfig[\w.-]*\.toml/g

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function jobOses(job: Record<string, unknown>): string[] {
  const strategy = job["strategy"]
  const matrix = isRecord(strategy) ? strategy["matrix"] : undefined
  if (!isRecord(matrix)) return []
  const listed = Array.isArray(matrix["os"]) ? matrix["os"] : []
  const included = Array.isArray(matrix["include"]) ? matrix["include"].map((entry) => (isRecord(entry) ? entry["os"] : undefined)) : []
  return [...listed, ...included].filter((os): os is string => typeof os === "string")
}

function pathsNamedByPlatformOnlySteps(): string[] {
  const workflow: unknown = load(ciWorkflow)
  if (!isRecord(workflow) || !isRecord(workflow["jobs"])) throw new Error("ci.yml must define jobs")
  const named = Object.values(workflow["jobs"]).filter(isRecord).flatMap((job) => {
    const oses = jobOses(job)
    const jobIsPlatformOnly = oses.length > 0 && oses.every((os) => /macos|windows/.test(os))
    const steps = Array.isArray(job["steps"]) ? job["steps"].filter(isRecord) : []
    return steps
      .filter((step) => jobIsPlatformOnly || platformOnlyCondition.test(String(step["if"] ?? "")))
      .flatMap((step) => JSON.stringify([step["run"], step["with"], step["env"]]).match(namedPath) ?? [])
  })
  return [...new Set(named)].filter((path) => existsSync(`${repoRoot}${path}`))
}

describe("#given the macOS/Windows-only steps in ci.yml", () => {
  const coverage = readCiInvocationCoverage()
  const named = pathsNamedByPlatformOnlySteps()

  test("#then the structural parse finds the dedicated Windows and macOS invocations", () => {
    expect(named).toContain("packages/senpi-task/src/runners/rpc-host")
    expect(named).toContain("packages/omo-codex/plugin/test/node-install-surface.test.mjs")
  })

  test("#then every named file, and every dedicated directory below package level, forces the full matrix", () => {
    const uncovered = named.flatMap((path) => {
      const isDirectory = statSync(`${repoRoot}${path}`).isDirectory()
      if (isDirectory && /^packages\/[^/]+(?:\/[^/]+)?$/.test(path)) return []
      const probe = isDirectory ? `${path}/probe.ts` : path
      return isPlatformSensitivePath(probe, coverage) ? [] : [path]
    })
    expect(uncovered).toEqual([])
  })

  test("#then the source a dedicated test exercises is covered with it", () => {
    expect(isPlatformSensitivePath("packages/senpi-task/src/store/record-lock.ts", coverage)).toBe(true)
    expect(isPlatformSensitivePath("packages/senpi-task/src/runners/rpc-process.ts", coverage)).toBe(true)
  })

  test("#then a whole package passed to bun test as a suite partition stays ubuntu-only", () => {
    expect(named).toContain("packages/memory-core")
    expect(isPlatformSensitivePath("packages/memory-core/src/store.ts", coverage)).toBe(false)
  })
})

describe("#given a workflow that adds a new macOS/Windows invocation", () => {
  const workflow = [
    "jobs:",
    "  test:",
    "    strategy:",
    "      matrix:",
    "        include:",
    "          - os: ubuntu-latest",
    "          - os: windows-latest",
    "    steps:",
    "      - name: Windows-only helper",
    "        if: runner.os == 'Windows'",
    "        run: bun test ./packages/new-core/src/pipes/named-pipe.test.ts packages/new-core/src/spawn",
    "      - name: Every OS",
    "        run: bun test packages/shared-only/src/thing.test.ts",
    "  parity:",
    "    strategy:",
    "      matrix:",
    "        os: [macos-15, windows-latest]",
    "    steps:",
    "      - name: Parity",
    "        run: bun script/qa/new-parity.mjs",
  ].join("\n")
  const coverage = platformInvocationCoverage(workflow)

  test("#then its named paths become platform paths without editing the classifier", () => {
    expect(isPlatformSensitivePath("packages/new-core/src/pipes/named-pipe.ts", coverage)).toBe(true)
    expect(isPlatformSensitivePath("packages/new-core/src/spawn/child.ts", coverage)).toBe(true)
    expect(isPlatformSensitivePath("script/qa/new-parity.mjs", coverage)).toBe(true)
  })

  test("#then a step that also runs on ubuntu adds nothing", () => {
    expect(isPlatformSensitivePath("packages/shared-only/src/thing.ts", coverage)).toBe(false)
  })
})

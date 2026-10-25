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
    const literalRunner = typeof job["runs-on"] === "string" && /^(?:macos|windows)/.test(job["runs-on"])
    const jobIsPlatformOnly = literalRunner || (oses.length > 0 && oses.every((os) => /macos|windows/.test(os)))
    const steps = Array.isArray(job["steps"]) ? job["steps"].filter(isRecord) : []
    return steps
      .filter((step) => jobIsPlatformOnly || platformOnlyCondition.test(String(step["if"] ?? "")))
      .flatMap((step) => JSON.stringify([step["run"], step["with"], step["env"]]).match(namedPath) ?? [])
  })
  const fromScripts = named
    .filter((path) => /^\.github\/scripts\/[\w.-]+\.sh$/.test(path))
    .flatMap((script) => readFileSync(`${repoRoot}${script}`, "utf8").match(namedPath) ?? [])
  return [...new Set([...named, ...fromScripts])].filter((path) => existsSync(`${repoRoot}${path}`))
}

describe("#given the macOS/Windows-only steps in ci.yml", () => {
  const coverage = readCiInvocationCoverage()
  const named = pathsNamedByPlatformOnlySteps()

  test("#then the structural parse finds the dedicated Windows and macOS invocations", () => {
    expect(named).toContain("packages/senpi-task/src/runners/rpc-host")
    expect(named).toContain("packages/omo-codex/plugin/test/node-install-surface.test.mjs")
    expect(isPlatformSensitivePath("packages/omo-codex/plugin/test/node-install-surface.test.mjs", coverage)).toBe(true)
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
    "  windows-only:",
    "    runs-on: windows-latest",
    "    steps:",
    "      - name: Pipes",
    "        run: bash .github/scripts/win-pipes.sh",
    "  shared-script:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: bash .github/scripts/ubuntu-only.sh",
  ].join("\n")
  const scripts: Record<string, string> = {
    ".github/scripts/win-pipes.sh": "bun test packages/new-core/src/pipes/pipe-server.test.ts\n",
  }
  const coverage = platformInvocationCoverage(workflow, (path) => scripts[path] ?? "")

  test("#then its named paths become platform paths without editing the classifier", () => {
    expect(isPlatformSensitivePath("packages/new-core/src/pipes/named-pipe.ts", coverage)).toBe(true)
    expect(isPlatformSensitivePath("packages/new-core/src/spawn/child.ts", coverage)).toBe(true)
    expect(isPlatformSensitivePath("script/qa/new-parity.mjs", coverage)).toBe(true)
  })

  test("#then a named test covers its own source and the sibling helpers that share its stem", () => {
    expect(isPlatformSensitivePath("packages/new-core/src/pipes/named-pipe.windows.ts", coverage)).toBe(true)
    expect(isPlatformSensitivePath("packages/new-core/src/pipes/named-pipe-pool.ts", coverage)).toBe(true)
    expect(isPlatformSensitivePath("packages/new-core/src/pipes/other.ts", coverage)).toBe(false)
    expect(isPlatformSensitivePath("packages/new-core/src/pipes/named-pipe_util.ts", coverage)).toBe(true)
    expect(isPlatformSensitivePath("packages/new-core/src/pipes/named-pipeline.ts", coverage)).toBe(false)
  })

  test("#then a path prefixed by a shell variable is still read", () => {
    const prefixed = platformInvocationCoverage(workflow, (path) =>
      path === ".github/scripts/win-pipes.sh"
        ? 'bun "$PWD/packages/new-core/src/spawn/pty.test.ts" "${GITHUB_WORKSPACE}/script/qa/win-probe.mjs" "${{ github.workspace }}/script/qa/win-expr.mjs"\n'
        : "",
    )
    expect(isPlatformSensitivePath("packages/new-core/src/spawn/pty.ts", prefixed)).toBe(true)
    expect(isPlatformSensitivePath("script/qa/win-probe.mjs", prefixed)).toBe(true)
    expect(isPlatformSensitivePath("script/qa/win-expr.mjs", prefixed)).toBe(true)
  })

  test("#then a script's shebang interpreter path is not mistaken for a repository path", () => {
    const shebang = platformInvocationCoverage(workflow, (path) => (path === ".github/scripts/win-pipes.sh" ? "#!/usr/bin/env bash\n" : ""))
    expect(shebang.some((entry) => entry.value.startsWith("bin/env"))).toBe(false)
  })

  test("#then a job with a literal macOS/Windows runner and the CI script it runs are both read", () => {
    expect(isPlatformSensitivePath(".github/scripts/win-pipes.sh", coverage)).toBe(true)
    expect(isPlatformSensitivePath("packages/new-core/src/pipes/pipe-server.ts", coverage)).toBe(true)
  })

  test("#then a step that also runs on ubuntu adds nothing", () => {
    expect(isPlatformSensitivePath("packages/shared-only/src/thing.ts", coverage)).toBe(false)
  })
})

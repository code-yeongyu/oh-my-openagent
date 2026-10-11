/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const guardPath = fileURLToPath(new URL("./ci-leg-tests-guard.mjs", import.meta.url))

interface LegInput {
  readonly outcomes: readonly string[]
  readonly os: string
  readonly runHeavy: string
  readonly fullMatrix: string
  readonly runtimeTouching: string
  readonly jobStatus?: string
}

interface LegResult {
  readonly status: number | null
  readonly stdout: string
  readonly summary: string
}

const scratchRoots: string[] = []

afterEach(() => {
  for (const root of scratchRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function runLeg(input: LegInput): LegResult {
  const root = mkdtempSync(join(tmpdir(), "ci-leg-guard-"))
  scratchRoots.push(root)
  const summaryFile = join(root, "summary.md")
  const result = spawnSync(
    "node",
    [
      guardPath,
      "--os",
      input.os,
      "--job-status",
      input.jobStatus ?? "success",
      "--outcomes",
      input.outcomes.join(" "),
      "--run-heavy",
      input.runHeavy,
      "--full-matrix",
      input.fullMatrix,
      "--runtime-touching",
      input.runtimeTouching,
    ],
    { encoding: "utf8", env: { ...process.env, GITHUB_STEP_SUMMARY: summaryFile } },
  )
  return { status: result.status, stdout: result.stdout, summary: readFileSync(summaryFile, "utf8") }
}

describe("a leg that ran its tests", () => {
  test("#given a Windows leg whose test step passed #then the guard passes quietly", () => {
    const result = runLeg({
      outcomes: ["success", "skipped", "skipped"],
      os: "windows-latest",
      runHeavy: "true",
      fullMatrix: "true",
      runtimeTouching: "true",
    })

    expect(result.status).toBe(0)
    expect(result.stdout).not.toContain("::error")
    expect(result.summary).toContain("Tests ran on windows-latest.")
  })

  test("#given a leg whose test step failed #then the guard leaves the failure to that step", () => {
    const result = runLeg({
      outcomes: ["skipped", "failure"],
      os: "macos-latest",
      runHeavy: "true",
      fullMatrix: "true",
      runtimeTouching: "true",
      jobStatus: "failure",
    })

    expect(result.status).toBe(0)
    expect(result.stdout).not.toContain("::error")
  })
})

describe("a leg that skipped tests the change needed", () => {
  test("#given a runtime change whose Windows tests were all skipped #then the check fails and names the label", () => {
    const result = runLeg({
      outcomes: ["skipped", "skipped", "skipped", "skipped", "skipped"],
      os: "windows-latest",
      runHeavy: "true",
      fullMatrix: "false",
      runtimeTouching: "true",
    })

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("::error title=tests not run::tests not run: add ci:full-matrix")
    expect(result.summary).toContain("tests not run: add ci:full-matrix")
  })

  test("#given the full matrix was requested but the leg skipped its tests #then the check fails", () => {
    const result = runLeg({
      outcomes: ["skipped", "skipped"],
      os: "macos-latest",
      runHeavy: "true",
      fullMatrix: "true",
      runtimeTouching: "false",
    })

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("tests not run")
  })

  test("#given the ubuntu leg of a heavy run skipped its tests #then the check fails", () => {
    const result = runLeg({
      outcomes: ["skipped"],
      os: "ubuntu-latest",
      runHeavy: "true",
      fullMatrix: "false",
      runtimeTouching: "false",
    })

    expect(result.status).toBe(1)
  })

  test("#given ci-mode produced no classification #then a skipped leg fails instead of passing", () => {
    const result = runLeg({
      outcomes: ["skipped"],
      os: "windows-latest",
      runHeavy: "",
      fullMatrix: "",
      runtimeTouching: "",
    })

    expect(result.status).toBe(1)
  })

  test("#given an earlier setup step failed before the tests #then the check fails with that reason", () => {
    const result = runLeg({
      outcomes: ["skipped", "skipped"],
      os: "windows-latest",
      runHeavy: "true",
      fullMatrix: "true",
      runtimeTouching: "true",
      jobStatus: "failure",
    })

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("an earlier step failed")
  })
})

describe("a leg that skipped tests on purpose", () => {
  test("#given a docs-only change on a Windows leg #then the leg passes and says tests were intentionally not run", () => {
    const result = runLeg({
      outcomes: ["skipped", "skipped", "skipped"],
      os: "windows-latest",
      runHeavy: "true",
      fullMatrix: "false",
      runtimeTouching: "false",
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("::notice title=tests intentionally not run::")
    expect(result.summary).toContain("tests intentionally not run on windows-latest")
  })

  test("#given a web-only change #then even the ubuntu leg reports why it ran nothing", () => {
    const result = runLeg({
      outcomes: ["skipped"],
      os: "ubuntu-latest",
      runHeavy: "false",
      fullMatrix: "false",
      runtimeTouching: "false",
    })

    expect(result.status).toBe(0)
    expect(result.summary).toContain("web or docs only")
  })

  test("#given a generated release merge whose version bumps touch runtime paths #then the skipped legs pass instead of reddening the release", () => {
    const result = runLeg({
      outcomes: ["skipped", "skipped"],
      os: "windows-latest",
      runHeavy: "false",
      fullMatrix: "true",
      runtimeTouching: "true",
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("::notice title=tests intentionally not run::")
    expect(result.stdout).not.toContain("ci:full-matrix")
  })
})

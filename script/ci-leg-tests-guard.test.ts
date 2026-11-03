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
      jobStatus: "failure",
    })

    expect(result.status).toBe(0)
    expect(result.stdout).not.toContain("::error")
  })
})

describe("a leg that skipped tests the change needed", () => {
  test("#given the full matrix was requested but the leg skipped its tests #then the check fails with an error annotation and summary", () => {
    const result = runLeg({
      outcomes: ["skipped", "skipped", "skipped", "skipped", "skipped"],
      os: "macos-latest",
      runHeavy: "true",
      fullMatrix: "true",
    })

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("::error title=tests not run::")
    expect(result.summary).toBe(`## Test execution on this leg\n\n${result.stdout.trim().split("::")[2]}\n\n`)
  })

  test("#given the ubuntu leg of a heavy run skipped its tests #then the check fails", () => {
    const result = runLeg({
      outcomes: ["skipped"],
      os: "ubuntu-latest",
      runHeavy: "true",
      fullMatrix: "false",
    })

    expect(result.status).toBe(1)
  })

  test("#given ci-mode produced no classification #then a skipped leg fails instead of passing", () => {
    const result = runLeg({
      outcomes: ["skipped"],
      os: "windows-latest",
      runHeavy: "",
      fullMatrix: "",
    })

    expect(result.status).toBe(1)
  })

  test("#given an earlier setup step failed before the tests #then the check fails with that reason", () => {
    const result = runLeg({
      outcomes: ["skipped", "skipped"],
      os: "windows-latest",
      runHeavy: "true",
      fullMatrix: "true",
      jobStatus: "failure",
    })

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("an earlier step failed")
  })
})

describe("a leg that skipped tests on purpose", () => {
  // Pull requests run macOS and Windows only when a platform-specific path changed (or a
  // full-matrix label is set); every other change, runtime code included, is proven there by
  // the post-merge dev push, which always runs the full matrix.
  test("#given a pull request outside the full matrix on a Windows leg #then the leg passes and says tests were intentionally not run", () => {
    const result = runLeg({
      outcomes: ["skipped", "skipped", "skipped"],
      os: "windows-latest",
      runHeavy: "true",
      fullMatrix: "false",
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
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("::notice title=tests intentionally not run::")
    expect(result.stdout).not.toContain("ci:full-matrix")
  })
})

describe("macOS status jobs forwarding combined-job outcomes", () => {
  test.each([
    ["all passed", "success", "success success", "true", "true", "true", 0],
    ["another part failed", "failure", "success success", "true", "true", "true", 0],
    ["this part failed", "failure", "success failure", "true", "true", "true", 1],
    ["this part cancelled", "cancelled", "cancelled", "true", "true", "true", 1],
    ["install failed", "failure", "skipped skipped", "true", "true", "true", 1],
    ["only LSP ran", "failure", "success skipped", "true", "true", "true", 1],
    ["full matrix disabled", "skipped", "", "true", "false", "false", 0],
    ["heavy work disabled", "skipped", "", "false", "true", "true", 0],
    ["unexpected skip", "skipped", "", "true", "true", "true", 1],
    ["classification missing", "skipped", "", "", "", "", 1],
  ])("#given %s #when the real status script runs #then it propagates the verdict", (
    _name, jobStatus, outcomes, runHeavy, fullMatrix, runtimeTouching, exitCode,
  ) => {
    const root = mkdtempSync(join(tmpdir(), "ci-macos-status-"))
    scratchRoots.push(root)
    const result = spawnSync("bash", [fileURLToPath(new URL("../.github/scripts/ci-macos-status.sh", import.meta.url))], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_STEP_SUMMARY: join(root, "summary.md"),
        LEG_OS: "macos-latest",
        LEG_JOB_STATUS: jobStatus,
        TEST_OUTCOMES: outcomes,
        RUN_HEAVY: runHeavy,
        FULL_MATRIX: fullMatrix,
        RUNTIME_TOUCHING: runtimeTouching,
      },
    })
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: exitCode, stderr: "" })
    if (jobStatus === "skipped" && exitCode === 0) {
      expect(result.stdout).toContain("::notice title=tests intentionally not run::")
    }
  })
})

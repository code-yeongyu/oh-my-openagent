/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"

// Runs jq on the shared filter; Windows CI has no jq on the bash PATH this suite relies on.
const posixBashTest = test.skipIf(process.platform === "win32" || spawnSync("jq", ["--version"]).status !== 0)

// The job classification both the tracker and the release-state probe read. The macOS required contexts are Linux status
// jobs whose only always-on steps are checkout, setup-node and the summary; macos-combined-1 and -2 run the macOS tests.
describe("#given platform-jobs.jq", () => {
  const filter = new URL("../.github/scripts/platform-jobs.jq", import.meta.url).pathname
  const step = (name: string, conclusion = "success") => ({ name, conclusion })
  const statusJob = (name: string) => ({
    name,
    conclusion: "success",
    html_url: "u",
    labels: ["ubuntu-26.04"],
    steps: [
      step("Set up job"),
      step("Run actions/checkout@v7"),
      step("Run actions/setup-node@v7"),
      step("Write job summary"),
    ],
  })
  const macosJob = (name: string, conclusion: string) => ({
    name,
    conclusion,
    html_url: "u",
    labels: ["macos-latest"],
    steps: conclusion === "success" ? [step("Run actions/setup-node@v7"), step("Run root test shard 1 rest")] : [],
  })
  const combined = (first: string, second = first) => [
    macosJob("macos-combined-1", first),
    macosJob("macos-combined-2", second),
  ]
  function classify(jobs: unknown[]): Record<string, string> {
    const run = spawnSync("jq", ["-r", "-f", filter], { encoding: "utf8", input: JSON.stringify({ jobs }) })
    expect(run.status).toBe(0)
    return Object.fromEntries(
      run.stdout
        .trim()
        .split("\n")
        .map((line) => line.split("\t").slice(0, 2)),
    )
  }

  posixBashTest(
    "#when the macOS jobs were skipped #then a macOS status job that ran only setup steps is no-tests",
    () => {
      const result = classify([statusJob("test (macos-latest, 1/2)"), ...combined("skipped")])
      expect(result["test (macos-latest, 1/2)"]).toBe("no-tests")
      expect(result["macos-combined-1"]).toBe("skipped")
    },
  )

  posixBashTest(
    "#when both macOS jobs ran #then a passing status job is success, even if another macOS part failed",
    () => {
      const name = "test (macos-latest, 2/2)"
      expect(classify([statusJob(name), ...combined("success")])[name]).toBe("success")
      expect(classify([statusJob(name), ...combined("failure")])[name]).toBe("success")
      expect(classify([statusJob(name), ...combined("success", "failure")])[name]).toBe("success")
    },
  )

  posixBashTest("#when only one macOS job ran #then a status job that ran only setup steps is no-tests", () => {
    const name = "test (macos-latest, 2/2)"
    expect(classify([statusJob(name), ...combined("success", "cancelled")])[name]).toBe("no-tests")
    expect(classify([statusJob(name), ...combined("success", "skipped")])[name]).toBe("no-tests")
    expect(classify([statusJob(name), macosJob("macos-combined-1", "success")])[name]).toBe("no-tests")
  })

  posixBashTest(
    "#when the run predates the split #then its single macos-combined job is judged by the same rule",
    () => {
      const name = "test (macos-latest, 1/2)"
      expect(classify([statusJob(name), macosJob("macos-combined", "success")])[name]).toBe("success")
      expect(classify([statusJob(name), macosJob("macos-combined", "failure")])[name]).toBe("success")
      expect(classify([statusJob(name), macosJob("macos-combined", "skipped")])[name]).toBe("no-tests")
    },
  )

  posixBashTest("#when a status job's own part failed #then it is failure", () => {
    const failed = { ...statusJob("codex-compatibility (macos-latest, platform)"), conclusion: "failure" }
    expect(classify([failed, ...combined("failure")])["codex-compatibility (macos-latest, platform)"]).toBe("failure")
  })

  posixBashTest("#when a Windows leg ran only setup steps #then it is no-tests whatever the macOS jobs did", () => {
    const windows = { ...statusJob("test (windows-latest, 1/2)"), labels: ["windows-latest"] }
    expect(classify([windows, ...combined("success")])["test (windows-latest, 1/2)"]).toBe("no-tests")
  })
})

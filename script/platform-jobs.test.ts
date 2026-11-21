/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"

// Runs jq on the shared filter; Windows CI has no jq on the bash PATH this suite relies on.
const posixBashTest = test.skipIf(process.platform === "win32" || spawnSync("jq", ["--version"]).status !== 0)

// The job classification both the tracker and the release-state probe read. The macOS required contexts are Linux status
// jobs whose only always-on steps are checkout, setup-node and the summary; macos-combined runs the macOS tests.
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
  const combined = (conclusion: string) => ({
    name: "macos-combined",
    conclusion,
    html_url: "u",
    labels: ["macos-latest"],
    steps: conclusion === "success" ? [step("Run actions/setup-node@v7"), step("Run root test shard 1")] : [],
  })
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
    "#when macos-combined was skipped #then a macOS status job that ran only setup steps is no-tests",
    () => {
      const result = classify([statusJob("test (macos-latest, 1/2)"), combined("skipped")])
      expect(result["test (macos-latest, 1/2)"]).toBe("no-tests")
      expect(result["macos-combined"]).toBe("skipped")
    },
  )

  posixBashTest(
    "#when macos-combined ran #then a passing status job is success, even if another macOS part failed",
    () => {
      expect(classify([statusJob("test (macos-latest, 2/2)"), combined("success")])["test (macos-latest, 2/2)"]).toBe(
        "success",
      )
      expect(classify([statusJob("test (macos-latest, 2/2)"), combined("failure")])["test (macos-latest, 2/2)"]).toBe(
        "success",
      )
    },
  )

  posixBashTest("#when a status job's own part failed #then it is failure", () => {
    const failed = { ...statusJob("codex-compatibility (macos-latest, platform)"), conclusion: "failure" }
    expect(classify([failed, combined("failure")])["codex-compatibility (macos-latest, platform)"]).toBe("failure")
  })

  posixBashTest("#when a Windows leg ran only setup steps #then it is no-tests whatever macos-combined did", () => {
    const windows = { ...statusJob("test (windows-latest, 1/2)"), labels: ["windows-latest"] }
    expect(classify([windows, combined("success")])["test (windows-latest, 1/2)"]).toBe("no-tests")
  })
})

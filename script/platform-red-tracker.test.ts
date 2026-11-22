/// <reference types="bun-types" />

// The platform-red writer (#13802) runs as a shell step with no concurrency group; it must leave exactly one open
// ci:platform-red issue whatever order two writers race in. These cases run the real step against a fake gh.

import { afterAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { load } from "js-yaml"

// The writer runs against a PATH stub for gh, which Windows bash cannot shadow reliably.
const posixBashTest = test.skipIf(process.platform === "win32" || spawnSync("bash", ["-c", "exit 0"]).status !== 0)

const root = mkdtempSync(join(tmpdir(), "platform-red-tracker-"))
afterAll(() => rmSync(root, { recursive: true, force: true }))

function writerScript(): string {
  const workflow = load(readFileSync(new URL("../.github/workflows/platform-red-tracker.yml", import.meta.url), "utf8"))
  const steps = (workflow as { jobs: { "file-issue": { steps: { name?: string; run?: string }[] } } }).jobs[
    "file-issue"
  ].steps
  const step = steps.find((candidate) => candidate.name === "File or update the platform-red tracking issue")
  if (step?.run === undefined) throw new Error("the writer step must exist")
  return step.run
}

// `issue list` answers come from a queue, one line per call; every call is recorded.
function runWriter(name: string, listAnswers: readonly string[]): string[] {
  const dir = join(root, name)
  const bin = join(dir, "bin")
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(dir, "answers"), `${listAnswers.join("\n")}\n`)
  writeFileSync(
    join(bin, "gh"),
    [
      "#!/bin/bash",
      'echo "$*" >> "$FAKE_DIR/calls"',
      'case "$1 $2" in',
      '  "api repos/"*) echo "#13811" ;;',
      '  "issue list") head -n 1 "$FAKE_DIR/answers"; tail -n +2 "$FAKE_DIR/answers" > "$FAKE_DIR/rest"; mv "$FAKE_DIR/rest" "$FAKE_DIR/answers" ;;',
      '  "issue create") echo "https://github.com/owner/project/issues/42" ;;',
      "esac",
      "",
    ].join("\n"),
  )
  chmodSync(join(bin, "gh"), 0o755)
  const run = spawnSync("bash", ["-euo", "pipefail", "-c", writerScript()], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env["PATH"]}`,
      FAKE_DIR: dir,
      RUNNER_TEMP: dir,
      GH_REPO: "owner/project",
      RUN_URL: "https://example.invalid/run",
      RUN_NAME: "CI",
      HEAD_SHA: "abc",
      FAILED: "- test (windows-latest, 1/2)",
      INTRODUCED: "true",
    },
  })
  expect(run.status).toBe(0)
  return readFileSync(join(dir, "calls"), "utf8").trim().split("\n")
}

interface PriorRun {
  readonly id: string
  readonly sha: string
  readonly pr: string
  /** `skipped-tests`: the job succeeded but skipped its test steps, as a dev push with the heavy legs off does. */
  readonly windows: "success" | "failure" | "cancelled" | "skipped-tests"
}

function windowsJob(run: PriorRun) {
  const testsRan = run.windows !== "skipped-tests"
  return {
    name: "test (windows-latest, 1/2)",
    conclusion: testsRan ? run.windows : "success",
    html_url: `https://job/${run.id}`,
    labels: ["windows-latest"],
    steps: [
      { name: "Set up job", conclusion: "success" },
      { name: "Run actions/checkout@v7", conclusion: "success" },
      { name: "Run tests", conclusion: testsRan ? run.windows : "skipped" },
      { name: "Check that this leg ran its tests", conclusion: "success" },
    ],
  }
}

// The fake gh answers `gh api <path> --jq <filter>` by running the script's own filter through jq over a recorded
// API response, so the filters are exercised, not bypassed.
function spawnFirstRed(name: string, current: PriorRun, earlier: readonly PriorRun[], unreadableRun = false) {
  const dir = join(root, name)
  const bin = join(dir, "bin")
  const api = join(dir, "api")
  mkdirSync(bin, { recursive: true })
  mkdirSync(api, { recursive: true })
  const answer = (path: string, body: unknown) =>
    writeFileSync(join(api, path.replace(/[^A-Za-z0-9]/g, "_")), JSON.stringify(body))
  const repo = "repos/owner/project"
  const runJson = (run: PriorRun, createdAt: string) => ({
    id: Number(run.id),
    workflow_id: 7,
    created_at: createdAt,
    head_sha: run.sha,
    html_url: `https://run/${run.id}`,
  })
  if (!unreadableRun) answer(`${repo}/actions/runs/${current.id}`, runJson(current, "2026-11-21T09:00:00Z"))
  answer(`${repo}/actions/workflows/7/runs?branch=dev&event=push&status=completed&per_page=30`, {
    workflow_runs: [
      runJson(current, "2026-11-21T09:00:00Z"),
      ...earlier.map((run, index) => runJson(run, `2026-11-21T0${8 - index}:00:00Z`)),
    ],
  })
  for (const run of [current, ...earlier]) {
    answer(`${repo}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`, {
      jobs: [
        windowsJob(run),
        {
          name: "test (ubuntu-latest, 1/2)",
          conclusion: "failure",
          html_url: "https://job/linux",
          labels: ["ubuntu-26.04"],
          steps: [],
        },
      ],
    })
    answer(`${repo}/commits/${run.sha}/pulls`, [
      { number: Number(run.pr.slice(1)), merged_at: "2026-11-21T00:00:00Z" },
      { number: 1, merged_at: null },
    ])
  }
  writeFileSync(
    join(bin, "gh"),
    ["#!/bin/bash", 'key="$(printf %s "$2" | tr -c "A-Za-z0-9" _)"', 'jq -r "$4" "$FAKE_DIR/api/$key"', ""].join("\n"),
  )
  chmodSync(join(bin, "gh"), 0o755)
  const out = join(dir, "out")
  const run = spawnSync("bash", [new URL("../.github/scripts/platform-red-first-red.sh", import.meta.url).pathname], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env["PATH"]}`,
      FAKE_DIR: dir,
      GH_REPO: "owner/project",
      RUN_ID: current.id,
      OUT_DIR: out,
    },
  })
  return { run, out }
}

function runFirstRed(name: string, current: PriorRun, earlier: readonly PriorRun[]) {
  const { run, out } = spawnFirstRed(name, current, earlier)
  expect(run.stderr).toBe("")
  expect(run.status).toBe(0)
  return {
    failed: readFileSync(join(out, "failed.md"), "utf8"),
    introduced: readFileSync(join(out, "introduced"), "utf8").trim(),
  }
}

describe("#given a red macOS/Windows job on a dev push run", () => {
  const head: PriorRun = { id: "30", sha: "c3c3c3c3c3c3", pr: "#30", windows: "failure" }

  posixBashTest("#when the run before it was green #then this merge is named as the one that turned it red", () => {
    const { failed, introduced } = runFirstRed("introduced", head, [
      { id: "20", sha: "b2b2b2b2b2b2", pr: "#20", windows: "success" },
    ])
    expect(introduced).toBe("true")
    expect(failed).toContain("first red after merging #30 at `c3c3c3c3c3`")
    expect(failed).toContain("green at the commit before (`b2b2b2b2b2`)")
  })

  posixBashTest("#when earlier runs were already red #then the oldest red run after the last green is named", () => {
    const { failed, introduced } = runFirstRed("inherited", head, [
      { id: "20", sha: "b2b2b2b2b2b2", pr: "#20", windows: "failure" },
      { id: "15", sha: "a1a1a1a1a1a1", pr: "#15", windows: "failure" },
      { id: "10", sha: "909090909090", pr: "#10", windows: "success" },
    ])
    expect(introduced).toBe("false")
    expect(failed).toContain("first red after merging #15 at `a1a1a1a1a1` ([run](https://run/15))")
  })

  posixBashTest("#when the run before it passed without running its tests #then the red is traced past it", () => {
    const { failed, introduced } = runFirstRed("skipped-legs", head, [
      { id: "20", sha: "b2b2b2b2b2b2", pr: "#20", windows: "skipped-tests" },
      { id: "15", sha: "a1a1a1a1a1a1", pr: "#15", windows: "failure" },
      { id: "10", sha: "909090909090", pr: "#10", windows: "success" },
    ])
    expect(introduced).toBe("false")
    expect(failed.trim().split("\n")).toEqual([
      "- [test (windows-latest, 1/2)](https://job/30) on `windows-latest`: first red after merging #15 at `a1a1a1a1a1` ([run](https://run/15)); green at the commit before (`9090909090`)",
    ])
  })

  posixBashTest("#when the run cannot be read #then the step fails instead of reporting no red", () => {
    const { run } = spawnFirstRed("unreadable", head, [], true)
    expect(run.status).not.toBe(0)
  })

  posixBashTest(
    "#when a run between the last green and the first red has no result #then the cause is given as a range",
    () => {
      const { failed } = runFirstRed("gap", head, [
        { id: "20", sha: "b2b2b2b2b2b2", pr: "#20", windows: "cancelled" },
        { id: "10", sha: "909090909090", pr: "#10", windows: "success" },
      ])
      expect(failed).toContain("first red after merging #30")
      expect(failed).toContain("compare/909090909090...c3c3c3c3c3c3")
    },
  )
})

describe("#given the platform-red writer", () => {
  posixBashTest("#then an open issue gets a comment and nothing is created", () => {
    const calls = runWriter("existing", ["17"])
    expect(calls.filter((call) => call.startsWith("issue comment 17 "))).toHaveLength(1)
    expect(calls.some((call) => call.startsWith("issue create"))).toBe(false)
  })

  posixBashTest("#then a writer that lost the race comments on the older issue and closes its own", () => {
    const calls = runWriter("race", ["", "41"])
    expect(calls.filter((call) => call.startsWith("issue comment 41 "))).toHaveLength(1)
    expect(calls.filter((call) => call.startsWith("issue close 42 "))).toHaveLength(1)
  })

  posixBashTest("#then a re-read that briefly returns nothing keeps the issue it just created", () => {
    const calls = runWriter("stale-read", ["", ""])
    expect(calls.some((call) => call.startsWith("issue create"))).toBe(true)
    expect(calls.some((call) => call.startsWith("issue comment"))).toBe(false)
    expect(calls.some((call) => call.startsWith("issue close"))).toBe(false)
  })
})

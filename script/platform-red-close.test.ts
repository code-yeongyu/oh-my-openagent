/// <reference types="bun-types" />

// The platform-red closer must close the release-blocking issue only when every macOS/Windows job it names passed again
// on a dev push run of that job's own workflow, at or after the commit the job was red at; anything weaker leaves it
// open (#14606 stayed open after recovery; #14801 never closed because it named jobs from two workflows). The cases run
// the real script against a fake gh that applies the script's own jq filters.

import { afterAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const posixBashTest = test.skipIf(process.platform === "win32" || spawnSync("bash", ["-c", "exit 0"]).status !== 0)

const root = mkdtempSync(join(tmpdir(), "platform-red-close-"))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const REPO = "owner/project"

type TestsOutcome = "success" | "failure" | "skipped"
type CompareStatus = "ahead" | "identical" | "behind" | "diverged"

interface TrackedWorkflow {
  readonly workflowId: number
  readonly redRun: number
  readonly redSha: string
  readonly job: string
  readonly latestRun: number
  readonly latestSha: string
  readonly tests: TestsOutcome
  readonly compareStatus: CompareStatus
}

const ci = (overrides: Partial<TrackedWorkflow> = {}): TrackedWorkflow => ({
  workflowId: 1,
  redRun: 10,
  redSha: "a1a1a1a1a1a1a1a1",
  job: "test (windows-latest, 1/2)",
  latestRun: 99,
  latestSha: "c3c3c3c3c3c3c3c3",
  tests: "success",
  compareStatus: "ahead",
  ...overrides,
})

const computerEngine = (overrides: Partial<TrackedWorkflow> = {}): TrackedWorkflow => ({
  workflowId: 2,
  redRun: 20,
  redSha: "b2b2b2b2b2b2b2b2",
  job: "computer native contract (macos-15)",
  latestRun: 98,
  latestSha: "d4d4d4d4d4d4d4d4",
  tests: "success",
  compareStatus: "ahead",
  ...overrides,
})

// One issue block per tracked workflow, in the shape the tracker writes: the red commit in the first line, then a job
// line whose url names the red run.
function block(tracked: TrackedWorkflow): string {
  return [
    `A macOS/Windows job turned red on \`dev\` after merging #1 at \`${tracked.redSha}\`.`,
    "",
    `- [${tracked.job}](https://github.com/${REPO}/actions/runs/${tracked.redRun}/job/7) on \`windows-latest\`: first red after merging #1 at \`${tracked.redSha.slice(0, 10)}\``,
  ].join("\n")
}

function runClose(name: string, openIssues: readonly number[], tracked: readonly TrackedWorkflow[]): string[] {
  const dir = join(root, name)
  const bin = join(dir, "bin")
  const api = join(dir, "api")
  mkdirSync(bin, { recursive: true })
  mkdirSync(api, { recursive: true })
  const answer = (key: string, body: unknown) =>
    writeFileSync(join(api, key.replace(/[^A-Za-z0-9]/g, "_")), JSON.stringify(body))
  answer(
    "issue list",
    openIssues.map((number) => ({ number })),
  )
  const [first, ...rest] = tracked
  answer("issue view", { body: first ? block(first) : "", comments: rest.map((each) => ({ body: block(each) })) })
  for (const each of tracked) {
    answer(`repos/${REPO}/actions/runs/${each.redRun}`, { id: each.redRun, workflow_id: each.workflowId })
    answer(
      `repos/${REPO}/actions/workflows/${each.workflowId}/runs?branch=dev&event=push&status=completed&per_page=1`,
      {
        workflow_runs: [{ id: each.latestRun, head_sha: each.latestSha, html_url: `https://run/${each.latestRun}` }],
      },
    )
    answer(`repos/${REPO}/actions/runs/${each.latestRun}/jobs?filter=latest&per_page=100`, {
      jobs: [
        {
          name: each.job,
          conclusion: each.tests === "failure" ? "failure" : "success",
          html_url: `https://job/${each.latestRun}`,
          labels: ["windows-latest"],
          steps: [
            { name: "Set up job", conclusion: "success" },
            { name: "Run tests", conclusion: each.tests },
          ],
        },
      ],
    })
    answer(`repos/${REPO}/compare/${each.redSha}...${each.latestSha}`, { status: each.compareStatus })
  }
  writeFileSync(
    join(bin, "gh"),
    [
      "#!/bin/bash",
      'echo "$*" >> "$FAKE_DIR/calls"',
      'case "$1 $2" in',
      '  "issue list"|"issue view") key="$1 $2" ;;',
      '  "issue close") exit 0 ;;',
      '  *) key="$2" ;;',
      "esac",
      'for ((i = 1; i <= $#; i++)); do [ "${!i}" = --jq ] && { j=$((i + 1)); filter="${!j}"; }; done',
      'jq -r "$filter" "$FAKE_DIR/api/$(printf %s "$key" | tr -c "A-Za-z0-9" _)"',
      "",
    ].join("\n"),
  )
  chmodSync(join(bin, "gh"), 0o755)
  const run = spawnSync("bash", [new URL("../.github/scripts/platform-red-close.sh", import.meta.url).pathname], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env["PATH"]}`,
      FAKE_DIR: dir,
      GH_REPO: REPO,
      RUN_URL: "https://run/trigger",
      OUT_DIR: join(dir, "out"),
    },
  })
  expect(run.stderr).toBe("")
  expect(run.status).toBe(0)
  return readFileSync(join(dir, "calls"), "utf8").trim().split("\n")
}

const closed = (calls: readonly string[]) => calls.some((call) => call.startsWith("issue close 17 "))

describe("#given an open platform-red issue tracking one Windows job", () => {
  posixBashTest("#when a later dev push run ran that job's tests and passed #then the issue is closed", () => {
    // given / when
    const calls = runClose("green", [17], [ci()])
    // then
    expect(closed(calls)).toBe(true)
  })

  posixBashTest("#when the run's Windows leg skipped its tests #then the issue stays open", () => {
    const calls = runClose("skipped", [17], [ci({ tests: "skipped" })])
    expect(closed(calls)).toBe(false)
  })

  posixBashTest("#when the tracked job is still red #then the issue stays open", () => {
    const calls = runClose("still-red", [17], [ci({ tests: "failure" })])
    expect(closed(calls)).toBe(false)
  })

  posixBashTest("#when the latest run is for a commit older than the red one #then the issue stays open", () => {
    const calls = runClose("older-green", [17], [ci({ compareStatus: "behind" })])
    expect(closed(calls)).toBe(false)
  })
})

// #14801: the issue named CI jobs and a Computer engine job; each workflow's green run lacked the other's job.
describe("#given an open platform-red issue tracking jobs from two workflows", () => {
  posixBashTest(
    "#when each workflow's latest dev push run passed its own job after its red #then the issue is closed",
    () => {
      const calls = runClose("two-green", [17], [ci(), computerEngine()])
      expect(closed(calls)).toBe(true)
    },
  )

  posixBashTest("#when one workflow's job is still red #then the issue stays open", () => {
    const calls = runClose("two-one-red", [17], [ci(), computerEngine({ tests: "failure" })])
    expect(closed(calls)).toBe(false)
  })

  posixBashTest("#when one workflow has not run since its red commit #then the issue stays open", () => {
    const calls = runClose("two-not-rerun", [17], [ci(), computerEngine({ compareStatus: "behind" })])
    expect(closed(calls)).toBe(false)
  })
})

describe("#given no open platform-red issue", () => {
  posixBashTest("#then nothing is read or closed", () => {
    const calls = runClose("none", [], [ci()])
    expect(calls).toEqual([
      "issue list --label ci:platform-red --state open --json number --jq map(.number) | min // empty",
    ])
  })
})

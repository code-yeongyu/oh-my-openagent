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
  // A newer completed dev push run listed before latestRun, in which the tracked job did not conclude (#14856), or
  // concluded with this outcome. "none" is a job with no conclusion yet; "beyond-first-page" is a run of more than 100
  // jobs whose first page lacks the tracked job.
  readonly newer?: NewerOutcome
  // latestRun cancelled the tracked job, so no listed run concluded it.
  readonly latestCancelled?: boolean
}

type NewerOutcome =
  | "cancelled"
  | "absent"
  | "failure"
  | "timed_out"
  | "action_required"
  | "startup_failure"
  | "none"
  | "beyond-first-page"

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

function runClose(
  name: string,
  openIssues: readonly number[],
  tracked: readonly TrackedWorkflow[],
  runList: "listed" | "empty" | "error" = "listed",
): { readonly calls: string[]; readonly status: number | null; readonly stdout: string } {
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
    const newerRun = each.latestRun + 1000
    const completedRuns = {
      workflow_runs: [
        ...(each.newer === undefined
          ? []
          : [{ id: newerRun, head_sha: "e5e5e5e5e5e5e5e5", html_url: `https://run/${newerRun}` }]),
        { id: each.latestRun, head_sha: each.latestSha, html_url: `https://run/${each.latestRun}` },
      ],
    }
    // The run listing the closer reads, and the newest-run-only listing it read before #14856 (kept so the old script
    // fails these cases for the intended reason).
    for (const perPage of [20, 1])
      answer(
        `repos/${REPO}/actions/workflows/${each.workflowId}/runs?branch=dev&event=push&status=completed&per_page=${perPage}`,
        { workflow_runs: runList === "empty" ? [] : completedRuns.workflow_runs.slice(0, perPage) },
      )
    if (each.newer !== undefined)
      answer(`repos/${REPO}/actions/runs/${newerRun}/jobs?filter=latest&per_page=100`, {
        total_count: each.newer === "beyond-first-page" ? 150 : 1,
        jobs:
          each.newer === "absent" || each.newer === "beyond-first-page"
            ? []
            : [
                {
                  name: each.job,
                  conclusion: each.newer === "none" ? null : each.newer,
                  html_url: `https://job/${newerRun}`,
                  labels: ["windows-latest"],
                  steps: [
                    {
                      name: "Run tests",
                      conclusion: each.newer === "none" ? null : each.newer === "failure" ? "failure" : "cancelled",
                    },
                  ],
                },
              ],
      })
    answer(`repos/${REPO}/actions/runs/${each.latestRun}/jobs?filter=latest&per_page=100`, {
      total_count: 1,
      jobs: [
        {
          name: each.job,
          conclusion: each.latestCancelled ? "cancelled" : each.tests === "failure" ? "failure" : "success",
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
      'case "$2" in',
      '  *"/runs?branch=dev"*) [ "$RUN_LIST" = error ] && { echo "gh: HTTP 502" >&2; exit 1; } ;;',
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
      RUN_LIST: runList,
    },
  })
  const calls = readFileSync(join(dir, "calls"), "utf8").trim().split("\n")
  if (runList !== "error") {
    expect(run.stderr).toBe("")
    expect(run.status).toBe(0)
  }
  return { calls, status: run.status, stdout: run.stdout }
}

const closed = (result: { readonly calls: readonly string[] }) =>
  result.calls.some((call) => call.startsWith("issue close 17 "))

describe("#given an open platform-red issue tracking one Windows job", () => {
  posixBashTest("#when a later dev push run ran that job's tests and passed #then the issue is closed", () => {
    // given / when
    const result = runClose("green", [17], [ci()])
    // then
    expect(closed(result)).toBe(true)
  })

  posixBashTest("#when the run's Windows leg skipped its tests #then the issue stays open", () => {
    const result = runClose("skipped", [17], [ci({ tests: "skipped" })])
    expect(closed(result)).toBe(false)
  })

  posixBashTest("#when the tracked job is still red #then the issue stays open", () => {
    const result = runClose("still-red", [17], [ci({ tests: "failure" })])
    expect(closed(result)).toBe(false)
  })

  posixBashTest("#when the latest run is for a commit older than the red one #then the issue stays open", () => {
    const result = runClose("older-green", [17], [ci({ compareStatus: "behind" })])
    expect(closed(result)).toBe(false)
  })
})

// #14856: the newest completed dev push run was cancelled (superseded), so the tracked job never concluded there.
describe("#given the newest completed dev push run did not conclude the tracked job", () => {
  posixBashTest(
    "#when it was cancelled and the run before passed the job #then the issue is closed on that run",
    () => {
      expect(closed(runClose("newest-cancelled", [17], [ci({ newer: "cancelled" })]))).toBe(true)
    },
  )

  posixBashTest("#when it lacks the job and the run before passed it #then the issue is closed on that run", () => {
    expect(closed(runClose("newest-absent", [17], [ci({ newer: "absent" })]))).toBe(true)
  })

  posixBashTest("#when it was cancelled and the run before failed the job #then the issue stays open", () => {
    expect(closed(runClose("newest-cancelled-prev-red", [17], [ci({ newer: "cancelled", tests: "failure" })]))).toBe(
      false,
    )
  })

  posixBashTest("#when the newest run failed the job after an older green #then the issue stays open", () => {
    expect(closed(runClose("newest-red-older-green", [17], [ci({ newer: "failure" })]))).toBe(false)
  })

  // #14857 review: a timed-out, approval-blocked or never-started job is red, never "no evidence".
  for (const newer of ["timed_out", "action_required", "startup_failure"] as const)
    posixBashTest(
      `#when the newest run ended the job '${newer}' after an older green #then the issue stays open`,
      () => {
        expect(closed(runClose(`newest-${newer}-older-green`, [17], [ci({ newer })]))).toBe(false)
      },
    )

  // A job with no conclusion yet is passed over: the older green decides, and it closes only when the compare passes.
  posixBashTest(
    "#when the newest job has no conclusion and the older green is after the red #then the issue is closed",
    () => {
      expect(closed(runClose("newest-none-older-green", [17], [ci({ newer: "none" })]))).toBe(true)
    },
  )

  posixBashTest(
    "#when the newest job has no conclusion and the older green is before the red #then the issue stays open",
    () => {
      expect(
        closed(runClose("newest-none-older-green-behind", [17], [ci({ newer: "none", compareStatus: "behind" })])),
      ).toBe(false)
    },
  )

  posixBashTest(
    "#when the newest run has more than 100 jobs and its first page lacks the job #then the issue stays open",
    () => {
      const result = runClose("newest-beyond-first-page", [17], [ci({ newer: "beyond-first-page" })])
      expect(closed(result)).toBe(false)
      expect(result.stdout).toContain("not among the first 100")
    },
  )
})

// #14801: the issue named CI jobs and a Computer engine job; each workflow's green run lacked the other's job.
describe("#given an open platform-red issue tracking jobs from two workflows", () => {
  posixBashTest(
    "#when each workflow's latest dev push run passed its own job after its red #then the issue is closed",
    () => {
      const result = runClose("two-green", [17], [ci(), computerEngine()])
      expect(closed(result)).toBe(true)
    },
  )

  posixBashTest("#when one workflow's job is still red #then the issue stays open", () => {
    const result = runClose("two-one-red", [17], [ci(), computerEngine({ tests: "failure" })])
    expect(closed(result)).toBe(false)
  })

  posixBashTest("#when one workflow has not run since its red commit #then the issue stays open", () => {
    const result = runClose("two-not-rerun", [17], [ci(), computerEngine({ compareStatus: "behind" })])
    expect(closed(result)).toBe(false)
  })

  posixBashTest("#when one job concluded in none of its workflow's listed runs #then the issue stays open", () => {
    const result = runClose(
      "two-one-unconcluded",
      [17],
      [ci(), computerEngine({ newer: "cancelled", latestCancelled: true })],
    )
    expect(closed(result)).toBe(false)
    expect(result.stdout).toContain("concluded in none")
  })
})

// #14857 review: the closer reads one page of 20 runs; an empty page or a failing gh call never closes the issue.
describe("#given the run list cannot prove a conclusion", () => {
  posixBashTest(
    "#when the workflow has no completed dev push run #then the issue stays open and the log says so",
    () => {
      const result = runClose("no-runs", [17], [ci()], "empty")
      expect(closed(result)).toBe(false)
      expect(result.stdout).toContain("concluded in none")
    },
  )

  posixBashTest("#when reading the run list fails #then the step fails and nothing is closed", () => {
    const result = runClose("list-error", [17], [ci()], "error")
    expect(result.status).not.toBe(0)
    expect(closed(result)).toBe(false)
  })
})

describe("#given no open platform-red issue", () => {
  posixBashTest("#then nothing is read or closed", () => {
    const { calls } = runClose("none", [], [ci()])
    expect(calls).toEqual([
      "issue list --label ci:platform-red --state open --json number --jq map(.number) | min // empty",
    ])
  })
})

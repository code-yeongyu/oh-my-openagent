/// <reference types="bun-types" />

// The platform-red closer must close the release-blocking issue only when a dev push run proves every tracked
// macOS/Windows job green at or after every red commit; anything weaker leaves it open (#14606 stayed open after
// recovery). The cases run the real script against a fake gh that applies the script's own jq filters.

import { afterAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const posixBashTest = test.skipIf(process.platform === "win32" || spawnSync("bash", ["-c", "exit 0"]).status !== 0)

const root = mkdtempSync(join(tmpdir(), "platform-red-close-"))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const RED_SHA = "a1a1a1a1a1a1a1a1"
const GREEN_SHA = "c3c3c3c3c3c3c3c3"
const TRACKED_JOB = "test (windows-latest, 1/2)"

interface Scenario {
  readonly openIssues: readonly number[]
  readonly windowsTests: "success" | "failure" | "skipped"
  readonly compareStatus: "ahead" | "identical" | "behind" | "diverged"
}

function issueBody(): string {
  return [
    `A macOS/Windows job turned red on \`dev\` after merging #10 at \`${RED_SHA}\`.`,
    "",
    `- [${TRACKED_JOB}](https://job/1) on \`windows-latest\`: first red after merging #10 at \`a1a1a1a1a1\``,
  ].join("\n")
}

function runClose(name: string, scenario: Scenario): string[] {
  const dir = join(root, name)
  const bin = join(dir, "bin")
  const api = join(dir, "api")
  mkdirSync(bin, { recursive: true })
  mkdirSync(api, { recursive: true })
  const answer = (key: string, body: unknown) =>
    writeFileSync(join(api, key.replace(/[^A-Za-z0-9]/g, "_")), JSON.stringify(body))
  answer(
    "issue list",
    scenario.openIssues.map((number) => ({ number })),
  )
  answer("issue view", { body: issueBody(), comments: [] })
  answer(`repos/owner/project/actions/runs/99/jobs?filter=latest&per_page=100`, {
    jobs: [
      {
        name: TRACKED_JOB,
        conclusion: scenario.windowsTests === "failure" ? "failure" : "success",
        html_url: "https://job/99",
        labels: ["windows-latest"],
        steps: [
          { name: "Set up job", conclusion: "success" },
          { name: "Run tests", conclusion: scenario.windowsTests },
        ],
      },
    ],
  })
  answer(`repos/owner/project/compare/${RED_SHA}...${GREEN_SHA}`, { status: scenario.compareStatus })
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
      GH_REPO: "owner/project",
      RUN_ID: "99",
      RUN_URL: "https://run/99",
      HEAD_SHA: GREEN_SHA,
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
    // given
    const scenario: Scenario = { openIssues: [17], windowsTests: "success", compareStatus: "ahead" }
    // when
    const calls = runClose("green", scenario)
    // then
    expect(closed(calls)).toBe(true)
  })

  posixBashTest("#when the run's Windows leg skipped its tests #then the issue stays open", () => {
    const calls = runClose("skipped", { openIssues: [17], windowsTests: "skipped", compareStatus: "ahead" })
    expect(closed(calls)).toBe(false)
  })

  posixBashTest("#when the tracked job is still red #then the issue stays open", () => {
    const calls = runClose("still-red", { openIssues: [17], windowsTests: "failure", compareStatus: "ahead" })
    expect(closed(calls)).toBe(false)
  })

  posixBashTest("#when the green run is for a commit older than the red one #then the issue stays open", () => {
    const calls = runClose("older-green", { openIssues: [17], windowsTests: "success", compareStatus: "behind" })
    expect(closed(calls)).toBe(false)
  })
})

describe("#given no open platform-red issue", () => {
  posixBashTest("#then nothing is read or closed", () => {
    const calls = runClose("none", { openIssues: [], windowsTests: "success", compareStatus: "ahead" })
    expect(calls).toEqual([
      "issue list --label ci:platform-red --state open --json number --jq map(.number) | min // empty",
    ])
  })
})

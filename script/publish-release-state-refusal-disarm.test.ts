/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * Release contract (#15126): publish.yml arms auto-merge on the release-state PR. When it then refuses the release
 * (a failing check, or the merge wait times out), it must disarm that auto-merge before exiting: auto-merge waits only
 * on the required checks, so a stamp refused for a non-required check would otherwise land on dev with nothing published
 * (5.1.84's #15124). Executes the shipped step from its gh helpers on, with `gh` and `sleep` stubbed.
 */

const STEP = "Publish prepared release state"

function stepFromHelpers(): string {
  const workflow = Bun.YAML.parse(
    readFileSync(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n"),
  ) as { jobs: Record<string, { steps: Array<{ name?: string; run?: string }> }> }
  const run = workflow.jobs["prepare-release-state"]?.steps.find((step) => step.name === STEP)?.run
  if (!run) throw new Error(`prepare-release-state has no runnable step named ${STEP}`)
  const start = run.indexOf("retry_gh() {")
  if (start < 0) throw new Error("the step defines no retry_gh helper")
  // The branch push before the helpers needs a real origin; the PR wait after them is what this test drives.
  return `set -euo pipefail\n${run.slice(start)}`
}

const GH_STUB = [
  "gh() {",
  '  printf "%s\\n" "$*" >> "$GH_CALLS"',
  '  local filter="" previous="" argument',
  '  for argument in "$@"; do [ "$previous" = --jq ] && filter="$argument"; previous="$argument"; done',
  '  case "$*" in',
  '    "pr list "*) printf "77\\n" ;;',
  '    "pr merge 77 --merge --auto"*) touch "$STATE/armed" ;;',
  '    "pr merge 77 --disable-auto"*) [ -n "$DISABLE_FAILS" ] && return 1; rm -f "$STATE/armed"; [ -n "$MERGES_IN_RACE" ] && touch "$STATE/merged"; return 0 ;;',
  '    "pr view 77 --json autoMergeRequest"*) if [ -e "$STATE/armed" ]; then echo true; else echo false; fi ;;',
  '    "pr view 77 --json state"*) if [ -e "$STATE/merged" ]; then echo MERGED; else echo OPEN; fi ;;',
  '    "pr view 77 --json statusCheckRollup"*) printf \'{"statusCheckRollup":[{"name":"sdk-parity","conclusion":"%s"}]}\' "$CHECK" | jq -r "$filter" ;;',
  '    "pr view 77 --json url,statusCheckRollup"*) echo "{}" ;;',
  "    *) return 1 ;;",
  "  esac",
  "}",
  "sleep() { :; }",
  "",
].join("\n")

interface Case {
  readonly check: "FAILURE" | "SUCCESS"
  readonly mergesInRace?: boolean
  readonly disableFails?: boolean
}

interface Outcome {
  readonly status: number
  readonly output: string
  readonly ghCalls: string
}

const scratch: string[] = []
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function run(input: Case): Outcome {
  const root = mkdtempSync(join(tmpdir(), "publish-refusal-disarm-"))
  scratch.push(root)
  const script = join(root, "step.sh")
  writeFileSync(script, GH_STUB + stepFromHelpers())
  const ghCalls = join(root, "gh-calls")
  writeFileSync(ghCalls, "")
  const result = spawnSync("bash", [script], {
    cwd: root,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      GH_CALLS: ghCalls,
      STATE: root,
      CHECK: input.check,
      MERGES_IN_RACE: input.mergesInRace ? "1" : "",
      DISABLE_FAILS: input.disableFails ? "1" : "",
      RELEASE_BRANCH: "release/v9.9.9-source-state",
      BASE_REF: "dev",
      GITHUB_OUTPUT: join(root, "output"),
      SOURCE_SHA: "",
    },
  })
  if (result.error) throw result.error
  return {
    status: result.status ?? -1,
    output: `${result.stdout}${result.stderr}`,
    ghCalls: readFileSync(ghCalls, "utf8"),
  }
}

describe("publish.yml release-state refusal (#15126)", () => {
  test("#when a check on the stamp PR fails #then the release is refused and its auto-merge is disabled", () => {
    const result = run({ check: "FAILURE" })
    expect(result.status).not.toBe(0)
    expect(result.output).toContain(
      "Release-state PR #77 has failing required checks; refusing to publish npm packages.",
    )
    expect(result.ghCalls).toContain("pr merge 77 --disable-auto")
    expect(result.output).toContain(
      "Disabled auto-merge on release-state PR #77; it stays open, unmerged, for a maintainer.",
    )
  })

  test("#when the merge wait times out #then the release is refused and its auto-merge is disabled", () => {
    const result = run({ check: "SUCCESS" })
    expect(result.status).not.toBe(0)
    expect(result.output).toContain(
      "Timed out waiting for release-state PR #77 to merge; refusing to publish npm packages.",
    )
    expect(result.ghCalls).toContain("pr merge 77 --disable-auto")
  })

  test("#when the PR merges before auto-merge could be disabled #then the refusal says dev carries an unpublished version", () => {
    const result = run({ check: "FAILURE", mergesInRace: true })
    expect(result.status).not.toBe(0)
    expect(result.output).toContain(
      "merged before its auto-merge could be disabled: dev now carries a version this run did not publish",
    )
  })

  test("#when auto-merge cannot be confirmed off #then the refusal asks for it to be disabled by hand", () => {
    const result = run({ check: "FAILURE", disableFails: true })
    expect(result.status).not.toBe(0)
    expect(result.output).toContain("Could not confirm that auto-merge is off on release-state PR #77")
  })
})

/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * Release contract (#15126): publish.yml arms auto-merge on the release-state PR. Every failed exit after that PR exists
 * (a failing check, a merge-wait timeout, a failed read, a failed enable) must disarm it before the step ends: auto-merge
 * waits only on the required checks, so a stamp refused for a non-required check would otherwise land on the base with
 * nothing published (5.1.84's #15124). Executes the shipped step from its gh helpers on, with `gh` and `sleep` stubbed.
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
  return `set -euo pipefail\nBASE_REF="\${RELEASE_REF:-dev}"\n${run.slice(start)}`
}

// STATE files: armed (auto-merge on), merged, closed. The *_FAILS knobs make that gh call fail every time.
const GH_STUB = [
  "gh() {",
  '  printf "%s\\n" "$*" >> "$GH_CALLS"',
  '  local filter="" previous="" argument',
  '  for argument in "$@"; do [ "$previous" = --jq ] && filter="$argument"; previous="$argument"; done',
  '  case "$*" in',
  '    "pr list "*) printf "77\\n" ;;',
  '    "pr merge 77 --merge --auto"*) touch "$STATE/armed"; [ -z "$ENABLE_FAILS" ] ;;',
  '    "pr merge 77 --disable-auto"*) [ -n "$DISABLE_FAILS" ] && return 1; rm -f "$STATE/armed"; [ -n "$MERGES_IN_RACE" ] && touch "$STATE/merged"; [ -n "$CLOSES_IN_RACE" ] && touch "$STATE/closed"; return 0 ;;',
  '    "pr view 77 --json autoMergeRequest"*) [ -n "$ENABLE_FAILS" ] && return 1; if [ -e "$STATE/armed" ]; then echo true; else echo false; fi ;;',
  '    "pr view 77 --json state,autoMergeRequest"*) [ -n "$SNAPSHOT_FAILS" ] && return 1; local st=OPEN; [ -e "$STATE/merged" ] && st=MERGED; [ -e "$STATE/closed" ] && st=CLOSED; printf \'{"state":"%s","autoMergeRequest":%s}\' "$st" "$([ -e "$STATE/armed" ] && echo "{}" || echo null)" | jq -r "$filter" ;;',
  '    "pr view 77 --json state"*) [ -n "$STATE_READ_FAILS" ] && return 1; echo OPEN ;;',
  '    "pr view 77 --json statusCheckRollup"*) printf \'{"statusCheckRollup":[{"name":"sdk-parity","conclusion":"%s"}]}\' "$CHECK" | jq -r "$filter" ;;',
  '    "pr view 77 --json url,statusCheckRollup"*) echo "{}" ;;',
  "    *) return 1 ;;",
  "  esac",
  "}",
  "sleep() { :; }",
  "",
].join("\n")

interface Case {
  readonly check?: "FAILURE" | "SUCCESS"
  readonly mergesInRace?: boolean
  readonly closesInRace?: boolean
  readonly disableFails?: boolean
  readonly snapshotFails?: boolean
  readonly stateReadFails?: boolean
  readonly enableFails?: boolean
  readonly sourceSha?: string
  readonly releaseRef?: string
}

interface Outcome {
  readonly status: number
  readonly output: string
  readonly ghCalls: string
  readonly armed: boolean
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
      CHECK: input.check ?? "FAILURE",
      MERGES_IN_RACE: input.mergesInRace ? "1" : "",
      CLOSES_IN_RACE: input.closesInRace ? "1" : "",
      DISABLE_FAILS: input.disableFails ? "1" : "",
      SNAPSHOT_FAILS: input.snapshotFails ? "1" : "",
      STATE_READ_FAILS: input.stateReadFails ? "1" : "",
      ENABLE_FAILS: input.enableFails ? "1" : "",
      RELEASE_BRANCH: "release/v9.9.9-source-state",
      RELEASE_REF: input.releaseRef ?? "dev",
      VERSION: "9.9.9",
      GITHUB_OUTPUT: join(root, "output"),
      GITHUB_REPOSITORY: "code-yeongyu/oh-my-openagent",
      SOURCE_SHA: input.sourceSha ?? "",
    },
  })
  if (result.error) throw result.error
  const armed = spawnSync("test", ["-e", join(root, "armed")]).status === 0
  return {
    status: result.status ?? -1,
    output: `${result.stdout}${result.stderr}`,
    ghCalls: readFileSync(ghCalls, "utf8"),
    armed,
  }
}

const KEPT_OPEN = "Disabled auto-merge on release-state PR #77; it stays open and unmerged for a maintainer."

describe("publish.yml release-state refusal (#15126)", () => {
  test("#when a check on the stamp PR fails #then the release is refused and its auto-merge is disabled", () => {
    const result = run({ check: "FAILURE" })
    expect(result.status).not.toBe(0)
    expect(result.output).toContain("Release-state PR #77 has failing checks; refusing to publish npm packages.")
    expect(result.armed).toBe(false)
    expect(result.output).toContain(KEPT_OPEN)
  })

  test("#when the merge wait times out #then the release is refused and its auto-merge is disabled", () => {
    const result = run({ check: "SUCCESS" })
    expect(result.status).not.toBe(0)
    expect(result.output).toContain(
      "Timed out waiting for release-state PR #77 to merge; refusing to publish npm packages.",
    )
    expect(result.armed).toBe(false)
  })

  test("#when reading the PR's state fails past its retries #then the step still disarms it before failing", () => {
    const result = run({ stateReadFails: true })
    expect(result.status).not.toBe(0)
    expect(result.armed).toBe(false)
    expect(result.output).toContain(KEPT_OPEN)
  })

  test("#when enabling auto-merge reports failure after reaching GitHub #then the step disarms it before failing", () => {
    const result = run({ enableFails: true, check: "SUCCESS" })
    expect(result.status).not.toBe(0)
    expect(result.output).toContain("Read release-state PR auto-merge failed after 5 retries")
    expect(result.ghCalls).not.toContain("statusCheckRollup")
    expect(result.armed).toBe(false)
    expect(result.output).toContain(KEPT_OPEN)
  })

  test("#when the PR was closed meanwhile #then the refusal says so, not that it stays open", () => {
    const result = run({ closesInRace: true })
    expect(result.status).not.toBe(0)
    expect(result.output).toContain("Release-state PR #77 is closed; nothing was merged.")
    expect(result.output).not.toContain(KEPT_OPEN)
  })

  test("#when the PR's state cannot be read after disarming #then the refusal does not claim it stays open", () => {
    const result = run({ snapshotFails: true })
    expect(result.status).not.toBe(0)
    expect(result.output).toContain("Could not confirm that auto-merge is off on release-state PR #77")
    expect(result.output).not.toContain(KEPT_OPEN)
  })

  test("#when auto-merge cannot be disabled #then the refusal asks for it to be disabled by hand", () => {
    const result = run({ disableFails: true })
    expect(result.status).not.toBe(0)
    expect(result.output).toContain("Could not confirm that auto-merge is off on release-state PR #77")
  })

  test("#when a pinned release's PR merged in the race #then it names the base, the version and the pinned recovery", () => {
    const pin = "0123456789abcdef0123456789abcdef01234567"
    const result = run({ mergesInRace: true, sourceSha: pin })
    expect(result.status).not.toBe(0)
    expect(result.output).toContain("merged into dev before its auto-merge was disabled: dev now declares v9.9.9")
    expect(result.output).toContain(`version=9.9.9 and source_sha=${pin}`)
  })

  test("#when an unpinned release's PR merged in the race #then it names its own base and promises no reuse", () => {
    const result = run({ mergesInRace: true, releaseRef: "release-line" })
    expect(result.status).not.toBe(0)
    expect(result.output).toContain(
      "merged into release-line before its auto-merge was disabled: release-line now declares v9.9.9",
    )
    expect(result.output).toContain(
      "reuses the merged stamp only while release-line's tree still equals it; otherwise publish an unused version",
    )
  })
})

/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"

/**
 * Executes the release-state reuse decision of publish.yml's "prepare" step against a real git
 * history. The block is taken from the workflow text, not copied, so this test fails the moment the
 * shipped shell drifts from what it asserts.
 *
 * Regression pinned (2026-09-04, beta.41): a retry after a failed publish found the FIRST attempt's
 * `release: v5.0.0-beta.41` commit by message grep and handed that stale SHA to the publish child.
 * That commit sat behind dev, so its tree lacked every fix merged since (the senpi 2026.9.4-3 pin
 * among them). Only gate-reuse's "no successful CI on that SHA" refusal kept the wrong tree off npm.
 */

const workflowPath = new URL("../.github/workflows/publish.yml", import.meta.url)
const workflowText = readFileSync(workflowPath, "utf8").replace(/\r\n/g, "\n")
const workflow = z.object({ jobs: z.object({
  "prepare-release-state": z.object({
    steps: z.array(z.object({ id: z.string().optional(), run: z.string().optional() })),
  }),
}) }).parse(Bun.YAML.parse(workflowText))

function prepareRunBlock(): string {
  const job = workflow.jobs["prepare-release-state"]
  const step = job.steps.find((s) => s.id === "prepare")
  if (!step?.run) throw new Error("publish.yml prepare-release-state has no step id=prepare with a run block")
  // Stop before the stamping half: the fixture is a bare history with no package manifests.
  const cut = step.run.indexOf('git checkout -B "$RELEASE_BRANCH"')
  if (cut === -1) throw new Error("prepare run block no longer contains the checkout -B marker")
  return step.run.slice(0, cut)
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" } })
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`)
  return result.stdout.trim()
}

function commit(cwd: string, message: string): string {
  writeFileSync(join(cwd, "file.txt"), message + "\n")
  git(cwd, ["add", "file.txt"])
  git(cwd, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", message])
  return git(cwd, ["rev-parse", "HEAD"])
}

interface Fixture { readonly work: string; readonly origin: string; readonly root: string }

/** A bare origin with a `dev` branch and a clone that tracks it, mirroring the runner checkout. */
function createFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "publish-stale-stamp-"))
  const origin = join(root, "origin.git")
  const seed = join(root, "seed")
  git(root, ["init", "-q", "--bare", origin])
  git(root, ["init", "-q", "-b", "dev", seed])
  commit(seed, "initial")
  git(seed, ["remote", "add", "origin", origin])
  git(seed, ["push", "-q", "origin", "dev"])
  const work = join(root, "work")
  git(root, ["clone", "-q", origin, work])
  return { work, origin, root }
}

function pushDev(seed: string): void { git(seed, ["push", "-q", "origin", "dev"]) }

function mergedRelease(fixture: Fixture, version: string, extraContent = false): { readonly stamp: string; readonly merge: string } {
  const seed = join(fixture.root, "seed")
  git(seed, ["checkout", "-q", "-b", "release"])
  const stamp = commit(seed, `release: v${version}`)
  git(seed, ["checkout", "-q", "dev"])
  if (extraContent) {
    writeFileSync(join(seed, "later.txt"), "merged after preparation\n")
    git(seed, ["add", "later.txt"])
    git(seed, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "later change"])
  }
  git(seed, ["-c", "user.email=noreply@github.com", "-c", "user.name=GitHub", "merge", "--no-ff", "-q", "release", "-m", `Merge release\n\nrelease: v${version}`])
  pushDev(seed)
  return { stamp, merge: git(seed, ["rev-parse", "HEAD"]) }
}

function runMergedSelection(fixture: Fixture, stamp: string, merge: string): { readonly status: number; readonly output: string } {
  const step = workflow.jobs["prepare-release-state"].steps.find((candidate) => candidate.id === "publish_state")
  if (!step?.run) throw new Error("missing publish_state shell")
  const start = step.run.indexOf('if [ "$PR_STATE" = "MERGED" ]; then')
  const end = step.run.indexOf("FAILURES=", start)
  if (start < 0 || end < 0) throw new Error("missing merged-PR selection block")
  const outputFile = join(fixture.root, "merged_output")
  writeFileSync(outputFile, "")
  const script = join(fixture.root, "merged.sh")
  writeFileSync(script, `set -euo pipefail
retry_gh() { shift; "$@"; }
gh() {
  case "\${*: -1}" in
    .mergeCommit.oid) printf '%s\\n' "$FIXTURE_MERGE" ;;
    .headRefOid) printf '%s\\n' "$FIXTURE_STAMP" ;;
    *) return 99 ;;
  esac
}
PR_STATE=MERGED
PR_NUMBER=1
${step.run.slice(start, end)}`)
  const result = spawnSync("bash", [script], {
    cwd: fixture.work, encoding: "utf8", timeout: 20_000,
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", FIXTURE_STAMP: stamp, FIXTURE_MERGE: merge, GITHUB_OUTPUT: outputFile },
  })
  return { status: result.status ?? -1, output: readFileSync(outputFile, "utf8") }
}

function runPrepare(fixture: Fixture, version: string): { status: number; stdout: string; stderr: string; outputs: Record<string, string> } {
  const outputFile = join(fixture.root, "github_output")
  writeFileSync(outputFile, "")
  const script = join(fixture.root, "prepare.sh")
  writeFileSync(script, prepareRunBlock())
  const result = spawnSync("bash", [script], {
    cwd: fixture.work,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", VERSION: version, OMO_AI_VERSION: version, RELEASE_REF: "dev", PREPARED_RELEASE_SHA: "", GITHUB_SHA: "", GITHUB_OUTPUT: outputFile },
  })
  const outputs: Record<string, string> = {}
  for (const line of readFileSync(outputFile, "utf8").split("\n")) { const i = line.indexOf("="); if (i > 0) outputs[line.slice(0, i)] = line.slice(i + 1) }
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr, outputs }
}

describe("publish.yml prepare-release-state reuse decision", () => {
  test("#given a stale 'release: vX' commit behind the base head #when prepare runs for vX #then it refuses instead of handing the stale SHA to the publish child", () => {
    const fixture = createFixture()
    try {
      const seed = join(fixture.root, "seed")
      const stale = commit(seed, "release: v9.9.9-beta.1")
      commit(seed, "fix: something merged after the failed first attempt")
      pushDev(seed)

      const result = runPrepare(fixture, "9.9.9-beta.1")

      expect(result.outputs.release_sha).not.toBe(stale)
      expect(result.status).not.toBe(0)
      expect(result.stdout + result.stderr).toContain("stale")
    } finally { rmSync(fixture.root, { recursive: true, force: true }) }
  })

  test("#given the 'release: vX' commit IS the base head #when prepare runs for vX #then it reuses that SHA without pushing", () => {
    const fixture = createFixture()
    try {
      const seed = join(fixture.root, "seed")
      const head = commit(seed, "release: v9.9.9-beta.2")
      pushDev(seed)

      const result = runPrepare(fixture, "9.9.9-beta.2")

      expect(result.status).toBe(0)
      expect(result.outputs.release_sha).toBe(head)
      expect(result.outputs.needs_push).toBe("false")
    } finally { rmSync(fixture.root, { recursive: true, force: true }) }
  })

  for (const tagged of [false, true]) {
    test(`#given a merged stamping commit${tagged ? " with a tag" : ""} #when preparation resumes #then the original source is reused`, () => {
      const fixture = createFixture()
      try {
        const version = "9.9.9-beta.3"
        const { stamp, merge } = mergedRelease(fixture, version)
        if (tagged) {
          const seed = join(fixture.root, "seed")
          git(seed, ["tag", `v${version}`, stamp])
          git(seed, ["push", "-q", "origin", `v${version}`])
        }

        const result = runPrepare(fixture, version)

        expect(result.status).toBe(0)
        expect(result.outputs.release_sha).toBe(stamp)
        expect(result.outputs.release_sha).not.toBe(merge)
        expect(result.outputs.needs_push).toBe("false")
      } finally { rmSync(fixture.root, { recursive: true, force: true }) }
    })
  }

  test("#given an unrelated tagged commit with an identical tree #when preparation resumes #then it refuses that source", () => {
    const fixture = createFixture()
    try {
      const version = "9.9.9-beta.4"
      const { stamp, merge } = mergedRelease(fixture, version)
      const seed = join(fixture.root, "seed")
      git(seed, ["checkout", "-q", "-b", "unrelated", `${merge}^1`])
      commit(seed, "different lineage")
      const unrelated = commit(seed, `release: v${version}`)
      expect(git(seed, ["rev-parse", `${unrelated}^{tree}`])).toBe(git(seed, ["rev-parse", `${stamp}^{tree}`]))
      git(seed, ["tag", `v${version}`, unrelated])
      git(seed, ["push", "-q", "origin", `v${version}`])

      const result = runPrepare(fixture, version)

      expect(result.status).not.toBe(0)
      expect(result.outputs.release_sha).toBeUndefined()
    } finally { rmSync(fixture.root, { recursive: true, force: true }) }
  })

  for (const extraContent of [false, true]) {
    test(`#given a merged release with ${extraContent ? "additional" : "identical"} content #when selecting publication source #then ${extraContent ? "publication is refused" : "the stamping commit is selected"}`, () => {
      const fixture = createFixture()
      try {
        const { stamp, merge } = mergedRelease(fixture, "9.9.9-beta.5", extraContent)

        const result = runMergedSelection(fixture, stamp, merge)

        if (extraContent) {
          expect(result.status).not.toBe(0)
          expect(result.output).not.toContain("release_sha=")
        } else {
          expect(result.status).toBe(0)
          expect(result.output).toContain(`release_sha=${stamp}\n`)
          expect(result.output).not.toContain(`release_sha=${merge}\n`)
        }
      } finally { rmSync(fixture.root, { recursive: true, force: true }) }
    })
  }
})

/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type CommitName, createGitOrigin, type GitOrigin } from "./fixtures/publish-gate-reuse-origin"

/**
 * Release contract: a publish run dispatched with prepared_release_sha (the provenance-safe child) owns its
 * release tag. The parent pushes the tag before it dispatches the child, but a child dispatched directly (a
 * branch ref, the ci_basis_receipt waiver) has none, and `gh release create` without --target would let GitHub
 * create the missing tag from the default branch head. Executes the shipped steps against a real git origin
 * with `gh` and `bun` stubbed as bash functions: the tag-prepared-source job, which every publishing job waits
 * for, tags the prepared SHA or refuses a tag that points elsewhere, and the release step targets the prepared
 * SHA and refuses a foreign tag.
 */

const TAG_JOB = "tag-prepared-source"
const TAG_STEP = { job: TAG_JOB, name: "Tag prepared release source" } as const
const PLATFORM_WORKFLOW = "./.github/workflows/publish-platform.yml"
const RELEASE_STEP = { job: "release", name: "Create GitHub release" } as const
const VERSION = "9.9.9"
const TEST_TIMEOUT_MS = process.platform === "win32" ? 60_000 : 20_000

interface Step {
  readonly name?: string
  readonly run?: string
  readonly env?: Record<string, string>
}

interface Job {
  readonly needs?: string | string[]
  readonly if?: string
  readonly uses?: string
  readonly steps?: Step[]
}

const workflow = Bun.YAML.parse(
  readFileSync(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n"),
) as { jobs: Record<string, Job> }

function stepsOf(job: string): Step[] {
  return workflow.jobs[job]?.steps ?? []
}

function needsOf(job: string): string[] {
  const needs = workflow.jobs[job]?.needs ?? []
  return typeof needs === "string" ? [needs] : [...needs]
}

/** Every job `job` waits for, directly or through another job. */
function upstreamOf(job: string): Set<string> {
  const seen = new Set<string>()
  const pending = needsOf(job)
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (seen.has(next)) continue
    seen.add(next)
    pending.push(...needsOf(next))
  }
  return seen
}

/** Jobs that put a package on npm: an `npm publish` step, or the reusable platform publish. */
const PUBLISHERS = Object.entries(workflow.jobs)
  .filter(([, job]) => job.uses === PLATFORM_WORKFLOW || (job.steps ?? []).some((s) => s.run?.includes("npm publish")))
  .map(([name]) => name)

function step(where: { readonly job: string; readonly name: string }): Step & { readonly run: string } {
  const found = stepsOf(where.job).find((candidate) => candidate.name === where.name)
  if (!found?.run) throw new Error(`${where.job} has no runnable step named ${where.name}`)
  return { ...found, run: found.run }
}

const STUBS = [
  "gh() {",
  '  printf "%s\\n" "$*" >> "$GH_CALLS"',
  '  case "$1 $2" in',
  '    "release list") printf "v1.0.0\\n" ;;',
  '    "release view") return 1 ;;',
  "  esac",
  "}",
  'bun() { cat >/dev/null; printf "%s\\n" "--latest=false"; }',
  "",
].join("\n")

const scratch: string[] = []
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function git(fixture: GitOrigin, cwd: string, args: readonly string[]): string {
  const result = spawnSync("git", args, { cwd, env: fixture.gitEnv, encoding: "utf8" })
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`)
  return result.stdout.trim()
}

interface Run {
  readonly where: { readonly job: string; readonly name: string }
  readonly prepared: CommitName
  /** Tag name -> commit the origin already carries before the step runs. */
  readonly originTags?: Readonly<Record<string, CommitName>>
  readonly lazycodexOnly?: boolean
}

interface Outcome {
  readonly status: number
  readonly output: string
  readonly ghCalls: string
  readonly sha: GitOrigin["sha"]
  /** The commit the origin's tag points at after the step, or "" when the origin has no such tag. */
  readonly originTag: (tag: string) => string
}

/**
 * Like the job: its own origin (tags are origin state, so no case sees another's), a checkout of the prepared
 * SHA after `git fetch --force --tags`, then the step's script.
 */
function runStep(input: Run): Outcome {
  const root = mkdtempSync(join(tmpdir(), "publish-release-tag-"))
  scratch.push(root)
  const fixture = createGitOrigin(root)
  const checkout = join(root, "checkout")
  fixture.initCheckout(checkout)
  git(fixture, checkout, ["fetch", "-q", "origin"])
  for (const [tag, name] of Object.entries(input.originTags ?? {})) {
    git(fixture, checkout, ["push", "-q", "origin", `${fixture.sha[name]}:refs/tags/${tag}`])
  }
  const prepared = fixture.sha[input.prepared]
  git(fixture, checkout, ["checkout", "-q", "--detach", prepared])
  git(fixture, checkout, ["fetch", "-q", "--force", "--tags"])
  const script = join(root, "step.sh")
  const ghCalls = join(root, "gh-calls")
  writeFileSync(script, STUBS + step(input.where).run)
  writeFileSync(ghCalls, "")
  writeFileSync(join(root, "output"), "")
  writeFileSync(join(root, "summary"), "")
  const result = spawnSync("bash", ["-eo", "pipefail", script], {
    cwd: checkout,
    encoding: "utf8",
    timeout: TEST_TIMEOUT_MS - 1_000,
    env: {
      ...fixture.gitEnv,
      GH_CALLS: ghCalls,
      GITHUB_OUTPUT: join(root, "output"),
      GITHUB_STEP_SUMMARY: join(root, "summary"),
      VERSION,
      DIST_TAG: "",
      RELEASE_SHA: prepared,
      LAZYCODEX_ONLY: input.lazycodexOnly ? "true" : "false",
    },
  })
  if (result.error) throw result.error
  return {
    status: result.status ?? -1,
    output: `${result.stdout}${result.stderr}`,
    ghCalls: readFileSync(ghCalls, "utf8"),
    sha: fixture.sha,
    originTag: (tag) => git(fixture, checkout, ["ls-remote", "origin", `refs/tags/${tag}`]).split(/\s+/)[0] ?? "",
  }
}

describe("publish.yml child path release tag", () => {
  test("#given both steps #then they read the prepared release SHA from the dispatch input", () => {
    for (const where of [TAG_STEP, RELEASE_STEP]) {
      expect({ ...where, sha: step(where).env?.RELEASE_SHA }).toEqual({
        ...where,
        sha: "${{ inputs.prepared_release_sha }}",
      })
    }
  })

  test("#given every job that publishes a package #then it waits for the tag job and runs only after it succeeded", () => {
    expect(PUBLISHERS).toEqual(expect.arrayContaining(["publish-platform", "publish-main"]))
    for (const publisher of PUBLISHERS) {
      expect({ publisher, waitsForTag: upstreamOf(publisher).has(TAG_JOB) }).toEqual({ publisher, waitsForTag: true })
      expect({ publisher, tagJobPublishes: upstreamOf(TAG_JOB).has(publisher) }).toEqual({
        publisher,
        tagJobPublishes: false,
      })
    }
    for (const [name, job] of Object.entries(workflow.jobs).filter(([name]) => needsOf(name).includes(TAG_JOB))) {
      expect({ name, gate: job.if?.includes(`needs.${TAG_JOB}.result == 'success'`) }).toEqual({ name, gate: true })
    }
  })

  test("#given the workflow #then exactly one step tags the prepared source", () => {
    const tagSteps = Object.entries(workflow.jobs).flatMap(([name, job]) =>
      (job.steps ?? []).filter((s) => s.name === TAG_STEP.name).map(() => name),
    )
    expect(tagSteps).toEqual([TAG_JOB])
  })

  test.each([
    ["an omo release", false, `v${VERSION}`],
    ["a LazyCodex-only release", true, `lazycodex-v${VERSION}`],
  ] as const)(
    "#given %s with no tag on the origin #when the tag job runs #then the tag is pushed at the prepared SHA",
    (_label, lazycodexOnly, tag) => {
      const outcome = runStep({ where: TAG_STEP, prepared: "B", lazycodexOnly })
      expect(outcome.status).toBe(0)
      expect(outcome.originTag(tag)).toBe(outcome.sha.B)
    },
    TEST_TIMEOUT_MS,
  )

  test(
    "#given the parent already pushed the tag at the prepared SHA #when the tag job runs #then it accepts it unchanged",
    () => {
      const outcome = runStep({ where: TAG_STEP, prepared: "B", originTags: { [`v${VERSION}`]: "B" } })
      expect(outcome.status).toBe(0)
      expect(outcome.originTag(`v${VERSION}`)).toBe(outcome.sha.B)
    },
    TEST_TIMEOUT_MS,
  )

  test.each([TAG_STEP, RELEASE_STEP])(
    "#given the release tag points at another commit #when $job runs $name #then it refuses and creates nothing",
    (where) => {
      const outcome = runStep({ where, prepared: "B", originTags: { [`v${VERSION}`]: "A" } })
      expect(outcome.status).not.toBe(0)
      expect(outcome.output).toContain(
        `::error::Existing tag v${VERSION} points to ${outcome.sha.A}, not prepared release SHA ${outcome.sha.B}.`,
      )
      expect(outcome.originTag(`v${VERSION}`)).toBe(outcome.sha.A)
      expect(outcome.ghCalls).not.toContain("release create")
    },
    TEST_TIMEOUT_MS,
  )

  test.each([
    ["the tag the tag job pushed", { [`v${VERSION}`]: "B" }],
    ["no tag yet", {}],
  ] as const)(
    "#given %s #when the release step creates the release #then it targets the prepared SHA",
    (_label, originTags) => {
      const outcome = runStep({ where: RELEASE_STEP, prepared: "B", originTags })
      expect(outcome.status).toBe(0)
      const create = outcome.ghCalls.split("\n").find((line) => line.startsWith("release create "))
      expect(create?.split(" ")).toEqual(expect.arrayContaining([`v${VERSION}`, "--notes-file", "/tmp/changelog.md"]))
      expect(create).toContain(`--target ${outcome.sha.B}`)
    },
    TEST_TIMEOUT_MS,
  )
})

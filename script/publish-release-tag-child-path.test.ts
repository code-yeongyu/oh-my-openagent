/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type CommitName, createGitOrigin, type GitOrigin } from "./fixtures/publish-gate-reuse-origin"
import {
  needsOf,
  PRE_TAG_WRITERS,
  publishersOf,
  type Step,
  upstreamOf,
  type Workflow,
} from "./fixtures/publish-workflow-graph"

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
const RELEASE_STEP = { job: "release", name: "Create GitHub release" } as const
const VERSION = "9.9.9"
const TEST_TIMEOUT_MS = process.platform === "win32" ? 60_000 : 20_000

const workflow = Bun.YAML.parse(
  readFileSync(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n"),
) as Workflow

function stepsOf(job: string): readonly Step[] {
  return workflow.jobs[job]?.steps ?? []
}

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

  test("#given every job that publishes #then it waits for the tag job and runs only after it succeeded", () => {
    const { publishers, unclassified } = publishersOf(workflow)
    expect(unclassified).toEqual([])
    expect(publishers).toEqual(expect.arrayContaining(["publish-platform", "publish-main", "release"]))
    const beforeTag = publishers.filter((name) => name !== TAG_JOB && !upstreamOf(workflow, name).has(TAG_JOB))
    expect(beforeTag.sort()).toEqual(Object.keys(PRE_TAG_WRITERS).sort())
    for (const publisher of publishers.filter((name) => !(name in PRE_TAG_WRITERS))) {
      expect({ publisher, tagJobWaitsForIt: upstreamOf(workflow, TAG_JOB).has(publisher) }).toEqual({
        publisher,
        tagJobWaitsForIt: false,
      })
    }
    for (const [name, job] of Object.entries(workflow.jobs).filter(([name]) =>
      needsOf(workflow, name).includes(TAG_JOB),
    )) {
      expect({ name, gate: job.if?.includes(`needs.${TAG_JOB}.result == 'success'`) }).toEqual({ name, gate: true })
    }
  })

  test.each(Object.keys(PRE_TAG_WRITERS))(
    "#given the pre-tag writer %s #then its guard keeps every write off the child run",
    (name) => {
      const guard = PRE_TAG_WRITERS[name]?.guard
      expect({ name, guard: typeof guard }).toEqual({ name, guard: "string" })
      const writes = stepsOf(name).filter(
        (s) => publishersOf({ jobs: { probe: { steps: [s] } } }).publishers.length > 0,
      )
      expect(writes.length).toBeGreaterThan(0)
      for (const write of writes) {
        const guarded = [workflow.jobs[name]?.if, write.if].some(
          (condition) => guard !== undefined && condition?.includes(guard),
        )
        expect({ name, step: write.name, guarded }).toEqual({ name, step: write.name, guarded: true })
      }
    },
  )

  test("#given a child run #when prepare-release-state generates #then it hands back the prepared SHA and pushes nothing", () => {
    const root = mkdtempSync(join(tmpdir(), "publish-prepare-child-"))
    scratch.push(root)
    const output = join(root, "output")
    writeFileSync(output, "")
    const sha = "0123456789abcdef0123456789abcdef01234567"
    const run = step({ job: "prepare-release-state", name: "Prepare release state (generation)" }).run
    const result = spawnSync("bash", ["-eo", "pipefail", "-c", run], {
      cwd: root,
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", GITHUB_OUTPUT: output, GITHUB_SHA: sha, PREPARED_RELEASE_SHA: sha, VERSION },
    })
    expect(result.status).toBe(0)
    expect(readFileSync(output, "utf8").split("\n")).toEqual(
      expect.arrayContaining([`release_sha=${sha}`, "needs_push=false"]),
    )
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

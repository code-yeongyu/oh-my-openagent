/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CI_YML_PATH, ciJobs, type Validation, YQ_TO_JSON } from "./fixtures/publish-ci-validation"
import { type CommitName, createGitOrigin, type GitOrigin, runReleaseBash } from "./fixtures/publish-gate-reuse-origin"
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
const DISPATCH_STEP = {
  job: "dispatch-provenance-safe-publish",
  name: "Tag prepared source and dispatch provenance-safe publish",
} as const
const PRE_PUSH = { job: "prepare-release-state", name: "Publish prepared release state" } as const
const VERIFY_STAMP = "Verify pinned stamp before pushing"
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

function runThroughReleaseBranchPush(): string {
  const job = stepsOf(PRE_PUSH.job)
  const push = step(PRE_PUSH).run
  const beforePush = job.slice(
    0,
    job.findIndex((candidate) => candidate.name === PRE_PUSH.name),
  )
  const proof = beforePush.find((candidate) => candidate.name === VERIFY_STAMP)?.run ?? ":"
  const end = push.indexOf("\nretry_gh()")
  if (end < 0) throw new Error("missing boundary after the release-state branch push")
  // Preserve the real push but never install credentials or leave the scratch origin.
  return `git() { if [ "$1 $2" != "remote set-url" ]; then command git "$@"; fi; }\n(\n${proof}\n)\n${push.slice(0, end)}`
}

const STUBS = [
  "gh() {",
  '  printf "%s\\n" "$*" >> "$GH_CALLS"',
  '  case "$1 $2" in',
  '    "api --method") printf \'{"workflow_runs":[{"id":42,"run_attempt":2,"event":"%s","head_sha":"%s","status":"completed","conclusion":"success"}]}\\n\' "$CI_EVENT" "$CI_HEAD" ;;',
  '    "api --paginate") [[ "$*" == *"/actions/runs/42/attempts/2/jobs?"* ]] && cat "$CI_JOBS" ;;',
  '    "api -H") [[ "$*" == *"/contents/.github/workflows/ci.yml?ref=$CI_HEAD" ]] && cat "$CI_YML" ;;',
  '    "release list") printf "v1.0.0\\n" ;;',
  '    "release view") return 1 ;;',
  "  esac",
  "}",
  'bun() { cat >/dev/null; printf "%s\\n" "--latest=false"; }',
  `yq() { if [ "$1" = -o=json ]; then ${YQ_TO_JSON}; return; fi; if [ "\${*: -1}" = "-" ]; then cat >/dev/null; fi; printf "%s\\n" "$PIN_SUPPORTED"; }`,
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
  readonly pin?: CommitName
  readonly pinSupported?: boolean
  readonly ciEvent?: "push" | "pull_request"
  readonly ciHead?: CommitName
  readonly validation?: Validation
  readonly independentProof?: "missing" | CommitName
}

interface Outcome {
  readonly status: number
  readonly output: string
  readonly ghCalls: string
  readonly sha: GitOrigin["sha"]
  /** The commit the origin's tag points at after the step, or "" when the origin has no such tag. */
  readonly originTag: (tag: string) => string
  readonly releaseBranch: string
}

/**
 * Like the job: its own origin (tags are origin state, so no case sees another's), a checkout of the prepared
 * SHA after `git fetch --force --tags`, then the step's script.
 */
function runStep(input: Run, seed?: GitOrigin): Outcome {
  const root = mkdtempSync(join(tmpdir(), "publish-release-tag-"))
  scratch.push(root)
  const fixture = createGitOrigin(root, seed)
  const checkout = join(root, "checkout")
  git(fixture, root, ["clone", "-q", "--no-checkout", fixture.origin, checkout])
  const originTags = Object.entries(input.originTags ?? {})
  for (const [tag, name] of originTags) {
    git(fixture, checkout, ["push", "-q", "origin", `${fixture.sha[name]}:refs/tags/${tag}`])
  }
  const prepared = fixture.sha[input.prepared]
  git(fixture, checkout, ["checkout", "-q", "--detach", prepared])
  if (originTags.length > 0) git(fixture, checkout, ["fetch", "-q", "--force", "--tags"])
  const script = join(root, "step.sh")
  const ghCalls = join(root, "gh-calls")
  writeFileSync(script, STUBS + (input.where === PRE_PUSH ? runThroughReleaseBranchPush() : step(input.where).run))
  writeFileSync(ghCalls, "")
  writeFileSync(join(root, "output"), "")
  writeFileSync(join(root, "ci-jobs.json"), ciJobs(input.validation))
  writeFileSync(join(root, "summary"), "")
  const result = runReleaseBash(root, script, {
    cwd: checkout,
    encoding: "utf8",
    timeout: TEST_TIMEOUT_MS - 1_000,
    env: {
      ...fixture.gitEnv,
      GH_CALLS: ghCalls,
      GITHUB_REPOSITORY: "test/repo",
      GITHUB_SHA: fixture.sha.A,
      CI_EVENT: input.ciEvent ?? "pull_request",
      CI_JOBS: join(root, "ci-jobs.json"),
      CI_YML: CI_YML_PATH,
      BUN_EXE: process.execPath,
      CI_HEAD: fixture.sha[input.ciHead ?? input.prepared],
      GITHUB_OUTPUT: join(root, "output"),
      GITHUB_STEP_SUMMARY: join(root, "summary"),
      VERSION,
      DIST_TAG: "",
      RELEASE_SHA: prepared,
      INDEPENDENT_CI_REQUIRED: String(input.independentProof !== undefined),
      EXACT_STAMP_CI:
        input.independentProof && input.independentProof !== "missing" ? fixture.sha[input.independentProof] : "",
      RELEASE_BRANCH: "refs/heads/release/test-source-state",
      GH_TOKEN: "",
      SOURCE_SHA: input.pin ? fixture.sha[input.pin] : "",
      PIN_SUPPORTED: String(input.pinSupported ?? true),
      BUMP: "patch",
      SKIP_PLATFORM: "false",
      PUBLISH_LAZYCODEX: "true",
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
    get releaseBranch() {
      return (
        git(fixture, checkout, ["ls-remote", "origin", "refs/heads/release/test-source-state"]).split(/\s+/)[0] ?? ""
      )
    },
  }
}

describe("publish.yml child path release tag", () => {
  test.each(["missing", "A", "C"] as const)(
    "child tagging requires independent proof for the exact tree (%s)",
    (proof) => {
      const result = runStep({ where: TAG_STEP, prepared: "C", independentProof: proof })
      expect(result.status === 0).toBe(proof === "C")
      expect(result.originTag(`v${VERSION}`)).toBe(proof === "C" ? result.sha.C : "")
    },
  )
  test.each([
    ["H", "HT"],
    ["O", "OT"],
  ] as const)("a legitimate historical pin %s is pushed and dispatched without exact stamp CI", (pin, prepared) => {
    const input = { prepared, pin, pinSupported: false }
    const prePush = runStep({ where: PRE_PUSH, ...input })
    const dispatched = runStep({ where: DISPATCH_STEP, ...input })
    expect(dispatched.status, dispatched.output).toBe(0)
    expect(dispatched.originTag(`v${VERSION}`)).toBe(dispatched.sha[prepared])
    expect(dispatched.ghCalls).toContain(`workflow run publish.yml --ref v${VERSION}`)
    expect(dispatched.ghCalls).not.toContain("api --method")
    expect(prePush.status, prePush.output).toBe(0)
    expect(prePush.releaseBranch).toBe(prePush.sha[prepared])
  })

  test("an unproved historical stamp cannot push the release branch or supply its own checker", () => {
    const input = { prepared: "HX", pin: "H", pinSupported: false } as const
    const prePush = runStep({ where: PRE_PUSH, ...input })
    expect(prePush.status).not.toBe(0)
    expect(prePush.output).toContain("Cannot prove pinned release stamp")
    expect(prePush.releaseBranch).toBe("")
    const dispatched = runStep({ where: DISPATCH_STEP, ...input })
    expect(dispatched.status).not.toBe(0)
    expect(dispatched.output).toContain("No exact push CI")
    expect(dispatched.originTag(`v${VERSION}`)).toBe("")
    expect(dispatched.ghCalls).not.toContain("workflow run")
  })

  test("a source-aware child with a path-only basis checker cannot push the release branch", () => {
    const result = runStep({ where: PRE_PUSH, prepared: "OT", pin: "O", pinSupported: true })
    expect(result.status).not.toBe(0)
    expect(result.output).toContain("The source-aware child cannot prove this stamp")
    expect(result.releaseBranch).toBe("")
  })

  test("a source-aware child cannot receive a non-stamp delta approved only by PR CI", () => {
    const result = runStep({ where: DISPATCH_STEP, prepared: "C", pin: "B" })
    expect(result.status).not.toBe(0)
    expect(result.output).toContain("No exact push CI")
    expect(result.originTag(`v${VERSION}`)).toBe("")
    expect(result.ghCalls).not.toContain("workflow run")
  })

  test("a reused historical stamp can dispatch with a completed push at the exact stamp", () => {
    const result = runStep({ where: DISPATCH_STEP, prepared: "HX", pin: "H", pinSupported: false, ciEvent: "push" })
    expect(result.status, result.output).toBe(0)
    expect(result.ghCalls).toContain(`head_sha=${result.sha.HX}`)
    expect(result.ghCalls).toContain("/actions/runs/42/attempts/2/jobs?")
    expect(result.originTag(`v${VERSION}`)).toBe(result.sha.HX)
    expect(result.ghCalls).toContain(`workflow run publish.yml --ref v${VERSION}`)
  })

  test.each(["skipped-job", "skipped-step"] as const)(
    "the parent dispatch fallback refuses a green exact push with %s",
    (validation) => {
      const result = runStep({ where: DISPATCH_STEP, prepared: "HX", pin: "H", ciEvent: "push", validation })
      expect(result.status).not.toBe(0)
      expect(result.ghCalls).toContain("/actions/runs/42/attempts/2/jobs?")
      expect(result.originTag(`v${VERSION}`)).toBe("")
      expect(result.ghCalls).not.toContain("workflow run")
    },
  )

  test("a legacy child can receive a tag for a non-stamp delta only with exact push CI", () => {
    const root = mkdtempSync(join(tmpdir(), "publish-release-tag-seed-"))
    scratch.push(root)
    const seed = createGitOrigin(root)
    for (const [ciEvent, ciHead, allowed] of [
      ["pull_request", "C", false],
      ["push", "B", false],
      ["push", "C", true],
    ] as const) {
      const result = runStep(
        { where: DISPATCH_STEP, prepared: "C", pin: "B", pinSupported: false, ciEvent, ciHead },
        seed,
      )
      expect(result.originTag(`v${VERSION}`)).toBe(allowed ? result.sha.C : "")
      expect(result.ghCalls.includes("workflow run")).toBe(allowed)
      expect(result.status === 0).toBe(allowed)
    }
  })
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

  test("#given a stamp on a different parent #when the parent dispatch runs #then no tag or child is created", () => {
    const result = runStep({ where: DISPATCH_STEP, prepared: "T", pin: "A" })
    expect(result.status).not.toBe(0)
    expect(result.originTag(`v${VERSION}`)).toBe("")
    expect(result.ghCalls).toBe("")
  })

  test.each([true, false])(
    "#given tag input support=%s #then dispatch passes only supported inputs at the stamp",
    (pinSupported) => {
      const result = runStep({ where: DISPATCH_STEP, prepared: "T", pin: "B", pinSupported })
      expect(result.status, result.output).toBe(0)
      expect(result.originTag(`v${VERSION}`)).toBe(result.sha.T)
      expect(result.ghCalls).toContain(`workflow run publish.yml --ref v${VERSION}`)
      expect(result.ghCalls.includes(`-f source_sha=${result.sha.B}`)).toBe(pinSupported)
      expect(result.ghCalls).toContain(`-f prepared_release_sha=${result.sha.T}`)
    },
  )

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

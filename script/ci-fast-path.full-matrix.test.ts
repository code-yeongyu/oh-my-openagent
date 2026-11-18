/// <reference types="bun-types" />

import { afterAll, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { load } from "js-yaml"

const classifierPath = new URL("./ci-fast-path.mjs", import.meta.url)
const ciWorkflowPath = new URL("../.github/workflows/ci.yml", import.meta.url)

const UBUNTU_OR_FULL_MATRIX = "(matrix.os == 'ubuntu-latest' || needs.ci-mode.outputs.full_matrix == 'true')"

interface FullMatrixMode {
  readonly generatedReleasePush: boolean
  readonly webOnly: boolean
  readonly runHeavy: boolean
  readonly fullMatrix: boolean
  readonly runtimeTouching: boolean
  readonly labelRefused: boolean
  readonly labelHonoredOverFileCap: boolean
}

interface ClassifyInput {
  readonly eventName: string
  readonly message?: string
  readonly changedPaths?: readonly string[]
  readonly diffAvailable?: boolean
  readonly mergeParents?: number
  readonly headRef?: string
  readonly labels?: readonly string[]
  readonly body?: string
  readonly changedFiles?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function classify(input: ClassifyInput): FullMatrixMode {
  const changedPaths = input.changedPaths ?? []
  const stdout = execFileSync(
    "node",
    [
      fileURLToPath(classifierPath),
      "--event",
      input.eventName,
      "--message",
      input.message ?? "chore: routine change",
      "--diff-available",
      String(input.diffAvailable ?? true),
      "--merge-parents",
      String(input.mergeParents ?? 1),
      "--head-ref",
      input.headRef ?? "",
      "--labels",
      JSON.stringify(input.labels ?? []),
      ...(input.body === undefined ? [] : ["--body-file", writeBody(input.body)]),
      ...(input.changedFiles === undefined ? [] : ["--changed-files", String(input.changedFiles)]),
    ],
    {
      encoding: "utf8",
      input: changedPaths.length === 0 ? "" : `${changedPaths.join("\0")}\0`,
    },
  )
  const parsed: unknown = JSON.parse(stdout)
  if (!isRecord(parsed)) throw new Error("classifier output must be an object")
  const generatedReleasePush = parsed["generatedReleasePush"]
  const webOnly = parsed["webOnly"]
  const runHeavy = parsed["runHeavy"]
  const fullMatrix = parsed["fullMatrix"]
  const runtimeTouching = parsed["runtimeTouching"]
  const labelRefused = parsed["labelRefused"]
  const labelHonoredOverFileCap = parsed["labelHonoredOverFileCap"]
  if (
    typeof labelHonoredOverFileCap !== "boolean" ||
    typeof labelRefused !== "boolean" ||
    typeof generatedReleasePush !== "boolean" ||
    typeof webOnly !== "boolean" ||
    typeof runHeavy !== "boolean" ||
    typeof fullMatrix !== "boolean" ||
    typeof runtimeTouching !== "boolean"
  ) {
    throw new Error("classifier output must contain boolean CI mode fields including fullMatrix")
  }
  return { generatedReleasePush, webOnly, runHeavy, fullMatrix, runtimeTouching, labelRefused, labelHonoredOverFileCap }
}

const bodyDir = mkdtempSync(join(tmpdir(), "ci-fast-path-body-"))
afterAll(() => rmSync(bodyDir, { recursive: true, force: true }))
let bodies = 0
function writeBody(body: string): string {
  const path = join(bodyDir, `body-${bodies++}.md`)
  writeFileSync(path, body)
  return path
}

function workflowJobs(): Record<string, unknown> {
  const parsed: unknown = load(readFileSync(ciWorkflowPath, "utf8"))
  if (!isRecord(parsed)) throw new Error("ci.yml must parse as an object")
  const jobs = parsed["jobs"]
  if (!isRecord(jobs)) throw new Error("ci.yml must define jobs")
  return jobs
}

function jobSteps(jobName: string): readonly Record<string, unknown>[] {
  const job = workflowJobs()[jobName]
  if (!isRecord(job)) throw new Error(`ci.yml must define ${jobName}`)
  const steps = job["steps"]
  if (!Array.isArray(steps)) throw new Error(`${jobName} must define steps`)
  return steps.filter(isRecord)
}

describe("full-matrix classification", () => {
  describe("#given a merge group instead of a pull request", () => {
    test.each([
      ["runtime", ["packages/utils/src/index.ts"], true],
      ["repository prose", ["README.md"], true],
      ["docs-only", ["docs/guide/installation.md"], true],
      ["web-only", ["packages/web/app/page.tsx"], true],
      ["unavailable diff", [], false],
    ])("#then %s always runs heavy validation on the full matrix", (_name, changedPaths, diffAvailable) => {
      const input = {
        message: "Merge pull request #6955 from code-yeongyu/release/v5.0.0-beta.8-source-state",
        changedPaths,
        diffAvailable,
        mergeParents: 2,
      }
      const queued = classify({ ...input, eventName: "merge_group" })
      expect(queued.runHeavy).toBe(true)
      expect(queued.fullMatrix).toBe(true)
      expect(queued.generatedReleasePush).toBe(false)
    })

    test.each(["docs/guide/installation.md", "packages/web/app/page.tsx"])(
      "#then a pull request touching only %s retains the fast path",
      (path) => {
        const mode = classify({ eventName: "pull_request", changedPaths: [path] })
        expect(mode.runHeavy).toBe(false)
        expect(mode.fullMatrix).toBe(false)
      },
    )

    test("#then only a generated-release push takes the release fast path", () => {
      const input = {
        message: "Merge pull request #6955 from code-yeongyu/release/v5.0.0-beta.8-source-state",
        changedPaths: ["package.json"],
        mergeParents: 2,
      }
      expect(classify({ ...input, eventName: "push" })).toEqual({
        generatedReleasePush: true,
        webOnly: false,
        runHeavy: false,
        fullMatrix: true,
        runtimeTouching: true,
        labelRefused: false,
        labelHonoredOverFileCap: false,
      })
      expect(classify({ ...input, message: "fix: normal push", eventName: "push" }).runHeavy).toBe(true)
      expect(classify({ ...input, eventName: "merge_group" }).runHeavy).toBe(true)
    })
  })

  describe("#given a push event", () => {
    test("#then the full matrix always runs", () => {
      // given / when
      const mode = classify({ eventName: "push", changedPaths: ["packages/utils/src/index.ts"] })

      // then
      expect(mode.fullMatrix).toBe(true)
    })
  })

  describe("#given a pull request that touches code a test can load", () => {
    test.each([
      ["a package source file (the #7676 shape)", "packages/omo-config-core/src/display/format-path.ts"],
      ["a prompt or skill shipped from a package src tree", "packages/omo-opencode/src/agents/prompts/README.md"],
      ["a package test outside src", "packages/memory-core/test/store.test.ts"],
      ["a skill payload outside src", "packages/shared-skills/skills/frontend/SKILL.md"],
      ["a root script", "script/build.ts"],
      ["the root manifest", "package.json"],
      ["the lockfile", "bun.lock"],
      ["a root bunfig", "bunfig.root.toml"],
      ["the root test preload", "test-setup.ts"],
      ["an unrecognized top-level folder", "newtool/config.json"],
      ["an unusual extension at the root", "pipeline.weird"],
      ["a script named like a doc", "script/agents.ts"],
      ["a doc-like name with an unknown extension", "packages/utils/README.rst"],
      ["an unlisted .github file", ".github/CODEOWNERS"],
      ["an in-process senpi-task runner", "packages/senpi-task/src/runners/in-process.ts"],
      ["a Codex plugin source file", "packages/omo-codex/plugin/src/index.ts"],
      ["an omo-opencode hook", "packages/omo-opencode/src/hooks/session-start.ts"],
    ])("#then %s runs heavy validation on ubuntu only", (_name, changedPath) => {
      // given / when
      const mode = classify({
        eventName: "pull_request",
        headRef: "feature/runtime-change",
        changedPaths: ["README.md", changedPath],
      })

      // then
      expect(mode.runtimeTouching).toBe(true)
      expect(mode.fullMatrix).toBe(false)
      expect(mode.runHeavy).toBe(true)
    })
  })

  describe("#given a pull request that touches only documentation or repository metadata", () => {
    test.each([
      ["root prose", ["README.md", "README.ko.md", "ROADMAP.md"]],
      ["the changelog files", ["CHANGELOG.md", "changes.md"]],
      ["package docs outside src", ["packages/utils/README.md", "packages/omo-codex/AGENTS.md"]],
      ["another workflow and an issue template", [".github/workflows/stats.yml", ".github/ISSUE_TEMPLATE/bug.yml"]],
    ])("#then %s keeps the ubuntu-only fast path", (_name, changedPaths) => {
      // given / when
      const mode = classify({ eventName: "pull_request", headRef: "feature/tidy-docs", changedPaths })

      // then
      expect(mode.runtimeTouching).toBe(false)
      expect(mode.fullMatrix).toBe(false)
      expect(mode.runHeavy).toBe(true)
    })

    test("#then a docs-site-only change skips heavy work everywhere", () => {
      // given / when
      const mode = classify({
        eventName: "pull_request",
        headRef: "feature/tidy-docs",
        changedPaths: ["docs/guide/installation.md"],
      })

      // then
      expect(mode.runtimeTouching).toBe(false)
      expect(mode.fullMatrix).toBe(false)
      expect(mode.runHeavy).toBe(false)
    })
  })

  describe("#given a release-state head branch", () => {
    test.each(["release/v5.0.0-source-state", "release/v5.0.0-beta.11-source-state"])(
      "#then %s forces the full matrix",
      (headRef) => {
        // given / when
        const mode = classify({
          eventName: "pull_request",
          headRef,
          changedPaths: ["package.json"],
        })

        // then
        expect(mode.fullMatrix).toBe(true)
      },
    )
  })

  // The label costs macOS/Windows runners, so it is honored only when the diff touches a platform path or the PR body
  // carries an explicit 'Platform-reason: <text>' line (#13802 follow-up). Anything else is refused, never guessed.
  describe("#given the opt-in label", () => {
    const labelled = { eventName: "pull_request", headRef: "feature/runtime-change", labels: ["bug", "ci:full-matrix"] }

    test("#then it is refused on a diff with no platform path and no Platform-reason line", () => {
      const mode = classify({ ...labelled, changedPaths: ["changes.md", "script/foo.test.ts", "script/map.json"] })
      expect(mode.fullMatrix).toBe(false)
      expect(mode.labelRefused).toBe(true)
      expect(mode.runHeavy).toBe(true)
    })

    test("#then a body that only mentions platforms is not a reason", () => {
      const mode = classify({
        ...labelled,
        changedPaths: ["packages/utils/src/index.ts"],
        body: "This could affect Windows and macOS.\nplatform-reason: lower case is not the syntax",
      })
      expect(mode.labelRefused).toBe(true)
      expect(mode.fullMatrix).toBe(false)
    })

    test("#then a diff that cannot be fully listed honors the label (fails toward the full matrix)", () => {
      const mode = classify({ ...labelled, changedPaths: ["packages/utils/src/index.ts"], diffAvailable: false })
      expect(mode.fullMatrix).toBe(true)
      expect(mode.labelRefused).toBe(false)
    })

    // The pulls/files API lists at most 3000 files, so every caller decides the same way above that (#13891).
    test("#then a pull request over the API file cap honors the label even when its listed paths are complete", () => {
      const mode = classify({ ...labelled, changedPaths: ["packages/utils/src/index.ts"], changedFiles: 3500 })
      expect(mode.fullMatrix).toBe(true)
      expect(mode.labelRefused).toBe(false)
    })

    // The workflow's truncation warning reads this field, so the cap lives in one place (#13903 review).
    test.each([
      [3000, false],
      [3001, true],
    ])("#then %i changed files report labelHonoredOverFileCap %p", (changedFiles, overCap) => {
      const mode = classify({ ...labelled, changedPaths: ["packages/utils/src/index.ts"], changedFiles })
      expect(mode.labelHonoredOverFileCap).toBe(overCap)
      expect(mode.labelRefused).toBe(!overCap)
    })

    test("#then an unlabelled pull request over the cap reports no label honored", () => {
      const mode = classify({
        eventName: "pull_request",
        headRef: "feature/runtime-change",
        changedPaths: ["packages/utils/src/index.ts"],
        labels: [],
        changedFiles: 3500,
      })
      expect(mode.labelHonoredOverFileCap).toBe(false)
      expect(mode.fullMatrix).toBe(false)
    })

    test("#then it runs the full matrix when the diff touches a platform path", () => {
      const mode = classify({
        ...labelled,
        changedPaths: ["README.md", "crates/omo-computer-backend-win32/src/lib.rs"],
      })
      expect(mode.fullMatrix).toBe(true)
      expect(mode.labelRefused).toBe(false)
    })

    test("#then it runs the full matrix when the body carries a Platform-reason line", () => {
      const mode = classify({
        ...labelled,
        changedPaths: ["packages/utils/src/index.ts"],
        body: "Summary\n\nPlatform-reason: path handling differs on Windows drive letters\n",
      })
      expect(mode.fullMatrix).toBe(true)
      expect(mode.labelRefused).toBe(false)
    })

    test("#then a release source-state pull request keeps the full matrix and its label is not reported refused", () => {
      const mode = classify({ ...labelled, headRef: "release/v5.2.0-source-state", changedPaths: ["package.json"] })
      expect(mode.fullMatrix).toBe(true)
      expect(mode.labelRefused).toBe(false)
    })

    // run-full-ci was a second name for the label; one opt-in label is the contract (#13802).
    test.each(["run-full-ci", "bug"])("#then %s alone keeps the pull request on Linux without a refusal", (label) => {
      const mode = classify({
        eventName: "pull_request",
        headRef: "feature/runtime-change",
        changedPaths: ["crates/x/src/lib.rs"],
        labels: [label],
      })
      expect(mode.fullMatrix).toBe(false)
      expect(mode.labelRefused).toBe(false)
    })
  })

  // Pull requests run Linux only (#13802): no changed path selects macOS/Windows any more. These are the
  // paths the retired platform rule matched, led by the ones that put 70 of 74 measured PR runs on the full
  // matrix. The post-merge push to dev runs every OS for them.
  describe("#given a path the retired platform rule matched", () => {
    test.each([
      ["a native crate source", "crates/omo-computer-backend-fake/src/lib.rs"],
      ["the Cargo lockfile", "Cargo.lock"],
      ["the native launcher package", "packages/omo-native/bin/lib/service-auth.generated.js"],
      ["a QA script named for an OS", "script/qa/computer/pool/macos-vm-ops.ts"],
      ["basename contains windows", "packages/senpi-task/src/runners/rpc-process.windows.test.ts"],
      ["powershell script", "script/qa/run-smoke.ps1"],
      ["ci workflow", ".github/workflows/ci.yml"],
      ["classifier itself", "script/ci-fast-path.mjs"],
      ["a CI helper script the legs run", ".github/scripts/write-job-summary.sh"],
      ["a windows platform package", "packages/oh-my-opencode-windows-x64/package.json"],
      ["the launcher platform detection", "bin/platform.js"],
      ["the Codex installer source", "packages/omo-codex/src/install/codex-agent-config.ts"],
    ])("#then %s runs heavy validation on Linux only", (_name, changedPath) => {
      // given / when
      const mode = classify({
        eventName: "pull_request",
        headRef: "feature/tidy-docs",
        changedPaths: ["README.md", changedPath],
      })

      // then
      expect(mode.fullMatrix).toBe(false)
      expect(mode.runHeavy).toBe(true)
    })
  })

  describe("#given the diff is unavailable on a pull request", () => {
    test("#then heavy validation still runs, on Linux only", () => {
      // given / when
      const mode = classify({
        eventName: "pull_request",
        headRef: "feature/tidy-docs",
        diffAvailable: false,
      })

      // then
      expect(mode.runHeavy).toBe(true)
      expect(mode.fullMatrix).toBe(false)
    })
  })
})

describe("full-matrix workflow wiring", () => {
  describe("#given the ci-mode job", () => {
    test("#then it exposes full_matrix and feeds head ref plus labels to the classifier", () => {
      // given
      const ciMode = workflowJobs()["ci-mode"]
      if (!isRecord(ciMode)) throw new Error("ci.yml must define ci-mode")
      const outputs = ciMode["outputs"]
      if (!isRecord(outputs)) throw new Error("ci-mode must declare outputs")
      const classifyStep = jobSteps("ci-mode").find((step) => step["id"] === "classify")
      if (classifyStep === undefined) throw new Error("ci-mode must define the classify step")
      const env = classifyStep["env"]
      if (!isRecord(env)) throw new Error("classify step must define env")

      // then
      expect(String(outputs["full_matrix"])).toContain("steps.classify.outputs.full_matrix")
      expect(String(env["HEAD_REF"])).toContain("github.head_ref")
      expect(String(env["PR_LABELS"])).toContain("github.event.pull_request.labels")
      expect(String(classifyStep["run"])).toContain("--head-ref")
      expect(String(classifyStep["run"])).toContain("--labels")
    })
  })

  describe("#given the pull_request trigger", () => {
    test("#then normal CI leaves label events to the separate full-matrix caller", () => {
      // given
      const parsed: unknown = load(readFileSync(ciWorkflowPath, "utf8"))
      if (!isRecord(parsed)) throw new Error("ci.yml must parse as an object")
      const triggers = parsed["on"] ?? parsed[true as unknown as string]
      if (!isRecord(triggers)) throw new Error("ci.yml must define triggers")
      const pullRequest = triggers["pull_request"]
      if (!isRecord(pullRequest)) throw new Error("ci.yml must define pull_request triggers")

      // then
      expect(pullRequest["types"]).toEqual(["opened", "synchronize", "reopened"])
      expect(triggers).toHaveProperty("workflow_call")
    })
  })

  describe("#given the OS matrix jobs", () => {
    test.each(["test", "codex-compatibility", "senpi-compatibility"])(
      "#then every heavy step in %s is ubuntu-first",
      (jobName) => {
        // given
        const heavySteps = jobSteps(jobName).filter((step) => String(step["if"] ?? "").includes("run_heavy"))

        // then
        expect(heavySteps.length).toBeGreaterThan(0)
        for (const step of heavySteps) {
          const condition = String(step["if"])
          const ubuntuFirst =
            condition.includes(UBUNTU_OR_FULL_MATRIX) ||
            // A step already pinned to ubuntu can never reach a non-ubuntu leg.
            condition.includes("matrix.os == 'ubuntu-latest' &&") ||
            condition.endsWith("matrix.os == 'ubuntu-latest'")
          expect({ step: step["name"] ?? step["uses"], ubuntuFirst }).toEqual({
            step: step["name"] ?? step["uses"],
            ubuntuFirst: true,
          })
        }
      },
    )

    test.each(["test", "codex-compatibility", "senpi-compatibility"])(
      "#then checkout and summary steps in %s stay unconditional",
      (jobName) => {
        // given
        const steps = jobSteps(jobName)
        const checkout = steps.find((step) => String(step["uses"] ?? "").startsWith("actions/checkout"))
        const summary = steps.find((step) => step["name"] === "Write job summary")
        if (checkout === undefined || summary === undefined) {
          throw new Error(`${jobName} must define checkout and summary steps`)
        }

        // then
        expect(checkout["if"]).toBeUndefined()
        expect(String(summary["if"])).toBe("always()")
      },
    )
  })
})

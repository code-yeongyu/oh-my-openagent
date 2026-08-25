/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { load } from "js-yaml"

const classifierPath = new URL("./ci-fast-path.mjs", import.meta.url)
const ciWorkflowPath = new URL("../.github/workflows/ci.yml", import.meta.url)

const UBUNTU_OR_FULL_MATRIX =
  "(matrix.os == 'ubuntu-latest' || needs.ci-mode.outputs.full_matrix == 'true')"

interface FullMatrixMode {
  readonly generatedReleasePush: boolean
  readonly webOnly: boolean
  readonly runHeavy: boolean
  readonly fullMatrix: boolean
}

interface ClassifyInput {
  readonly eventName: string
  readonly message?: string
  readonly changedPaths?: readonly string[]
  readonly diffAvailable?: boolean
  readonly mergeParents?: number
  readonly headRef?: string
  readonly labels?: readonly string[]
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
  if (
    typeof generatedReleasePush !== "boolean" ||
    typeof webOnly !== "boolean" ||
    typeof runHeavy !== "boolean" ||
    typeof fullMatrix !== "boolean"
  ) {
    throw new Error("classifier output must contain boolean CI mode fields including fullMatrix")
  }
  return { generatedReleasePush, webOnly, runHeavy, fullMatrix }
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
  describe("#given a push event", () => {
    test("#then the full matrix always runs", () => {
      // given / when
      const mode = classify({ eventName: "push", changedPaths: ["packages/utils/src/index.ts"] })

      // then
      expect(mode.fullMatrix).toBe(true)
    })
  })

  describe("#given an ordinary pull request touching platform-neutral paths", () => {
    test("#then the full matrix is skipped", () => {
      // given / when
      const mode = classify({
        eventName: "pull_request",
        headRef: "feature/tidy-docs",
        changedPaths: ["packages/utils/src/index.ts", "packages/model-core/src/index.ts"],
      })

      // then
      expect(mode.fullMatrix).toBe(false)
      expect(mode.runHeavy).toBe(true)
    })
  })

  describe("#given a release-state head branch", () => {
    test.each([
      "release/v5.0.0-source-state",
      "release/v5.0.0-beta.11-source-state",
    ])("#then %s forces the full matrix", (headRef) => {
      // given / when
      const mode = classify({
        eventName: "pull_request",
        headRef,
        changedPaths: ["package.json"],
      })

      // then
      expect(mode.fullMatrix).toBe(true)
    })
  })

  describe("#given the ci:full-matrix label", () => {
    test("#then the full matrix is forced on an otherwise neutral pull request", () => {
      // given / when
      const mode = classify({
        eventName: "pull_request",
        headRef: "feature/tidy-docs",
        changedPaths: ["packages/utils/src/index.ts"],
        labels: ["bug", "ci:full-matrix"],
      })

      // then
      expect(mode.fullMatrix).toBe(true)
    })
  })

  describe("#given a platform-sensitive changed path", () => {
    test.each([
      ["basename contains windows", "packages/senpi-task/src/runners/rpc-process.windows.test.ts"],
      ["basename contains win32", "packages/utils/src/spawn-win32.ts"],
      ["powershell script", "script/qa/run-smoke.ps1"],
      ["ci workflow", ".github/workflows/ci.yml"],
      ["classifier itself", "script/ci-fast-path.mjs"],
      ["windows shard bunfig", "bunfig.win2.parallel.toml"],
    ])("#then %s forces the full matrix", (_name, changedPath) => {
      // given / when
      const mode = classify({
        eventName: "pull_request",
        headRef: "feature/tidy-docs",
        changedPaths: ["packages/utils/src/index.ts", changedPath],
      })

      // then
      expect(mode.fullMatrix).toBe(true)
    })
  })

  describe("#given the diff is unavailable", () => {
    test("#then the classifier fails open to the full matrix", () => {
      // given / when
      const mode = classify({
        eventName: "pull_request",
        headRef: "feature/tidy-docs",
        diffAvailable: false,
      })

      // then
      expect(mode.fullMatrix).toBe(true)
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
    test("#then labeled events retrigger CI", () => {
      // given
      const parsed: unknown = load(readFileSync(ciWorkflowPath, "utf8"))
      if (!isRecord(parsed)) throw new Error("ci.yml must parse as an object")
      const triggers = parsed["on"] ?? parsed[true as unknown as string]
      if (!isRecord(triggers)) throw new Error("ci.yml must define triggers")
      const pullRequest = triggers["pull_request"]
      if (!isRecord(pullRequest)) throw new Error("ci.yml must define pull_request triggers")

      // then
      expect(pullRequest["types"]).toEqual(["opened", "synchronize", "reopened", "labeled"])
    })
  })

  describe("#given the OS matrix jobs", () => {
    test.each(["test", "codex-compatibility", "senpi-compatibility"])(
      "#then every heavy step in %s is ubuntu-first",
      (jobName) => {
        // given
        const heavySteps = jobSteps(jobName).filter((step) =>
          String(step["if"] ?? "").includes("run_heavy"),
        )

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

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
  readonly runtimeTouching: boolean
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
  const runtimeTouching = parsed["runtimeTouching"]
  if (
    typeof generatedReleasePush !== "boolean" ||
    typeof webOnly !== "boolean" ||
    typeof runHeavy !== "boolean" ||
    typeof fullMatrix !== "boolean" ||
    typeof runtimeTouching !== "boolean"
  ) {
    throw new Error("classifier output must contain boolean CI mode fields including fullMatrix")
  }
  return { generatedReleasePush, webOnly, runHeavy, fullMatrix, runtimeTouching }
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

  describe("#given a pull request that touches code a test can load but no platform-specific path", () => {
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

  describe("#given a full-matrix label", () => {
    test.each(["ci:full-matrix", "run-full-ci"])("#then %s forces the full matrix on a runtime pull request", (label) => {
      // given / when
      const mode = classify({
        eventName: "pull_request",
        headRef: "feature/runtime-change",
        changedPaths: ["packages/utils/src/index.ts"],
        labels: ["bug", label],
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
      ["windows-only shard-2 remainder bunfig", "bunfig.win2.parallel.windows.toml"],
      ["windows rpc-host panic retry runner", "script/bun-panic-retry.ts"],
      ["shared serial quarantine", "script/root-test-serial-quarantine.ts"],
      ["reply-listener process identity (win32 branch)", "packages/openclaw-core/src/reply-listener-process.ts"],
      ["the label-triggered full-matrix workflow", ".github/workflows/ci-full-matrix-label.yml"],
      ["the platform package publish workflow", ".github/workflows/publish-platform.yml"],
      ["a CI helper script the legs run", ".github/scripts/write-job-summary.sh"],
      ["a native crate source", "crates/senpi-desktop-engine/src/lib.rs"],
      ["the Cargo workspace manifest", "Cargo.toml"],
      ["the Cargo lockfile", "Cargo.lock"],
      ["the Rust toolchain pin", "rust-toolchain.toml"],
      ["the native launcher package", "packages/omo-native/compile-entry.ts"],
      ["a darwin platform package", "packages/oh-my-opencode-darwin-arm64/package.json"],
      ["a windows platform package", "packages/oh-my-opencode-windows-x64/package.json"],
      ["the platform binary postinstall", "postinstall.mjs"],
      ["the standalone binary builder", "script/build-omo-binary.ts"],
      ["the native payload builder", "script/build-omo-native.ts"],
      ["the native parity smoke", "script/qa/omo-native-parity-smoke.mjs"],
      ["a macOS desktop QA script", "script/qa/desktop/macos/run.sh"],
      ["a Codex local installer script", "packages/omo-codex/scripts/install-local.mjs"],
      ["a platform-suffixed test", "packages/omo-opencode/src/cli/cli-installer.platform.test.ts"],
      ["the launcher platform detection", "bin/platform.js"],
      ["the launcher entry", "bin/oh-my-opencode.js"],
      ["the platform launcher package generator", "script/build-binaries.ts"],
      ["the Windows Git Bash runtime", "packages/git-bash-mcp/src/index.ts"],
      ["the Codex installer source", "packages/omo-codex/src/install/codex-agent-config.ts"],
      ["a Codex platform smoke test", "packages/omo-codex/plugin/test/node-install-surface.test.mjs"],
      ["the other Codex platform smoke test", "packages/omo-codex/plugin/test/install-time-build-runtime.test.mjs"],
      ["a composite action the legs could use", ".github/actions/setup/action.yml"],
      ["the senpi-task RPC host the Windows shard isolates", "packages/senpi-task/src/runners/rpc-host/host.ts"],
      ["the senpi-task RPC child process", "packages/senpi-task/src/runners/rpc-process.ts"],
      ["the senpi-task record lock", "packages/senpi-task/src/store/record-lock.ts"],
      ["basename contains darwin", "packages/utils/src/open-darwin.ts"],
      ["basename contains macos", "script/macos-signing-workflow.test.ts"],
    ])("#then %s forces the full matrix", (_name, changedPath) => {
      // given / when
      const mode = classify({
        eventName: "pull_request",
        headRef: "feature/tidy-docs",
        changedPaths: ["README.md", changedPath],
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

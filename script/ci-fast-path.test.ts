/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { load } from "js-yaml"

const classifierPath = new URL("./ci-fast-path.mjs", import.meta.url)
const ciWorkflowPath = new URL("../.github/workflows/ci.yml", import.meta.url)
const webWorkflowPath = new URL("../.github/workflows/web-ci.yml", import.meta.url)

interface CiMode {
  readonly generatedReleasePush: boolean
  readonly webOnly: boolean
  readonly runHeavy: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseWorkflow(path: URL): Record<string, unknown> {
  const parsed: unknown = load(readFileSync(path, "utf8"))
  if (!isRecord(parsed)) throw new Error(`${path.pathname} must parse as an object`)
  return parsed
}

function workflowJobs(path: URL): Record<string, unknown> {
  const jobs = parseWorkflow(path)["jobs"]
  if (!isRecord(jobs)) throw new Error(`${path.pathname} must define jobs`)
  return jobs
}

function classify(
  eventName: string,
  message: string,
  changedPaths: readonly string[],
  diffAvailable = true,
  mergeParents = 2,
): CiMode | undefined {
  if (!existsSync(classifierPath)) return undefined
  const pathInput = changedPaths.length === 0 ? "" : `${changedPaths.join("\0")}\0`
  const stdout = execFileSync(
    "node",
    [
      fileURLToPath(classifierPath),
      "--event",
      eventName,
      "--message",
      message,
      "--diff-available",
      String(diffAvailable),
      "--merge-parents",
      String(mergeParents),
    ],
    { encoding: "utf8", input: pathInput },
  )
  const parsed: unknown = JSON.parse(stdout)
  if (!isRecord(parsed)) throw new Error("classifier output must be an object")
  const generatedReleasePush = parsed["generatedReleasePush"]
  const webOnly = parsed["webOnly"]
  const runHeavy = parsed["runHeavy"]
  if (
    typeof generatedReleasePush !== "boolean" ||
    typeof webOnly !== "boolean" ||
    typeof runHeavy !== "boolean"
  ) {
    throw new Error("classifier output must contain boolean CI mode fields")
  }
  return { generatedReleasePush, webOnly, runHeavy }
}

describe("CI fast-path classifier", () => {
  test("ships the classifier consumed by CI", () => {
    expect(existsSync(classifierPath)).toBe(true)
  })

  test.each([
    {
      name: "release-state pull request",
      event: "pull_request",
      message: "release: v5.0.0-beta.8",
      paths: ["package.json"],
      expected: { generatedReleasePush: false, webOnly: false, runHeavy: true },
    },
    {
      name: "ordinary source push",
      event: "push",
      message: "fix(core): preserve validation",
      paths: ["packages/model-core/src/index.ts"],
      expected: { generatedReleasePush: false, webOnly: false, runHeavy: true },
    },
    {
      name: "generated release merge push",
      event: "push",
      message: "Merge pull request #6955 from code-yeongyu/release/v5.0.0-beta.8-source-state",
      paths: ["package.json", "bun.lock"],
      expected: { generatedReleasePush: true, webOnly: false, runHeavy: false },
    },
    {
      name: "direct release commit",
      event: "push",
      message: "release: v5.0.0-beta.8",
      paths: ["package.json"],
      expected: { generatedReleasePush: false, webOnly: false, runHeavy: true },
    },
    {
      name: "web-only pull request",
      event: "pull_request",
      message: "feat(web): update landing page",
      paths: ["packages/web/app/page.tsx", "docs/guide/install.md"],
      expected: { generatedReleasePush: false, webOnly: true, runHeavy: false },
    },
    {
      name: "mixed web and root change",
      event: "pull_request",
      message: "feat: update web and runtime",
      paths: ["packages/web/app/page.tsx", "packages/model-core/src/index.ts"],
      expected: { generatedReleasePush: false, webOnly: false, runHeavy: true },
    },
  ])("$name", ({ event, message, paths, expected }) => {
    expect(classify(event, message, paths)).toEqual(expected)
  })

  test("fails closed when a release-looking push is not a real merge commit", () => {
    const message = "Merge pull request #6955 from code-yeongyu/release/v5.0.0-beta.8-source-state"
    const mode = classify("push", message, ["package.json"], true, 1)
    expect(mode).toEqual({ generatedReleasePush: false, webOnly: false, runHeavy: true })
  })

  test("fails closed when a release-looking merge push has no available diff", () => {
    const message = "Merge pull request #6955 from code-yeongyu/release/v5.0.0-beta.8-source-state"
    const mode = classify("push", message, ["package.json"], false, 2)
    expect(mode).toEqual({ generatedReleasePush: false, webOnly: false, runHeavy: true })
  })

  test("fails closed when the diff is unavailable or empty", () => {
    expect(classify("push", "fix: unknown diff", [], false)).toEqual({
      generatedReleasePush: false,
      webOnly: false,
      runHeavy: true,
    })
    expect(classify("push", "fix: empty diff", [])).toEqual({
      generatedReleasePush: false,
      webOnly: false,
      runHeavy: true,
    })
  })
})

describe("CI fast-path workflow wiring", () => {
  test("preserves required job identities while gating expensive work", () => {
    const jobs = workflowJobs(ciWorkflowPath)
    const mode = jobs["ci-mode"]
    if (!isRecord(mode)) throw new Error("CI must define ci-mode")

    for (const jobName of [
      "test",
      "typecheck",
      "codex-compatibility",
      "senpi-compatibility",
      "lazycodex-published-smoke",
      "build",
      "omo-ai-payload-check",
    ]) {
      const job = jobs[jobName]
      if (!isRecord(job)) throw new Error(`CI must define ${jobName}`)
      expect(job["needs"]).toContain("ci-mode")
    }
  })

  test("keeps schema generation on master and skips duplicate draft generation", () => {
    const jobs = workflowJobs(ciWorkflowPath)
    const schema = jobs["auto-commit-schema"]
    const draft = jobs["draft-release"]
    if (!isRecord(schema) || !isRecord(draft)) throw new Error("CI write jobs must exist")

    expect(String(schema["if"])).toContain("refs/heads/master")
    expect(String(schema["if"])).not.toContain("run_heavy")
    expect(String(draft["if"])).toContain("needs.ci-mode.outputs.run_heavy == 'true'")
  })

  test("keeps the Web CI path contract aligned with classifier inputs", () => {
    const webWorkflow = parseWorkflow(webWorkflowPath)
    const triggers = webWorkflow["on"]
    if (!isRecord(triggers)) throw new Error("Web CI must define triggers")
    const pullRequest = triggers["pull_request"]
    if (!isRecord(pullRequest)) throw new Error("Web CI must define pull_request")

    expect(pullRequest["paths"]).toEqual([
      "packages/web/**",
      "docs/**",
      ".github/workflows/web-ci.yml",
    ])
  })
})

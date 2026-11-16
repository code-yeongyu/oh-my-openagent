/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { load } from "js-yaml"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error("workflow field must be an object")
  }
  return value
}

function workflow(name: string): Record<string, unknown> {
  return record(load(readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8")))
}

// GitHub Actions trigger and concurrency contracts protect required check runs.
describe("#given required CI and an optional full-matrix label run", () => {
  test("#then label runs are limited to the normal CI target branches", () => {
    // given / when
    const triggers = record(workflow("ci-full-matrix-label.yml")["on"])
    const pullRequest = record(triggers["pull_request"])

    // then
    expect(Object.keys(triggers)).toEqual(["pull_request"])
    expect(pullRequest["types"]).toEqual(["labeled"])
    expect(pullRequest["branches"]).toEqual(["dev", "master"])
  })

  test("#then the called workflow cannot share normal CI's workflow identity", () => {
    // given / when
    const ci = workflow("ci.yml")
    const caller = workflow("ci-full-matrix-label.yml")

    // then
    expect(typeof caller["name"]).toBe("string")
    expect(caller["name"]).not.toBe("CI")
    expect(caller["name"]).not.toBe(ci["name"])
  })

  test("#then unrelated labels cannot enter the full-matrix job's concurrency group", () => {
    // given / when
    const caller = workflow("ci-full-matrix-label.yml")
    const job = record(record(caller["jobs"])["full-matrix"])

    // then: GitHub evaluates the job gate before job-level concurrency.
    expect(caller["concurrency"]).toBeUndefined()
    expect(job["if"]).toBe("github.event.label.name == 'ci:full-matrix'")
    expect(job["uses"]).toBe("./.github/workflows/ci.yml")
    const concurrency = record(job["concurrency"])
    expect(concurrency["cancel-in-progress"]).toBe(true)
    expect(typeof concurrency["group"]).toBe("string")
    expect(String(concurrency["group"])).toContain("github.workflow")
    expect(String(concurrency["group"])).toContain("github.event.pull_request.number")
    expect(String(concurrency["group"])).not.toContain("github.ref")
  })

  test("#then a refused label fails fast on Linux before any macOS/Windows job is scheduled", () => {
    // given / when
    const jobs = record(workflow("ci-full-matrix-label.yml")["jobs"])
    const gate = record(jobs["gate"])
    const fullMatrix = record(jobs["full-matrix"])
    const decision = workflow("pr-platform-decision.yml")
    const decide = record(record(decision["jobs"])["decide"])
    const run = (decide["steps"] as unknown[])
      .map(record)
      .map((step) => String(step["run"] ?? ""))
      .join("\n")

    // then: the label gate is the shared platform decision, failing on a refusal before the reusable full matrix.
    expect(gate["uses"]).toBe("./.github/workflows/pr-platform-decision.yml")
    expect(record(gate["with"])["fail-on-refusal"]).toBe(true)
    expect(gate["if"]).toBe("github.event.label.name == 'ci:full-matrix'")
    expect(fullMatrix["needs"]).toBe("gate")
    expect(String(decide["runs-on"])).toStartWith("ubuntu-")
    expect(Number(decide["timeout-minutes"])).toBeLessThanOrEqual(5)
    expect(run).toContain("script/ci-fast-path.mjs")
    expect(run).toContain("--body-file")
    expect(run).toContain("labelRefused")
    expect(run).toContain("Platform-reason:")
    expect(run).toContain("GITHUB_EVENT_PATH")
  })

  // A step that runs a repository script needs the workspace: an earlier checkout must run whenever that step runs.
  test("#then the platform decision never runs a repository script without a checkout", () => {
    const decide = record(record(workflow("pr-platform-decision.yml")["jobs"])["decide"])
    const steps = (decide["steps"] as unknown[]).map(record)
    const checkout = steps.findIndex((step) => String(step["uses"] ?? "").startsWith("actions/checkout@"))
    expect(checkout).toBeGreaterThanOrEqual(0)
    expect(steps[checkout]?.["if"]).toBeUndefined()
    steps.forEach((step, index) => {
      if (/(^|\s)(bash \.github\/scripts\/|node script\/)/.test(String(step["run"] ?? ""))) {
        expect(index).toBeGreaterThan(checkout)
      }
    })
    // One boolean is not worth a full clone: the decision reads the PR's files from the API.
    expect(record(steps[checkout]?.["with"])["fetch-depth"]).toBeUndefined()
  })

  // Both callers of the classifier pass the event's file count, so they decide alike above the API cap (#13891).
  test("#then ci-mode and the platform decision both pass the pull request's changed-file count", () => {
    const steps = (job: Record<string, unknown>) =>
      (job["steps"] as unknown[])
        .map(record)
        .map((step) => String(step["run"] ?? ""))
        .join("\n")
    const ciMode = steps(record(record(workflow("ci.yml")["jobs"])["ci-mode"]))
    const decide = steps(record(record(workflow("pr-platform-decision.yml")["jobs"])["decide"]))
    for (const run of [ciMode, decide]) {
      expect(run).toContain("--changed-files")
      expect(run).toContain(".pull_request.changed_files")
    }
  })
})

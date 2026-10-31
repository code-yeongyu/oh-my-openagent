/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { load } from "js-yaml"

// Release and merge-gate contract (#11868): hosted CI runs on a pull request only for the run-full-ci /
// ci:full-matrix labels or a release-state head, whose own run publish.yml reuses (#9759). Pushes, merge groups
// and label-workflow calls run as before.

interface RunContext {
  readonly event: string
  readonly headRef: string
  readonly labels: readonly string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function ciJobs(): Record<string, Record<string, unknown>> {
  const parsed: unknown = load(readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"))
  if (!isRecord(parsed) || !isRecord(parsed["jobs"])) throw new Error("ci.yml must define jobs")
  const jobs: Record<string, Record<string, unknown>> = {}
  for (const [id, job] of Object.entries(parsed["jobs"])) {
    if (!isRecord(job)) throw new Error(`ci.yml job ${id} must be an object`)
    jobs[id] = job
  }
  return jobs
}

function needsOf(job: Record<string, unknown>): readonly string[] {
  const needs = job["needs"]
  if (needs === undefined) return []
  if (typeof needs === "string") return [needs]
  if (Array.isArray(needs)) return needs.map(String)
  throw new Error("needs must be a string or a list")
}

// Evaluates only the expression shapes the gate uses; any other github.* reference fails the test.
function evaluateGate(expression: string, run: RunContext): boolean {
  const js = expression
    .replace(/github\.event_name/g, "run.event")
    .replace(/startsWith\(github\.head_ref, ('[^']*')\)/g, "run.headRef.startsWith($1)")
    .replace(/contains\(github\.event\.pull_request\.labels\.\*\.name, ('[^']*')\)/g, "run.labels.includes($1)")
    .replace(/!=/g, "!==")
  expect(js).not.toMatch(/github\./)
  const result: unknown = Function("run", `return (${js});`)(run)
  if (typeof result !== "boolean") throw new Error(`gate evaluated to ${String(result)}`)
  return result
}

describe("#given the pull-request gate on ci.yml", () => {
  const jobs = ciJobs()
  const gate = String(jobs["ci-mode"]?.["if"])

  test("#then both root jobs share one gate", () => {
    expect(jobs["lint-ratchet"]?.["if"]).toBe(gate)
  })

  test.each<[string, RunContext, boolean]>([
    ["a dev push", { event: "push", headRef: "", labels: [] }, true],
    ["a merge group", { event: "merge_group", headRef: "", labels: [] }, true],
    ["an unlabelled feature PR", { event: "pull_request", headRef: "fix/thing", labels: [] }, false],
    ["a feature PR with an unrelated label", { event: "pull_request", headRef: "fix/thing", labels: ["bug"] }, false],
    ["a PR labelled run-full-ci", { event: "pull_request", headRef: "fix/thing", labels: ["run-full-ci"] }, true],
    ["a PR labelled ci:full-matrix", { event: "pull_request", headRef: "fix/thing", labels: ["ci:full-matrix"] }, true],
    ["the release-state PR", { event: "pull_request", headRef: "release/v5.1.52-source-state", labels: [] }, true],
  ])("#when %s #then the gate is %p", (_name, run, expected) => {
    expect(evaluateGate(gate, run)).toBe(expected)
  })

  test("#then no job but the PR target guard runs on a pull request outside the gate", () => {
    const gated = new Set(["lint-ratchet", "ci-mode"])
    for (const [id, job] of Object.entries(jobs)) {
      if (gated.has(id) || id === "block-master-pr") continue
      const needs = needsOf(job)
      expect(needs.some((name) => gated.has(name))).toBe(true)
      if (String(job["if"]).includes("always()")) {
        expect(String(job["if"])).toContain("needs.ci-mode.result != 'skipped'")
      }
    }
  })
})

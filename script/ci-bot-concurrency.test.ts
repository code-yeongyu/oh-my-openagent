/// <reference types="bun-types" />

// The PR bots (#13802 follow-up): every PR event starts PR Automation Signal, and each completed signal starts CLA
// Assistant and Review Claims through workflow_run. A newer event for the same PR must replace the older queued or
// running bot run, never a run for another PR, and never a CLA signing comment or a manual/scheduled run.

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { load } from "js-yaml"
import { evaluate, interpolate } from "../test-support/github-expression"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function concurrency(file: string): Record<string, unknown> {
  const parsed: unknown = load(readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), "utf8"))
  if (!isRecord(parsed) || !isRecord(parsed["concurrency"])) throw new Error(`${file} must define workflow concurrency`)
  return parsed["concurrency"]
}

function decide(file: string, github: Record<string, unknown>) {
  const settings = concurrency(file)
  return {
    group: interpolate(settings["group"], { github }),
    cancels: Boolean(evaluate(settings["cancel-in-progress"], { github })),
  }
}

const pullRequestEvent = (workflow: string, number: number, event = "pull_request", runId = 1) => ({
  workflow,
  event_name: event,
  run_id: runId,
  event: { pull_request: { number, head: { ref: `feature/${number}` } } },
})

const signalCompleted = (workflow: string, branch: string, runId: number, repo = "code-yeongyu/oh-my-openagent") => ({
  workflow,
  event_name: "workflow_run",
  run_id: runId,
  event: { workflow_run: { head_branch: branch, head_repository: { full_name: repo } } },
})

describe("#given PR Automation Signal", () => {
  test("#then a newer event for the same PR cancels the older run, and never a run for another PR", () => {
    const file = "pr-automation-signal.yml"
    const first = decide(file, pullRequestEvent("PR Automation Signal", 7, "pull_request", 1))
    const review = decide(file, pullRequestEvent("PR Automation Signal", 7, "pull_request_review", 2))
    const other = decide(file, pullRequestEvent("PR Automation Signal", 8, "pull_request", 3))
    expect(first.cancels).toBe(true)
    expect(review.group).toBe(first.group)
    expect(other.group).not.toBe(first.group)
  })
})

describe("#given the folded privileged consumer, PR Automation", () => {
  const file = "pr-automation.yml"
  const workflow = "PR Automation"

  test("#then a newer signal for the same PR head branch replaces the older run, never another PR's", () => {
    const older = decide(file, signalCompleted(workflow, "feature/7", 1))
    const newer = decide(file, signalCompleted(workflow, "feature/7", 2))
    const other = decide(file, signalCompleted(workflow, "feature/8", 3))
    const fork = decide(file, signalCompleted(workflow, "feature/7", 4, "contributor/oh-my-openagent"))
    expect(newer.cancels).toBe(true)
    expect(newer.group).toBe(older.group)
    expect(other.group).not.toBe(older.group)
    expect(fork.group).not.toBe(older.group)
  })

  test("#then a dispatched recheck keeps its own group and is never cancelled", () => {
    const one = decide(file, { workflow, event_name: "workflow_dispatch", run_id: 1, event: {} })
    const two = decide(file, { workflow, event_name: "workflow_dispatch", run_id: 2, event: {} })
    expect(one.cancels).toBe(false)
    expect(two.group).not.toBe(one.group)
  })
})

describe("#given the CLA signing path", () => {
  test("#then every comment-triggered run keeps its own group and is never cancelled", () => {
    const one = decide("cla.yml", { workflow: "CLA Assistant", event_name: "issue_comment", run_id: 1, event: {} })
    const two = decide("cla.yml", { workflow: "CLA Assistant", event_name: "issue_comment", run_id: 2, event: {} })
    expect(one.cancels).toBe(false)
    expect(two.group).not.toBe(one.group)
  })
})

describe.each(["review-claims.yml", "package-labels.yml"])("#given %s, which no longer runs per PR event", (file) => {
  test("#then it declares no workflow concurrency, so nothing cancels its sweep, gate or issue runs", () => {
    const parsed: unknown = load(readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), "utf8"))
    expect(isRecord(parsed) && parsed["concurrency"]).toBeFalsy()
  })
})

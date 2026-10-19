import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const workflow = name => Bun.YAML.parse(readFileSync(
  new URL(`../.github/workflows/${name}.yml`, import.meta.url), "utf8"))

function assertTrustedCheckouts(w) {
  for (const [name, job] of Object.entries(w.jobs)) {
    for (const step of job.steps ?? []) {
      if (!step.uses?.startsWith("actions/checkout@")) continue
      expect(step.with.repository).toBe("${{ github.repository }}")
      expect(step.with.ref).toBe(name === "gate"
        ? "${{ github.event.merge_group.base_sha }}" : "${{ github.workflow_sha }}")
      expect(step.with["persist-credentials"]).toBe(false)
    }
  }
}

test("all three privileged consumers use the same read-only signal", () => {
  for (const name of ["cla", "review-claims", "package-labels"]) {
    const w = workflow(name)
    expect(w.on.pull_request_target).toBeUndefined()
    expect(w.on.workflow_run).toEqual({
      workflows: ["PR Automation Signal"], types: ["completed"],
    })
    const steps = Object.values(w.jobs).flatMap(job => job.steps ?? [])
    expect(steps.some(step => step.uses?.startsWith("actions/download-artifact"))).toBe(false)
    assertTrustedCheckouts(w)
  }
})

test("the fork signal never executes PR code or obtains a write token", () => {
  const w = workflow("pr-automation-signal")
  expect(w.name).toBe("PR Automation Signal")
  expect(w.permissions).toEqual({ contents: "read" })
  expect(w.on.pull_request.types).toContain("labeled")
  expect(w.on.pull_request_review.types).toEqual(["submitted"])
  expect(w.jobs.signal.steps.some(step => step.uses)).toBe(false)
})

test("renamed checkouts cannot execute fork heads or fork repositories", () => {
  for (const mutation of [
    { ref: "${{ github.event.workflow_run.head_sha }}" },
    { repository: "${{ github.event.workflow_run.head_repository.full_name }}" },
  ]) {
    const w = workflow("cla")
    const step = w.jobs.cla.steps.find(step => step.uses?.startsWith("actions/checkout@"))
    step.name = "Check out helper"
    Object.assign(step.with, mutation)
    expect(() => assertTrustedCheckouts(w)).toThrow()
  }
})

test("PR review claims are owned only by the base workflow_run consumer", () => {
  const w = workflow("review-claims")
  expect(w.on.pull_request).toBeUndefined()
  expect(w.on.pull_request_review).toBeUndefined()
  expect(w.jobs["release-claim"]).toBeUndefined()
  expect(w.jobs.gate.if).toBe("github.event_name == 'merge_group'")
  expect(w.jobs.gate.permissions).toEqual({ contents: "read", "pull-requests": "read" })
  expect(w.jobs.gate.name).toBe("Review claim gate")
  expect(w.jobs.reconcile.if).toContain("github.event_name == 'workflow_run'")
})

test("CLA signing and administrator rechecks remain reachable", () => {
  const w = workflow("cla")
  expect(w.on.issue_comment.types).toEqual(["created"])
  expect(w.on.workflow_dispatch.inputs.pr_number.required).toBe(true)
  const action = w.jobs.cla.steps.find(step => step.uses?.startsWith("contributor-assistant/"))
  expect(action.with.branch).toBe("cla-signatures")
  expect(action.if).not.toContain("needs_cla_action")
  expect(action.if.trim().startsWith("github.event_name == 'issue_comment'")).toBe(true)
  expect(action.env.GITHUB_EVENT_PATH).toBeUndefined()
  expect(action.env.GITHUB_EVENT_NAME).toBeUndefined()
  expect(w.jobs.cla.steps.some(step => step.name === "Report CLA result on the current PR head")).toBe(true)
})

test("a cancelled or skipped signal never disappears silently", () => {
  for (const name of ["cla", "review-claims", "package-labels"]) {
    const w = workflow(name)
    const notice = w.jobs["notice-skipped-signal"]
    expect(notice).toBeDefined()
    expect(notice.if).toContain("github.event_name == 'workflow_run'")
    expect(notice.if).toContain("github.event.workflow_run.conclusion == 'cancelled'")
    expect(notice.if).toContain("github.event.workflow_run.conclusion == 'skipped'")
    expect(notice.permissions).toEqual({ "actions": "read" })
    expect((notice.steps ?? []).some(step => step.uses?.startsWith("actions/checkout"))).toBe(false)
    const script = notice.steps.find(step => step.uses?.startsWith("actions/github-script")).with.script
    expect(script).toContain("listWorkflowRuns")
    expect(script).toContain("workflow_id: 'pr-automation-signal.yml'")
    expect(script).toContain("core.warning")
    expect(script).toContain("head_sha: head")
  }
})

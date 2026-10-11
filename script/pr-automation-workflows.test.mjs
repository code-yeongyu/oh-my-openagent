import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const workflow = name => Bun.YAML.parse(readFileSync(
  new URL(`../.github/workflows/${name}.yml`, import.meta.url), "utf8"))

test("all three privileged consumers use the same read-only signal", () => {
  for (const name of ["cla", "review-claims", "package-labels"]) {
    const w = workflow(name)
    expect(w.on.pull_request_target).toBeUndefined()
    expect(w.on.workflow_run).toEqual({
      workflows: ["PR Automation Signal"], types: ["completed"],
    })
    const steps = Object.values(w.jobs).flatMap(job => job.steps ?? [])
    expect(steps.some(step => step.uses?.startsWith("actions/download-artifact"))).toBe(false)
    for (const step of steps.filter(step => step.name?.startsWith("Check out trusted"))) {
      expect(step.with.ref).toBe("${{ github.workflow_sha }}")
      expect(step.with["persist-credentials"]).toBe(false)
    }
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

test("the PR review gate is read-only and still listens to claim label changes", () => {
  const w = workflow("review-claims")
  expect(w.on.pull_request.types).toContain("labeled")
  expect(w.on.pull_request.types).toContain("unlabeled")
  expect(w.jobs.gate.permissions).toEqual({ contents: "read", "pull-requests": "read" })
  expect(w.jobs.gate.name).toBe("Review claim gate")
})

test("CLA signing and administrator rechecks remain reachable", () => {
  const w = workflow("cla")
  expect(w.on.issue_comment.types).toEqual(["created"])
  expect(w.on.workflow_dispatch.inputs.pr_number.required).toBe(true)
  const action = w.jobs.cla.steps.find(step => step.uses?.startsWith("contributor-assistant/"))
  expect(action.with.branch).toBe("cla-signatures")
  expect(action.env.GITHUB_EVENT_PATH).toContain("cla-pr-event.json")
  expect(w.jobs.cla.steps.some(step => step.name === "Report CLA result on the current PR head")).toBe(true)
})

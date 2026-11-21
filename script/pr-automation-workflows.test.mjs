import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { evaluate } from "../test-support/github-expression"

const workflow = (name) =>
  Bun.YAML.parse(readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), "utf8"))

const automation = () => workflow("pr-automation").jobs.automation

function assertTrustedCheckouts(w) {
  for (const [name, job] of Object.entries(w.jobs)) {
    for (const step of job.steps ?? []) {
      if (!step.uses?.startsWith("actions/checkout@")) continue
      expect(step.with.repository).toBe("${{ github.repository }}")
      expect(step.with.ref).toBe(
        name === "gate" ? "${{ github.event.merge_group.base_sha }}" : "${{ github.workflow_sha }}",
      )
      expect(step.with["persist-credentials"]).toBe(false)
    }
  }
}

test("one privileged consumer acts on the read-only signal; no PR bot runs on pull_request_target", () => {
  for (const name of ["cla", "review-claims", "package-labels", "pr-automation", "pr-automation-signal"]) {
    const w = workflow(name)
    expect(w.on.pull_request_target).toBeUndefined()
    const steps = Object.values(w.jobs).flatMap((job) => job.steps ?? [])
    expect(steps.some((step) => step.uses?.startsWith("actions/download-artifact"))).toBe(false)
    assertTrustedCheckouts(w)
  }
  expect(workflow("pr-automation").on.workflow_run).toEqual({
    workflows: ["PR Automation Signal"],
    types: ["completed"],
  })
  for (const name of ["cla", "review-claims", "package-labels"]) expect(workflow(name).on.workflow_run).toBeUndefined()
})

test("the fork signal never executes PR code or obtains a write token", () => {
  const w = workflow("pr-automation-signal")
  expect(w.name).toBe("PR Automation Signal")
  expect(w.permissions).toEqual({ contents: "read" })
  expect(w.on.pull_request.types).toContain("labeled")
  expect(w.on.pull_request_review.types).toEqual(["submitted"])
  expect(w.jobs.signal.steps.some((step) => step.uses)).toBe(false)
})

test("renamed checkouts cannot execute fork heads or fork repositories", () => {
  for (const mutation of [
    { ref: "${{ github.event.workflow_run.head_sha }}" },
    { repository: "${{ github.event.workflow_run.head_repository.full_name }}" },
  ]) {
    const w = workflow("pr-automation")
    const step = w.jobs.automation.steps.find((step) => step.uses?.startsWith("actions/checkout@"))
    step.name = "Check out helper"
    Object.assign(step.with, mutation)
    expect(() => assertTrustedCheckouts(w)).toThrow()
  }
})

test("PR review claims are reconciled only by the privileged consumer; the merge-group gate is unchanged", () => {
  const w = workflow("review-claims")
  expect(w.on.pull_request).toBeUndefined()
  expect(w.on.pull_request_review).toBeUndefined()
  expect(w.jobs.reconcile).toBeUndefined()
  expect(w.jobs.gate.if).toBe("github.event_name == 'merge_group'")
  expect(w.jobs.gate.permissions).toEqual({ contents: "read", "pull-requests": "read" })
  expect(w.jobs.gate.name).toBe("Review claim gate")
  expect(automation().steps.find((step) => step.id === "review_claims").with.script).toContain("reconcileReviewClaims")
})

test("CLA signing and administrator rechecks remain reachable", () => {
  const w = workflow("cla")
  expect(Object.keys(w.on)).toEqual(["issue_comment"])
  expect(w.on.issue_comment.types).toEqual(["created"])
  expect(workflow("pr-automation").on.workflow_dispatch.inputs.pr_number.required).toBe(true)
  const action = w.jobs.cla.steps.find((step) => step.uses?.startsWith("contributor-assistant/"))
  expect(action.with.branch).toBe("cla-signatures")
  expect(action.if).not.toContain("needs_cla_action")
  expect(action.if.trim().startsWith("github.event_name == 'issue_comment'")).toBe(true)
  expect(action.env.GITHUB_EVENT_PATH).toBeUndefined()
  expect(action.env.GITHUB_EVENT_NAME).toBeUndefined()
  expect(w.jobs.cla.steps.some((step) => step.name === "Report CLA result on the current PR head")).toBe(true)
})

test("a cancelled or skipped signal never disappears silently", () => {
  const notice = workflow("pr-automation").jobs["notice-skipped-signal"]
  expect(notice.if).toContain("github.event_name == 'workflow_run'")
  expect(notice.if).toContain("github.event.workflow_run.conclusion == 'cancelled'")
  expect(notice.if).toContain("github.event.workflow_run.conclusion == 'skipped'")
  expect(notice.permissions).toEqual({ actions: "read", "pull-requests": "read" })
  expect((notice.steps ?? []).some((step) => step.uses?.startsWith("actions/checkout"))).toBe(false)
  const script = notice.steps.find((step) => step.uses?.startsWith("actions/github-script")).with.script
  expect(script).toContain("listWorkflowRuns")
  expect(script).toContain("workflow_id: 'pr-automation-signal.yml'")
  expect(script).toContain("core.warning")
  expect(script).toContain("head_sha: head")
})

// Each part reports on its own head: an earlier part's failure must not skip a later part's check, and the job still
// fails. GitHub implies success() for a step without a status function, so every part must say always().
const PARTS = ["cla_state", "review_claims", "ensure_labels", "package_labels"]

test.each([
  ["cla_state", "failure"],
  ["review_claims", "failure"],
  ["ensure_labels", "failure"],
])("#given %s ended %s #then every later part and the cla report still run", (failed, outcome) => {
  const steps = automation().steps
  const outcomes = Object.fromEntries(PARTS.map((id) => [id, { outcome: id === failed ? outcome : "success" }]))
  const context = { github: {}, steps: { pr: { outcome: "success", outputs: { pr_number: "7" } }, ...outcomes } }
  const reporters = [...PARTS.slice(1), "Report CLA result on the current PR head"]
  for (const key of reporters) {
    const step = steps.find((step) => step.id === key || step.name === key)
    expect(String(step.if).startsWith("always()")).toBe(true)
    expect(evaluateStep(step.if, context)).toBe(true)
  }
  for (const id of PARTS) expect(steps.find((step) => step.id === id)["continue-on-error"]).toBe(true)
})

test.each([
  [["success", "success", "success", "success"], 0],
  [["failure", "success", "success", "success"], 1],
  [["success", "failure", "skipped", "success"], 1],
  [["success", "success", "success", "failure"], 1],
])("#given part outcomes %j #then the job exits %d", (outcomes, code) => {
  const step = automation().steps.find((step) => step.name === "Fail when any part failed")
  expect(step.if).toBe("always()")
  const parts = ["resolve=success", ...PARTS.map((id, index) => `${id}=${outcomes[index]}`)].join(" ")
  const run = spawnSync("bash", ["-c", step.run], { env: { ...process.env, PARTS: parts }, encoding: "utf8" })
  expect(run.status).toBe(code)
})

function evaluateStep(condition, { github, steps }) {
  return evaluate(String(condition), { github, needs: {}, matrix: {}, steps })
}

// A push cancels the signal of the head it replaced, so the notice must warn only when the skipped head is still the
// head of an open PR and no newer signal covers it.
test.each([
  ["a superseded head", "new-head", 0],
  ["a live head with no newer signal", "old-head", 1],
])("#given %s #then the skipped-signal notice warns only for a live head", async (_name, liveHead, warnings) => {
  const notice = workflow("pr-automation").jobs["notice-skipped-signal"]
  const script = notice.steps.find((step) => step.uses?.startsWith("actions/github-script")).with.script
  const warned = []
  const github = {
    rest: {
      actions: { listWorkflowRuns: async () => ({ data: { workflow_runs: [{ id: 10, run_number: 1 }] } }) },
      pulls: {
        list: async (args) => {
          expect(args).toMatchObject({ owner: "owner", repo: "project", state: "open", head: "owner:feature" })
          return { data: [{ number: 7, head: { sha: liveHead } }] }
        },
      },
    },
  }
  const context = {
    repo: { owner: "owner", repo: "project" },
    workflow: "PR Automation",
    payload: {
      workflow_run: {
        id: 10,
        head_sha: "old-head",
        head_branch: "feature",
        head_repository: { owner: { login: "owner" } },
      },
    },
  }
  const summary = { addHeading: () => summary, addRaw: () => summary, write: async () => {} }
  const core = { info() {}, warning: (message) => warned.push(message), summary }
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  await new AsyncFunction("github", "context", "core", script)(github, context, core)
  expect(warned).toHaveLength(warnings)
})

test("#given a signal from a deleted fork #then the notice warns instead of failing", async () => {
  const notice = workflow("pr-automation").jobs["notice-skipped-signal"]
  const script = notice.steps.find((step) => step.uses?.startsWith("actions/github-script")).with.script
  const warned = []
  const github = {
    rest: {
      actions: { listWorkflowRuns: async () => ({ data: { workflow_runs: [{ id: 10, run_number: 1 }] } }) },
      pulls: { list: async () => ({ data: [] }) },
    },
  }
  const context = {
    repo: { owner: "owner", repo: "project" },
    workflow: "PR Automation",
    payload: { workflow_run: { id: 10, head_sha: "old-head", head_branch: "feature", head_repository: null } },
  }
  const summary = { addHeading: () => summary, addRaw: () => summary, write: async () => {} }
  const core = { info() {}, warning: (message) => warned.push(message), summary }
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  await new AsyncFunction("github", "context", "core", script)(github, context, core)
  expect(warned).toHaveLength(1)
})

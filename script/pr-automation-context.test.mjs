import { expect, test } from "bun:test"
import { resolveAutomationPR, prepareCLAEvent } from "./pr-automation-context.mjs"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

function fixture() {
  const pr = {
    number: 42, state: "open", title: "$(exit 1)", body: "fork metadata",
    head: { sha: "abc", repo: { id: 2 } },
    base: { repo: { id: 1, full_name: "owner/project" } },
  }
  const run = {
    path: ".github/workflows/pr-automation-signal.yml",
    event: "pull_request", status: "completed", conclusion: "success",
    repository: { full_name: "owner/project" },
    head_repository: { id: 2, owner: { login: "fork-owner" } },
    head_branch: "feature", head_sha: "abc", pull_requests: [],
  }
  const requests = []
  const outputs = new Map()
  const github = {
    rest: {
      actions: { getWorkflowRun: async () => ({ data: run }) },
      pulls: {
        get: async () => ({ data: pr }),
        list: () => {},
      },
    },
    paginate: async (_method, args) => {
      requests.push(args)
      return [pr]
    },
  }
  const context = { repo: { owner: "owner", repo: "project" }, payload: { workflow_run: { id: 123 } } }
  const core = { info() {}, setOutput: (name, value) => outputs.set(name, value) }
  return { pr, run, requests, outputs, github, context, core }
}

test("fork runs with no associated PRs resolve through server metadata", async () => {
  const f = fixture()
  expect(await resolveAutomationPR(f)).toBe(f.pr)
  expect(f.requests).toEqual([{
    owner: "owner", repo: "project", state: "open", head: "fork-owner:feature", per_page: 100,
  }])
})

test("associated PRs still require an exact current head and fork repository", async () => {
  const f = fixture()
  f.run.pull_requests = [{ number: 42 }]
  f.pr.head.repo.id = 99
  expect(await resolveAutomationPR(f)).toBeUndefined()
  f.pr.head.repo.id = 2
  f.pr.head.sha = "new-head"
  expect(await resolveAutomationPR(f)).toBeUndefined()
})

test("closed and foreign-base PRs cannot receive writes", async () => {
  const f = fixture()
  f.pr.state = "closed"
  expect(await resolveAutomationPR(f)).toBeUndefined()
  f.pr.state = "open"
  f.pr.base.repo.full_name = "other/project"
  expect(await resolveAutomationPR(f)).toBeUndefined()
})

test("a forged workflow name does not replace exact path and event authority", async () => {
  const f = fixture()
  f.run.path = ".github/workflows/attacker.yml"
  await expect(resolveAutomationPR(f)).rejects.toThrow("Not a successful")
  f.run.path = ".github/workflows/pr-automation-signal.yml"
  f.run.event = "push"
  await expect(resolveAutomationPR(f)).rejects.toThrow("Not a successful")
})

test("unsuccessful and foreign-repository signals fail closed", async () => {
  const f = fixture()
  f.run.conclusion = "failure"
  await expect(resolveAutomationPR(f)).rejects.toThrow("Not a successful")
  f.run.conclusion = "success"
  f.run.repository.full_name = "other/project"
  await expect(resolveAutomationPR(f)).rejects.toThrow("Not a successful")
})

test("ambiguous associated PRs fail closed", async () => {
  const f = fixture()
  f.run.pull_requests = [{ number: 42 }, { number: 43 }]
  await expect(resolveAutomationPR(f)).rejects.toThrow("one current PR")
})

test("CLA adapter serializes API-derived PR metadata as data", async () => {
  const f = fixture()
  const dir = await mkdtemp(join(tmpdir(), "pr-automation-"))
  try {
    const eventPath = join(dir, "event.json")
    expect(await prepareCLAEvent({ ...f, eventPath })).toBe(f.pr)
    expect(JSON.parse(await readFile(eventPath, "utf8"))).toEqual({
      action: "synchronize", number: 42, pull_request: f.pr, repository: f.pr.base.repo,
    })
    expect(f.outputs.get("pr_number")).toBe(42)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

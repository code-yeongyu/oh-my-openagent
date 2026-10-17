import { expect, test } from "bun:test"
import { mkdtemp, rm, readFile } from "node:fs/promises"
import { readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const cla = Bun.YAML.parse(readFileSync(
  new URL("../.github/workflows/cla.yml", import.meta.url), "utf8"))
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

async function replay({ signed = false, allowlisted = false, existing = false, advanced = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "cla-replay-"))
  const oldEnv = { ...process.env }
  const outputs = new Map()
  const comments = []
  const checks = []
  const author = { login: allowlisted ? "code-yeongyu" : "unsigned-fork-contributor", id: 567 }
  const pr = {
    number: 42, state: "open", head: { sha: "fork-head", repo: { id: 2 } },
    base: { repo: { id: 1, full_name: "owner/project" } },
  }
  const run = {
    path: ".github/workflows/pr-automation-signal.yml", event: "pull_request",
    status: "completed", conclusion: "success", repository: pr.base.repo,
    head_repository: { id: 2, owner: { login: author.login } },
    head_branch: "contribution", head_sha: pr.head.sha, pull_requests: [],
  }
  const payload = { workflow_run: { id: 123 } }
  const context = { repo: { owner: "owner", repo: "project" }, eventName: "workflow_run", payload }
  let gets = 0
  const github = {
    rest: {
      actions: { getWorkflowRun: async () => ({ data: run }) },
      repos: { getContent: async () => ({ data: {
        type: "file", encoding: "base64",
        content: Buffer.from(JSON.stringify({ signedContributors: signed
          ? [{ id: author.id, name: author.login }] : [] })).toString("base64"),
      } }) },
      pulls: {
        get: async () => ({ data: advanced && ++gets > 1
          ? { ...pr, head: { ...pr.head, sha: "new-head" } } : pr }),
        listCommits() {},
        list() {},
      },
      issues: {
        listComments() {},
        createComment: async args => comments.push({ operation: "create", ...args }),
        updateComment: async args => comments.push({ operation: "update", ...args }),
      },
      checks: { create: async args => checks.push(args) },
    },
    paginate: async (method, args) => {
      if (method === github.rest.pulls.list) {
        expect(args).toMatchObject({ state: "open", head: `${author.login}:contribution` })
        return [pr]
      }
      if (method === github.rest.pulls.listCommits) return [{ author }]
      if (method === github.rest.issues.listComments) return existing ? [{
        id: 99, user: { login: "github-actions[bot]" },
        body: "All contributors have signed the CLA.<sub>Posted by the **CLA Assistant Lite bot**.</sub>",
      }] : []
      throw new Error("Unexpected paginated API")
    },
  }
  const core = {
    info() {}, setFailed: message => { throw new Error(message) },
    setOutput: (key, value) => outputs.set(key, String(value)),
  }
  try {
    process.env.GITHUB_WORKSPACE = fileURLToPath(new URL("..", import.meta.url))
    process.env.RUNNER_TEMP = dir
    // Real runner metadata stays workflow_run; no action env overrides are applied.
    process.env.GITHUB_EVENT_NAME = "workflow_run"
    process.env.GITHUB_EVENT_PATH = join(dir, "actual-workflow-run.json")
    const execute = async step => {
      await new AsyncFunction("github", "context", "core", step.with.script)(github, context, core)
    }
    await execute(cla.jobs.cla.steps.find(step => step.id === "pr"))
    expect(JSON.parse(await readFile(join(dir, "cla-pr-event.json"), "utf8")).number).toBe(42)
    await execute(cla.jobs.cla.steps.find(step => step.id === "cla_state"))
    process.env.PR_NUMBER = outputs.get("pr_number")
    process.env.EXPECTED_SHA = outputs.get("head_sha")
    process.env.RESULT = "success"
    process.env.UNSIGNED = outputs.get("needs_cla_action")
    await execute(cla.jobs.cla.steps.find(step => step.name === "Report CLA result on the current PR head"))
    return { comments, checks, outputs }
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key]
    Object.assign(process.env, oldEnv)
    await rm(dir, { recursive: true, force: true })
  }
}

test("an unsigned fork workflow_run delivers signing instructions and fails the exact-head CLA check", async () => {
  const result = await replay()
  expect(result.comments).toHaveLength(1)
  expect(result.comments[0]).toMatchObject({ operation: "create", owner: "owner", repo: "project", issue_number: 42 })
  expect(result.comments[0].body).toContain("I have read the CLA Document and I hereby sign the CLA")
  expect(result.comments[0].body).toContain("unsigned-fork-contributor")
  // The pinned action consumes this sentinel when adopting the instruction comment.
  expect(result.comments[0].body).toMatch(/CLA Assistant Lite bot/)
  expect(result.checks).toHaveLength(1)
  expect(result.checks[0]).toMatchObject({ name: "cla", head_sha: "fork-head", conclusion: "failure" })
})

test.each([{ signed: true }, { allowlisted: true }])("signed or allowlisted contributors pass without a signing request: %j", async options => {
  const result = await replay(options)
  expect(result.comments).toHaveLength(0)
  expect(result.checks[0].conclusion).toBe("success")
})

test("rechecks update the bot request rather than posting duplicate instructions", async () => {
  const result = await replay({ existing: true })
  expect(result.comments).toHaveLength(1)
  expect(result.comments[0]).toMatchObject({ operation: "update", comment_id: 99 })
  expect(result.checks[0].conclusion).toBe("failure")
})

test("a superseded head receives neither signing instructions nor a successful check", async () => {
  const result = await replay({ advanced: true })
  expect(result.comments).toHaveLength(0)
  expect(result.checks).toHaveLength(0)
})

import assert from "node:assert/strict"
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { createHash } from "node:crypto"

// Explicit integration test: supply a checkout of the action at v2.6.1.
// No network downloads or dependency installation are performed by this test.
const actionRoot = resolve(process.argv[2] ?? "")
assert.ok(process.argv[2], "Usage: bun .github/scripts/cla-first-signature-replay.mjs <action checkout>")
const git = Bun.spawn(["git", "-C", actionRoot, "rev-parse", "HEAD"], { stdout: "pipe", stderr: "pipe" })
const revision = (await new Response(git.stdout).text()).trim()
assert.equal(await git.exited, 0)
assert.equal(revision, "ca4a40a7d1004f18d9960b404b97e5f30a505a08")
const bundle = join(actionRoot, "dist/index.js")
const bundleHash = createHash("sha256").update(await readFile(bundle)).digest("hex")
assert.equal(bundleHash, "a44111084c0d4782206c04b4276292f7fec6d1f7a33525512fbeef3242079dfb")
const workflow = Bun.YAML.parse(await readFile(new URL("../workflows/cla.yml", import.meta.url), "utf8"))
const signatureStep = workflow.jobs.cla.steps.find(step => step.id === "cla_state")
const actionStep = workflow.jobs.cla.steps.find(step => step.uses?.startsWith("contributor-assistant/"))
const user = { login: "first-time-fork-contributor", id: 567, type: "User" }
const pr = { number: 42, state: "open", head: { sha: "fork-head", ref: "contribution" } }
const stored = { signedContributors: [] }
const comments = []
const writes = []
const unexpected = []
let createdByAction = 0
let updatedByAction = 0
const dir = await mkdtemp(join(tmpdir(), "cla-first-signature-"))
const oldRunnerTemp = process.env.RUNNER_TEMP
let server
try {
  process.env.RUNNER_TEMP = dir
  await writeFile(join(dir, "cla-pr-event.json"), JSON.stringify({ pull_request: pr }))
  const github = {
    rest: {
      repos: { getContent: async () => ({ data: {
        type: "file", encoding: "base64",
        content: Buffer.from(JSON.stringify(stored)).toString("base64"),
      } }) },
      pulls: { listCommits() {}, get: async () => ({ data: pr }) },
      issues: {
        listComments() {},
        createComment: async args => comments.push({
          id: 100, body: args.body, user: { login: "github-actions[bot]", id: 41898282 },
          created_at: "2026-10-11T00:00:00Z",
        }),
        updateComment: async () => { throw new Error("Initial request must not require a prior bot comment") },
      },
    },
    paginate: async method => {
      if (method === github.rest.pulls.listCommits) return [{ author: user }]
      if (method === github.rest.issues.listComments) return comments
      throw new Error("Unexpected trusted-step pagination")
    },
  }
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  await new AsyncFunction("github", "context", "core", signatureStep.with.script)(
    github, { repo: { owner: "owner", repo: "project" } },
    { setOutput() {}, info() {}, setFailed: message => { throw new Error(message) } },
  )
  assert.equal(comments.length, 1)
  comments.push({
    id: 101, body: actionStep.with["custom-pr-sign-comment"], user,
    created_at: "2026-10-11T00:01:00Z",
  })
  const eventPath = join(dir, "first-signature.json")
  await writeFile(eventPath, JSON.stringify({
    action: "created", issue: { number: 42, pull_request: { url: "unused" } },
    comment: comments[1], repository: { id: 1, full_name: "owner/project" }, sender: user,
  }))
  server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request) {
      const path = decodeURIComponent(new URL(request.url).pathname)
      const json = (data, init) => Response.json(data, init)
      if (path === "/graphql" && request.method === "POST") {
        const query = await request.json()
        assert.equal(query.variables.number, 42)
        return json({ data: { repository: { pullRequest: { commits: {
          totalCount: 1, edges: [{ node: { commit: {
            author: { user: { ...user, databaseId: user.id } },
            committer: { user: { ...user, databaseId: user.id } },
          } }, cursor: "one" }], pageInfo: { endCursor: "one", hasNextPage: false },
        } } } } })
      }
      if (path === "/repos/owner/project/contents/signatures/cla.json") {
        if (request.method === "GET") return json({
          type: "file", sha: "storage-sha", encoding: "base64",
          content: Buffer.from(JSON.stringify(stored)).toString("base64"),
        })
        if (request.method === "PUT") {
          const body = await request.json()
          assert.equal(body.branch, "cla-signatures")
          assert.equal(body.sha, "storage-sha")
          stored.signedContributors = JSON.parse(Buffer.from(body.content, "base64").toString()).signedContributors
          writes.push(body)
          return json({ content: { sha: "updated-storage-sha" }, commit: { sha: "signature-commit" } })
        }
      }
      if (path === "/repos/owner/project/issues/42/comments") {
        if (request.method === "GET") return json(comments)
        if (request.method === "POST") {
          createdByAction += 1
          const body = await request.json()
          return json({ id: 102, ...body })
        }
      }
      if (path === "/repos/owner/project/issues/comments/100" && request.method === "PATCH") {
        updatedByAction += 1
        comments[0].body = (await request.json()).body
        return json(comments[0])
      }
      if (path === "/repos/owner/project/pulls/42") return json(pr)
      if (path === "/repos/owner/project/actions/workflows") return json({
        total_count: 1, workflows: [{ id: 77, name: workflow.name }],
      })
      if (path === "/repos/owner/project/actions/workflows/77/runs") {
        return json({ total_count: 0, workflow_runs: [] })
      }
      unexpected.push(`${request.method} ${path}`)
      return json({ message: "Unexpected replay request" }, { status: 404 })
    },
  })
  const env = {
    PATH: process.env.PATH, GITHUB_TOKEN: "synthetic-replay-token",
    GITHUB_API_URL: server.url.origin, GITHUB_GRAPHQL_URL: `${server.url.origin}/graphql`,
    GITHUB_REPOSITORY: "owner/project", GITHUB_WORKFLOW: workflow.name,
    GITHUB_EVENT_NAME: "issue_comment", GITHUB_EVENT_PATH: eventPath,
    GITHUB_ACTOR: user.login, GITHUB_SHA: "fork-head", GITHUB_REF: "refs/heads/dev",
    "INPUT_USE-DCO-FLAG": "false", "INPUT_SUGGEST-RECHECK": "true",
  }
  for (const [name, value] of Object.entries(actionStep.with)) {
    env[`INPUT_${name.toUpperCase().replaceAll(" ", "_")}`] = String(value)
  }
  const child = Bun.spawn([process.execPath, bundle], {
    env, stdout: "pipe", stderr: "pipe", signal: AbortSignal.timeout(30_000),
  })
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ])
  console.log(JSON.stringify({ result: "OBSERVED", exit, firstSignatureWrites: writes.length,
    actionCommentsCreated: createdByAction, actionCommentsUpdated: updatedByAction }))
  assert.deepEqual(unexpected, [])
  assert.equal(exit, 0, `Real action failed: ${stdout}\n${stderr}`)
  assert.equal(writes.length, 1, "First signature must be persisted without recheck")
  assert.equal(createdByAction, 0, "Action must adopt the trusted request, not post a second request")
  assert.equal(updatedByAction, 1)
  assert.equal(stored.signedContributors.length, 1)
  assert.equal(stored.signedContributors[0].id, user.id)
  assert.equal(stored.signedContributors[0].comment_id, 101)
  assert.equal(stored.signedContributors[0].pullRequestNo, 42)
  console.log(JSON.stringify({ result: "PASS", revision, bundleHash, firstSignatureWrites: writes.length,
    actionCommentsCreated: createdByAction, actionCommentsUpdated: updatedByAction, recheckUsed: false }))
} finally {
  server?.stop(true)
  if (oldRunnerTemp === undefined) delete process.env.RUNNER_TEMP
  else process.env.RUNNER_TEMP = oldRunnerTemp
  await rm(dir, { recursive: true, force: true })
}

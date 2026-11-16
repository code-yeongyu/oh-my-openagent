// Replays the ai-attribution job of .github/workflows/cla.yml against a mocked GitHub API.
//
// The job holds the only parser in the CLA workflow: it reads untrusted contributor text (the PR
// body) and decides whether to write a bot-managed record under contents:write. A parser that
// silently stops matching would under-report forever, so the disclosure decision, the write, and
// the reported check conclusion are all asserted here.
import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const cla = Bun.YAML.parse(readFileSync(new URL("../.github/workflows/cla.yml", import.meta.url), "utf8"))
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

const job = cla.jobs["ai-attribution"]

function stepNamed(name) {
  const step = job.steps.find(candidate => candidate.name === name)
  if (!step) throw new Error(`missing ai-attribution step: ${name}`)
  return step
}

const resolveStep = stepNamed("Resolve AI-assistance disclosure")
const recordStep = stepNamed("Record the disclosure and report the ai-attribution check")

// A PR body fixture, not the shipped template: this asserts the parser's behavior on inputs, not
// the template's authored wording.
function body({ section = "AI Assistance", boxes = [], before = [], after = [] }) {
  return [
    "## Summary",
    "",
    "- tightened the resolver",
    "",
    ...before,
    `## ${section}`,
    "",
    "- [ ] none",
    "- [ ] pair-programming",
    "- [ ] fully AI-authored",
    ...boxes,
    "",
    ...after,
    "## Changes",
    "",
    "- one bullet",
    "",
  ].join("\n")
}

const pairTick = "- [x] pair-programming"
// The shipped template writes "fully AI-authored" with a space. The parser must accept it and
// store the hyphenated canonical value, or this option is silently unrecordable.
const fullTick = "- [x] fully AI-authored"
const noneTick = "- [x] none"
const notesSection = ["## Notes", "", pairTick]
const automationSection = ["## Automated Checks", "", fullTick]

async function replay({
  eventName = "workflow_run",
  prBody = body({}),
  declared = "",
  mode = "",
  existing,
  headSha = "fork-head",
  currentHeadSha = headSha,
  conflicts = 0,
  recordPathIsDirectory = false,
} = {}) {
  const dir = await mkdtemp(join(tmpdir(), "cla-ai-attribution-"))
  const oldEnv = { ...process.env }
  const outputs = new Map()
  const writes = []
  const checks = []
  const pr = {
    number: 42,
    state: "open",
    head: { sha: headSha, repo: { id: 2 } },
    base: { repo: { id: 1, full_name: "owner/project" } },
    user: { login: "fork-contributor" },
    body: prBody,
  }
  const signalRun = {
    path: ".github/workflows/pr-automation-signal.yml",
    event: "pull_request",
    status: "completed",
    conclusion: "success",
    repository: pr.base.repo,
    head_repository: { id: 2, owner: { login: "fork-contributor" } },
    head_branch: "contribution",
    head_sha: headSha,
    pull_requests: [],
  }
  const context = {
    repo: { owner: "owner", repo: "project" },
    eventName,
    payload: eventName === "issue_comment"
      ? { number: pr.number, pull_request: pr }
      : { workflow_run: { id: 7 } },
  }
  let remainingConflicts = conflicts
  const github = {
    rest: {
      actions: { getWorkflowRun: async () => ({ data: signalRun }) },
      repos: {
        getContent: async () => {
          if (recordPathIsDirectory) return { data: [{ type: "file", name: "ai-attribution.json" }] }
          if (existing === undefined) {
            const missing = new Error("Not Found")
            missing.status = 404
            throw missing
          }
          return {
            data: {
              type: "file",
              encoding: "base64",
              sha: "record-sha",
              content: Buffer.from(JSON.stringify(existing)).toString("base64"),
            },
          }
        },
        createOrUpdateFileContents: async args => {
          if (remainingConflicts > 0) {
            remainingConflicts -= 1
            const conflict = new Error("is at 1111 but expected 2222")
            conflict.status = 409
            throw conflict
          }
          writes.push(args)
          return { data: {} }
        },
      },
      pulls: {
        get: async () => ({ data: { ...pr, head: { ...pr.head, sha: currentHeadSha } } }),
        list: async () => ({ data: [] }),
        listCommits: () => {},
      },
      checks: { create: async args => { checks.push(args); return { data: {} } } },
    },
    paginate: async method => {
      if (method === github.rest.pulls.list) return [pr]
      throw new Error("Unexpected paginated API")
    },
  }
  const core = {
    info() {},
    warning() {},
    setFailed: message => { throw new Error(message) },
    setOutput: (key, value) => outputs.set(key, String(value)),
  }
  const execute = async step => new AsyncFunction("github", "context", "core", step.with.script)(github, context, core)

  try {
    await writeFile(
      join(dir, "ai-attribution-pr-event.json"),
      JSON.stringify({ action: "synchronize", number: pr.number, pull_request: pr, repository: pr.base.repo }),
      { mode: 0o600 },
    )
    Object.assign(process.env, {
      RUNNER_TEMP: dir,
      DECLARED: declared,
      MODE: mode,
      PR_NUMBER: String(pr.number),
      EXPECTED_SHA: eventName === "issue_comment" ? "" : headSha,
    })

    await execute(resolveStep)
    Object.assign(process.env, {
      VALUE: outputs.get("value") ?? "",
      SOURCE: outputs.get("source") ?? "",
      MODE: outputs.get("mode") ?? "advisory",
    })
    await execute(recordStep)

    return {
      outputs: Object.fromEntries(outputs),
      writes,
      checks,
      recorded: writes.map(write => JSON.parse(Buffer.from(write.content, "base64").toString("utf8"))),
    }
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key]
    Object.assign(process.env, oldEnv)
    await rm(dir, { recursive: true, force: true })
  }
}

describe("CLA ai-attribution disclosure", () => {
  test("#given a ticked pair-programming box #when the job runs on a signal #then it records the disclosure from the PR body", async () => {
    const result = await replay({ prBody: body({ boxes: [pairTick] }) })

    expect(result.outputs).toMatchObject({
      pr_number: "42",
      value: "pair-programming",
      source: "pr-body",
      mode: "advisory",
    })
    expect(result.writes).toHaveLength(1)
    expect(result.writes[0]).toMatchObject({
      path: "signatures/ai-attribution.json",
      branch: "cla-signatures",
      message: "record AI-assistance disclosure for #42 (pair-programming)",
    })
    // The record branch has no such file yet, so there is no blob sha to update against.
    expect(result.writes[0].sha).toBeUndefined()
    expect(result.recorded[0].disclosures).toHaveLength(1)
    expect(result.recorded[0].disclosures[0]).toMatchObject({
      pullRequest: 42,
      headSha: "fork-head",
      author: "fork-contributor",
      value: "pair-programming",
      source: "pr-body",
    })
    expect(result.checks).toHaveLength(1)
    expect(result.checks[0]).toMatchObject({ name: "ai-attribution", head_sha: "fork-head", conclusion: "success" })
    expect(result.checks[0].output.title).toBe("AI assistance: pair-programming")
  })

  test("#given an untouched disclosure section #when the job runs #then nothing is written and the advisory check is neutral", async () => {
    const result = await replay()

    expect(result.outputs.value).toBe("none-recorded")
    expect(result.writes).toHaveLength(0)
    expect(result.checks).toHaveLength(1)
    expect(result.checks[0].conclusion).toBe("neutral")
    expect(result.checks[0].output.title).toBe("AI assistance: not disclosed (advisory)")
  })

  test("#given an untouched disclosure section #when a maintainer requires disclosure #then the check fails without writing a record", async () => {
    const result = await replay({ mode: "required" })

    expect(result.outputs.mode).toBe("required")
    expect(result.writes).toHaveLength(0)
    expect(result.checks[0]).toMatchObject({ conclusion: "failure" })
    expect(result.checks[0].output.title).toBe("AI assistance: disclosure required")
  })

  test("#given a dispatch input #when it disagrees with the PR body #then the declared value wins", async () => {
    const result = await replay({ prBody: body({ boxes: [pairTick] }), declared: "fully-ai-authored" })

    expect(result.outputs).toMatchObject({ value: "fully-ai-authored", source: "workflow-dispatch-input" })
    expect(result.recorded[0].disclosures[0]).toMatchObject({ value: "fully-ai-authored", source: "workflow-dispatch-input" })
    expect(result.checks[0].conclusion).toBe("success")
  })

  test("#given the spaced template spelling #when the job runs #then it is stored in the canonical hyphenated form", async () => {
    const result = await replay({ prBody: body({ boxes: [fullTick] }) })

    expect(result.outputs.value).toBe("fully-ai-authored")
    expect(result.recorded[0].disclosures[0].value).toBe("fully-ai-authored")
  })

  test("#given the default dispatch input #when the PR body answers instead #then the body is still parsed", async () => {
    const result = await replay({ prBody: body({ boxes: [fullTick] }), declared: "no" })

    expect(result.outputs).toMatchObject({ value: "fully-ai-authored", source: "pr-body" })
  })

  test("#given the default dispatch input #when the PR body answers nothing #then nothing is recorded", async () => {
    const result = await replay({ declared: "no" })

    expect(result.outputs.value).toBe("none-recorded")
    expect(result.writes).toHaveLength(0)
  })

  test("#given an explicit none box #when the job runs #then the negative answer is recorded too", async () => {
    const result = await replay({ prBody: body({ boxes: [noneTick] }) })

    expect(result.outputs).toMatchObject({ value: "no", source: "pr-body" })
    expect(result.recorded[0].disclosures[0].value).toBe("no")
    expect(result.checks[0].conclusion).toBe("success")
  })

  test("#given a stored disclosure that already matches #when the job re-runs #then no new commit is written to the record branch", async () => {
    const result = await replay({
      prBody: body({ boxes: [pairTick] }),
      existing: { schemaVersion: 1, disclosures: [{ pullRequest: 42, value: "pair-programming", source: "pr-body" }] },
    })

    expect(result.writes).toHaveLength(0)
    expect(result.checks[0].conclusion).toBe("success")
  })

  test("#given a stored disclosure that differs #when the job runs #then the pull request's entry is replaced, not appended", async () => {
    const result = await replay({
      prBody: body({ boxes: [pairTick] }),
      existing: {
        schemaVersion: 1,
        disclosures: [
          { pullRequest: 7, value: "fully-ai-authored", source: "pr-body" },
          { pullRequest: 42, value: "fully-ai-authored", source: "pr-body" },
        ],
      },
    })

    expect(result.writes).toHaveLength(1)
    const { disclosures } = result.recorded[0]
    expect(disclosures).toHaveLength(2)
    expect(disclosures.filter(entry => entry.pullRequest === 42)).toHaveLength(1)
    expect(disclosures.find(entry => entry.pullRequest === 42).value).toBe("pair-programming")
  })

  test("#given a ticked box inside an HTML comment #when the job runs #then the hidden example is not read as an answer", async () => {
    const result = await replay({ prBody: body({ boxes: [`<!-- ${pairTick} -->`] }) })

    expect(result.outputs.value).toBe("none-recorded")
    expect(result.writes).toHaveLength(0)
  })

  test("#given two ticked boxes #when the job runs #then an ambiguous answer is not recorded", async () => {
    const result = await replay({ prBody: body({ boxes: [pairTick, fullTick] }) })

    expect(result.outputs.value).toBe("none-recorded")
    expect(result.writes).toHaveLength(0)
  })

  test("#given a ticked box in another section #when the job runs #then only the AI Assistance section is read", async () => {
    const result = await replay({ prBody: body({ before: notesSection, after: automationSection }) })

    expect(result.outputs.value).toBe("none-recorded")
    expect(result.writes).toHaveLength(0)
  })

  test("#given an existing record file #when a disclosure is written #then the write carries the current blob sha", async () => {
    const result = await replay({
      prBody: body({ boxes: [pairTick] }),
      existing: { schemaVersion: 1, disclosures: [] },
    })

    expect(result.writes[0].sha).toBe("record-sha")
  })

  test("#given a signing comment #when the job runs #then it reads the PR body straight off the event payload", async () => {
    const result = await replay({ eventName: "issue_comment", prBody: body({ boxes: [pairTick] }) })

    expect(result.outputs).toMatchObject({ pr_number: "42", value: "pair-programming", source: "pr-body" })
    expect(result.writes).toHaveLength(1)
    expect(result.checks[0]).toMatchObject({ head_sha: "fork-head", conclusion: "success" })
  })

  test("#given a head that advanced under the job #when the record runs #then neither the record nor the check is touched", async () => {
    const result = await replay({ prBody: body({ boxes: [pairTick] }), currentHeadSha: "new-head" })

    expect(result.writes).toHaveLength(0)
    expect(result.checks).toHaveLength(0)
  })

  test("#given a record branch under contention #when every write is rejected #then it retries, reports neutral, and never claims a persisted record", async () => {
    const result = await replay({ prBody: body({ boxes: [pairTick] }), conflicts: 99 })

    expect(result.writes).toHaveLength(0)
    expect(result.checks[0].conclusion).toBe("neutral")
    expect(result.checks[0].output.title).toBe("AI assistance: pair-programming (branch record not updated)")
    expect(result.checks[0].output.summary).toContain("skipped-contention")
  })

  test("#given the record path is not a file #when a disclosure exists #then the check reports neutral rather than a success nobody can verify", async () => {
    const result = await replay({ prBody: body({ boxes: [pairTick] }), recordPathIsDirectory: true })

    expect(result.writes).toHaveLength(0)
    expect(result.checks[0].conclusion).toBe("neutral")
    expect(result.checks[0].output.title).toBe("AI assistance: pair-programming (branch record not updated)")
    expect(result.checks[0].output.summary).toContain("skipped-unreadable-record")
  })
})
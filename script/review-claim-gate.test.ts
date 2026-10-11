import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { load } from "js-yaml"

const workflowPath = new URL("../.github/workflows/review-claims.yml", import.meta.url)
const headRef = "refs/heads/gh-readonly-queue/dev/pr-9878-c78f87ecb"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function gateJob(): Record<string, unknown> {
  const workflow: unknown = load(readFileSync(workflowPath, "utf8"))
  if (!isRecord(workflow) || !isRecord(workflow["jobs"]) || !isRecord(workflow["jobs"]["gate"])) {
    throw new Error("workflow must define gate")
  }
  return workflow["jobs"]["gate"]
}

function gateSteps(): Record<string, unknown>[] {
  const steps = gateJob()["steps"]
  if (!Array.isArray(steps)) throw new Error("gate steps must be an array")
  return steps.filter(isRecord)
}

async function runQueueGate(ref: string, labels: readonly string[], fetchError = false) {
  const outputs = new Map<string, string>()
  const requests: { readonly owner: string; readonly repo: string; readonly pull_number: number }[] = []
  const step = gateSteps().find((step) => step["id"] === "queue-claims")
  if (step === undefined || !isRecord(step["with"]) || typeof step["with"]["script"] !== "string") {
    throw new Error("gate must recheck merge group claims")
  }
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const run = new AsyncFunction("github", "context", "core", step["with"]["script"])
  const github = {
    rest: {
      pulls: {
        async get(request: { readonly owner: string; readonly repo: string; readonly pull_number: number }) {
          requests.push(request)
          if (fetchError) throw new Error("labels unavailable")
          return { data: { labels: labels.map((name) => ({ name })) } }
        },
      },
    },
  }
  const context = {
    repo: { owner: "example", repo: "project" },
    payload: { merge_group: { head_ref: ref } },
  }
  const core = {
    setOutput(name: string, value: number) { outputs.set(name, String(value)) },
    info(_message: string) {},
    setFailed(message: string) { throw new Error(message) },
  }
  // Run the actual workflow step, including its import, so missing wiring fails.
  const originalWorkspace = process.env.GITHUB_WORKSPACE
  process.env.GITHUB_WORKSPACE = fileURLToPath(new URL("..", import.meta.url))
  try {
    await run(github, context, core)
    return { outputs, requests }
  } finally {
    if (originalWorkspace === undefined) delete process.env.GITHUB_WORKSPACE
    else process.env.GITHUB_WORKSPACE = originalWorkspace
  }
}

describe("merge group review claim gate", () => {
  test("passes a valid queued PR with no active claim and reports its number", async () => {
    const result = await runQueueGate(headRef, ["bug", "stale-review"])
    expect(result.requests).toEqual([{ owner: "example", repo: "project", pull_number: 9878 }])
    expect(result.outputs.get("pr_number")).toBe("9878")
  })

  test.each(["will-review", "in-review"])("blocks the current %s claim", async (claim) => {
    await expect(runQueueGate(headRef, ["bug", claim])).rejects.toThrow("active review claim")
  })

  test.each([
    "",
    "refs/heads/feature/pr-9878-c78f87ecb",
    "refs/heads/gh-readonly-queue/dev/not-a-pr",
    "refs/heads/gh-readonly-queue/dev/pr-0-c78f87ecb",
    "refs/heads/gh-readonly-queue/dev/pr-9878-not-a-sha",
    `x${"refs/heads/gh-readonly-queue/dev/pr-9878-c78f87ecb"}`,
    `${"refs/heads/gh-readonly-queue/dev/pr-9878-c78f87ecb"}x`,
  ])("fails closed for an unparseable head ref: %s", async (ref) => {
    await expect(runQueueGate(ref, [])).rejects.toThrow("queued PR number")
  })

  test("fails closed when PR labels cannot be fetched", async () => {
    await expect(runQueueGate(headRef, [], true)).rejects.toThrow("labels unavailable")
  })

  test("checks claims only on merge groups with read-only permissions", () => {
    const gate = gateJob()
    expect(gate["permissions"]).toEqual({ contents: "read", "pull-requests": "read" })
    const steps = gateSteps()
    expect(steps.find((step) => step["id"] === "queue-claims")?.["if"]).toBe("github.event_name == 'merge_group'")
    expect(steps.find((step) => step["name"] === "Fail while a review claim label is present")?.["if"])
      .toBe("github.event_name == 'pull_request'")
    const checkout = steps.find((step) => String(step["uses"]).startsWith("actions/checkout@"))
    if (checkout === undefined || !isRecord(checkout["with"])) throw new Error("gate must check out helper")
    expect(checkout["if"]).toBe("github.event_name == 'merge_group'")
    expect(checkout["with"]["persist-credentials"]).toBe(false)
    const summary = steps.find((step) => step["name"] === "Write job summary")
    expect(summary?.["run"]).toContain("steps.queue-claims.outputs.pr_number")
  })
})

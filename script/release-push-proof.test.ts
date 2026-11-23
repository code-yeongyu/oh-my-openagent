/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { ciJobs, ciWorkflow, proofHelper, proofHelperUrl, VALIDATIONS } from "./fixtures/publish-ci-validation"

const { ALLOWED_SKIPS, materializeWorkflow, RELEASE_PROOF_CONTRACT, verifyPushValidation } = proofHelper

/**
 * Release contract: a pinned release reuses push CI only when every job and step the exact attempt reports,
 * materialized from ci.yml at that SHA, equals the dispatch-side contract and passed, apart from reasoned skips.
 */

const HELPER = fileURLToPath(proofHelperUrl)
const ACCEPTED = new Set(["passed", "allowed-skip"])

type Workflow = { jobs: Record<string, Record<string, unknown> & { steps: Array<Record<string, unknown>> }> }
type Mutation = readonly [string, (workflow: Workflow) => void]
type WorkflowJob = Workflow["jobs"][string]

function mutatedWorkflow(mutate: (workflow: Workflow) => void): Workflow {
  const workflow = structuredClone(ciWorkflow()) as Workflow
  mutate(workflow)
  return workflow
}

function verify(workflow: unknown, validation: (typeof VALIDATIONS)[number] = "passed"): string[] {
  return verifyPushValidation(workflow, JSON.parse(ciJobs(validation) || "null"))
}

describe("release proof contract", () => {
  test("matches the job and step names ci.yml reports, so a ci.yml change must update it", () => {
    const declared = Object.fromEntries([...materializeWorkflow(ciWorkflow())].map(([name, job]) => [name, job.steps]))
    expect(declared).toEqual(RELEASE_PROOF_CONTRACT)
  })

  test("allows only reasoned skips of contracted jobs and steps", () => {
    for (const entry of ALLOWED_SKIPS) {
      expect(entry.reason.trim()).not.toBe("")
      expect(RELEASE_PROOF_CONTRACT[entry.job], entry.job).toBeDefined()
      for (const step of entry.steps ?? []) expect(RELEASE_PROOF_CONTRACT[entry.job]).toContain(step)
    }
  })
})

describe("closed-world push validation", () => {
  test.each(VALIDATIONS)("%s", (validation) => {
    const problems = verify(ciWorkflow(), validation)
    expect(problems.length === 0, problems.join("\n")).toBe(ACCEPTED.has(validation))
  })

  test("names the unknown green job and the missing Senpi plugin build", () => {
    expect(verify(ciWorkflow(), "unknown-green-job")).toContain(
      "the run reports unknown job surprise-check (completed/success)",
    )
    expect(verify(ciWorkflow(), "absent-senpi-build")).toContain('job senpi-eq lacks steps "Build the Senpi plugin"')
  })

  test("an extra job named like an Object property is still unknown", () => {
    const pages = JSON.parse(ciJobs("unknown-green-job").replace("surprise-check", "constructor"))
    expect(verifyPushValidation(ciWorkflow(), pages)).toContain(
      "the run reports unknown job constructor (completed/success)",
    )
  })

  test.each<Mutation>([
    [
      "a no-op behind the original name",
      (w) => {
        const step = w.jobs["senpi-eq"]?.steps.find((s) => s.name === "Build the Senpi plugin")
        if (!step) throw new Error("missing Senpi build fixture")
        step.run = "true"
      },
    ],
    [
      "an advisory Senpi build",
      (w) => {
        const step = w.jobs["senpi-eq"]?.steps.find((s) => s.name === "Build the Senpi plugin")
        if (!step) throw new Error("missing Senpi build fixture")
        step["continue-on-error"] = true
      },
    ],
    [
      "a condition that skips the Senpi build",
      (w) => {
        const step = w.jobs["senpi-eq"]?.steps.find((s) => s.name === "Build the Senpi plugin")
        if (!step) throw new Error("missing Senpi build fixture")
        step.if = "false"
      },
    ],
    [
      "an added job",
      (w: Workflow) => void (w.jobs["new-check"] = { "runs-on": "ubuntu-26.04", steps: [{ run: "true" }] }),
    ],
    [
      "a renamed step",
      (w: Workflow) => void ((w.jobs.build?.steps.find((s) => s.name === "Build") ?? {}).name = "Build it"),
    ],
    ["a removed job", (w: Workflow) => void delete w.jobs["senpi-eq"]],
    [
      "a computed matrix",
      (w: Workflow) =>
        void (w.jobs["test-linux"] = {
          ...w.jobs["test-linux"],
          strategy: { matrix: `\${{ fromJSON(needs.x.outputs.m) }}` },
        } as WorkflowJob),
    ],
    [
      "axes merged with include",
      (w: Workflow) =>
        void (w.jobs["senpi-tests-linux"] = {
          ...w.jobs["senpi-tests-linux"],
          strategy: { matrix: { part: ["one"], include: [{ part: "two" }] } },
        } as WorkflowJob),
    ],
    [
      "a reusable workflow job",
      (w: Workflow) => void (w.jobs.called = { uses: "./.github/workflows/x.yml" } as unknown as WorkflowJob),
    ],
    [
      "a container job",
      (w: Workflow) => void (w.jobs.build = { ...w.jobs.build, container: "node:24" } as WorkflowJob),
    ],
    [
      "a computed step name",
      (w: Workflow) => void ((w.jobs.build?.steps[0] ?? {}).name = `Checkout \${{ matrix.os }}`),
    ],
    ["an unnamed multi-line run", (w: Workflow) => void w.jobs.build?.steps.splice(1, 0, { run: "echo a\necho b" })],
  ])("refuses ci.yml with %s before reading the jobs", (_, mutate) => {
    const problems = verify(mutatedWorkflow(mutate))
    expect(problems.length).toBeGreaterThan(0)
    expect(problems.every((problem) => problem.startsWith("ci.yml "))).toBe(true)
  })

  test.each([
    ["passed", 0],
    ["unknown-green-job", 1],
    ["skipped-arbitrary-step", 1],
  ] as const)("the CLI exits by the verdict (%s)", (validation, status) => {
    const input = `{"workflow":${JSON.stringify(ciWorkflow())},"jobs":${ciJobs(validation)}}`
    const result = spawnSync("node", [HELPER, "41", "2", "a".repeat(40)], { input, encoding: "utf8", timeout: 15_000 })
    expect(result.status, result.stderr).toBe(status)
    if (status !== 0) expect(result.stderr).toContain("update the release proof contract")
  })

  test("the CLI fails closed on unreadable input", () => {
    const result = spawnSync("node", [HELPER, "41", "2", "a".repeat(40)], {
      input: "{",
      encoding: "utf8",
      timeout: 15_000,
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("cannot read ci.yml and jobs")
  })
})

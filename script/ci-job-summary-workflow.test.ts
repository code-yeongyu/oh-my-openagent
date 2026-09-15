import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { load } from "js-yaml"
import { z } from "zod"
import { readWorkflowSteps, workflowStepSchema } from "./receipt-gate.fixture"

const workflowDirectory = ".github/workflows"
const WINDOWS_INTEGRATION_TEST_TIMEOUT = process.platform === "win32" ? 20_000 : 5_000
const summaryWorkflowSchema = z.object({
  jobs: z.record(z.string(), z.object({ steps: z.array(workflowStepSchema).optional() })),
})

function discoverWorkflowPaths(): readonly string[] {
  return readdirSync(workflowDirectory)
    .filter((fileName) => fileName.endsWith(".yml") || fileName.endsWith(".yaml"))
    .map((fileName) => `${workflowDirectory}/${fileName}`)
    .sort()
}

function discoverStepBasedJobs(workflow: string) {
  const parsed = summaryWorkflowSchema.parse(load(workflow))
  return Object.entries(parsed.jobs).flatMap(([name, job]) => job.steps === undefined ? [] : [{ name, steps: job.steps }])
}

describe("GitHub workflow job summaries", () => {
  test("#given a new step-based workflow job #when workflow coverage is checked #then the job is discovered automatically", () => {
    const workflow = [
      "name: Example",
      "on: workflow_dispatch",
      "jobs:",
      "  existing:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - name: Write job summary",
      "        run: echo ok >> \"$GITHUB_STEP_SUMMARY\"",
      "  newly-added:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: echo missed",
      "  reusable:",
      "    uses: ./.github/workflows/publish-platform.yml",
      "",
    ].join("\n")

    expect(discoverStepBasedJobs(workflow).map((job) => job.name)).toEqual(["existing", "newly-added"])
  })

  test("#given repository workflows #when inspected #then every step-based job writes a concise Markdown summary", () => {
    // given: discover real jobs, so an unrelated new workflow needs no mirrored inventory.
    const paths = discoverWorkflowPaths()
    expect(paths.length).toBeGreaterThan(0)
    for (const path of paths) {
      // when
      const jobs = discoverStepBasedJobs(readFileSync(path, "utf8"))
      // then
      for (const job of jobs) {
        const summary = job.steps.find((step) => step.run?.includes("GITHUB_STEP_SUMMARY"))
        expect(summary, `${path} ${job.name} must write a job summary`).toBeDefined()
        expect(summary?.if, `${path} ${job.name} must summarize failures too`).toBe("always()")
      }
    }
  })

  test("#given a privileged publish summary #when it renders dispatch inputs #then raw inputs are passed through env", () => {
    // given / when
    const summary = readWorkflowSteps("publish-platform.yml", "publish").find((step) => step.run?.includes("GITHUB_STEP_SUMMARY"))
    // then: raw dispatch input must not become executable shell source.
    expect(summary?.env?.JOB_SUMMARY_DIST_TAG).toBe("${{ inputs.dist_tag || 'latest' }}")
    expect(summary?.run).toContain("$JOB_SUMMARY_DIST_TAG")
    expect(summary?.run).not.toContain("${{ inputs.dist_tag")
  })

  test("#given summary inputs #when the shared writer runs #then it emits the Markdown contract GitHub renders", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "omo-ci-summary-"))
    const summaryPath = join(tempDir, "summary.md")
    writeFileSync(summaryPath, "")

    const result = spawnSync("bash", [".github/scripts/write-job-summary.sh"], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_STEP_SUMMARY: summaryPath,
        JOB_SUMMARY_TITLE: "Root CI tests",
        JOB_SUMMARY_STATUS: "success",
        JOB_SUMMARY_DETAILS: "- Runs the Bun test suite\n- Builds vendored MCP packages",
        JOB_SUMMARY_NEXT: "Open failing step logs if this job is red.",
        GITHUB_WORKFLOW: "CI",
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_REF_NAME: "dev",
        GITHUB_SHA: "1234567890abcdef",
        GITHUB_REPOSITORY: "code-yeongyu/oh-my-openagent",
        GITHUB_RUN_ID: "42",
        GITHUB_RUN_ATTEMPT: "2",
      },
    })

    try {
      expect(result.status, result.stderr).toBe(0)
      const summary = readFileSync(summaryPath, "utf8")

      expect(summary).toContain("## Root CI tests")
      expect(summary).toContain("| Field | Value |")
      expect(summary).toContain("| Result | `success` |")
      expect(summary).toContain("| Workflow | `CI` |")
      expect(summary).toContain("### What this job checks")
      expect(summary).toContain("- Runs the Bun test suite")
      expect(summary).toContain("### If this fails")
      expect(summary).toContain("Open failing step logs if this job is red.")
      expect(summary).toContain("[Open run](https://github.com/code-yeongyu/oh-my-openagent/actions/runs/42/attempts/2)")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  }, WINDOWS_INTEGRATION_TEST_TIMEOUT)
})

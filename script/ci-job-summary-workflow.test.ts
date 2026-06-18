import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

type WorkflowExpectation = {
  readonly path: string
  readonly jobs: readonly string[]
}

const workflowExpectations = [
  {
    path: ".github/workflows/ci.yml",
    jobs: [
      "block-master-pr",
      "test",
      "typecheck",
      "codex-compatibility",
      "lazycodex-published-smoke",
      "build",
      "auto-commit-schema",
      "draft-release",
    ],
  },
  { path: ".github/workflows/cla.yml", jobs: ["cla"] },
  { path: ".github/workflows/lint-workflows.yml", jobs: ["actionlint"] },
  { path: ".github/workflows/package-labels.yml", jobs: ["ensure-labels", "label-pull-request", "label-issue"] },
  { path: ".github/workflows/publish-platform.yml", jobs: ["build", "publish"] },
  {
    path: ".github/workflows/publish.yml",
    jobs: ["test", "typecheck", "codex-compatibility", "preflight-trust", "release-metadata", "publish-main", "release"],
  },
  { path: ".github/workflows/refresh-model-capabilities.yml", jobs: ["refresh"] },
  { path: ".github/workflows/sisyphus-agent.yml", jobs: ["agent"] },
  { path: ".github/workflows/web-ci.yml", jobs: ["format-lint-typecheck-build"] },
  { path: ".github/workflows/web-deploy.yml", jobs: ["deploy"] },
] as const satisfies readonly WorkflowExpectation[]

function sliceJob(workflow: string, jobName: string): string {
  const marker = `  ${jobName}:`
  const start = workflow.indexOf(marker)
  if (start < 0) throw new Error(`missing job ${jobName}`)

  const afterMarker = start + marker.length
  const nextJob = workflow.slice(afterMarker).match(/\n  [A-Za-z0-9_-]+:\n/)
  if (nextJob?.index === undefined) return workflow.slice(start)

  return workflow.slice(start, afterMarker + nextJob.index)
}

function hasSummaryWriter(jobSection: string): boolean {
  return jobSection.includes("name: Write job summary") && jobSection.includes("GITHUB_STEP_SUMMARY")
}

describe("GitHub workflow job summaries", () => {
  test("#given repository workflows #when inspected #then every step-based job writes a concise Markdown summary", () => {
    for (const expectation of workflowExpectations) {
      const workflow = readFileSync(expectation.path, "utf8")

      for (const job of expectation.jobs) {
        const jobSection = sliceJob(workflow, job)

        expect(hasSummaryWriter(jobSection), `${expectation.path} ${job} must write a job summary`).toBe(true)
      }
    }
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
  })
})

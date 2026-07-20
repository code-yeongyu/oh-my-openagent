import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

type WorkflowExpectation = {
  readonly path: string
  readonly jobs: readonly string[]
}

const workflowDirectory = ".github/workflows"

const workflowExpectations = [
  {
    path: ".github/workflows/ci.yml",
    jobs: [
      "block-master-pr",
      "test",
      "typecheck",
      "codex-compatibility",
      "senpi-compatibility",
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
    jobs: [
      "test",
      "typecheck",
      "codex-compatibility",
      "preflight-trust",
      "release-metadata",
      "prepare-release-state",
      "dispatch-provenance-safe-publish",
      "publish-main",
      "release",
    ],
  },
  { path: ".github/workflows/refresh-model-capabilities.yml", jobs: ["refresh"] },
  { path: ".github/workflows/sisyphus-agent.yml", jobs: ["agent"] },
  { path: ".github/workflows/stats.yml", jobs: ["stats"] },
  { path: ".github/workflows/web-ci.yml", jobs: ["format-lint-typecheck-build"] },
  { path: ".github/workflows/web-deploy.yml", jobs: ["deploy"] },
] as const satisfies readonly WorkflowExpectation[]

function discoverWorkflowPaths(): readonly string[] {
  return readdirSync(workflowDirectory)
    .filter((fileName) => fileName.endsWith(".yml") || fileName.endsWith(".yaml"))
    .map((fileName) => `${workflowDirectory}/${fileName}`)
    .sort()
}

function discoverStepBasedJobs(workflow: string): readonly string[] {
  const jobsStart = workflow.match(/^jobs:\s*$/m)
  if (jobsStart?.index === undefined) return []

  const jobs: string[] = []
  const lines = workflow.slice(jobsStart.index + jobsStart[0].length).split("\n")
  let currentJob: string | undefined
  let currentJobHasSteps = false

  function flushCurrentJob(): void {
    if (currentJob !== undefined && currentJobHasSteps) jobs.push(currentJob)
  }

  for (const line of lines) {
    const jobMatch = line.match(/^  ([A-Za-z0-9_-]+):\s*$/)
    if (jobMatch !== null) {
      flushCurrentJob()

      const nextJob = jobMatch[1]
      if (nextJob === undefined) throw new Error(`Unable to read job name from line: ${line}`)
      currentJob = nextJob
      currentJobHasSteps = false
      continue
    }

    if (currentJob !== undefined && /^    steps:\s*$/.test(line)) currentJobHasSteps = true
  }

  flushCurrentJob()
  return jobs
}

function sliceJob(workflow: string, jobName: string): string {
  const marker = `  ${jobName}:`
  const start = workflow.indexOf(marker)
  if (start < 0) throw new Error(`missing job ${jobName}`)

  const afterMarker = start + marker.length
  const nextJob = workflow.slice(afterMarker).match(/\n  [A-Za-z0-9_-]+:\n/)
  if (nextJob?.index === undefined) return workflow.slice(start)

  return workflow.slice(start, afterMarker + nextJob.index)
}

function sliceWorkflowSectionToEnd(workflow: string, startMarker: string): string {
  const start = workflow.indexOf(startMarker)
  if (start < 0) throw new Error(`missing workflow section starting at ${startMarker}`)

  return workflow.slice(start)
}

function hasSummaryWriter(jobSection: string): boolean {
  return jobSection.includes("name: Write job summary") && jobSection.includes("GITHUB_STEP_SUMMARY")
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

    expect(discoverStepBasedJobs(workflow)).toEqual(["existing", "newly-added"])
  })

  test("#given repository workflows #when inspected #then every step-based job writes a concise Markdown summary", () => {
    const expectedWorkflowPaths = workflowExpectations.map((expectation) => expectation.path).sort()
    expect(discoverWorkflowPaths()).toEqual(expectedWorkflowPaths)

    for (const expectation of workflowExpectations) {
      const workflow = readFileSync(expectation.path, "utf8")
      expect(discoverStepBasedJobs(workflow), `${expectation.path} step-based job list must stay covered`).toEqual(
        expectation.jobs,
      )

      for (const job of expectation.jobs) {
        const jobSection = sliceJob(workflow, job)

        expect(hasSummaryWriter(jobSection), `${expectation.path} ${job} must write a job summary`).toBe(true)
      }
    }
  })

  test("#given a privileged publish summary #when it renders dispatch inputs #then raw inputs are passed through env", () => {
    const workflow = readFileSync(".github/workflows/publish-platform.yml", "utf8")
    const summaryStep = sliceWorkflowSectionToEnd(workflow, "      - name: Write job summary")

    expect(summaryStep).toContain("JOB_SUMMARY_DIST_TAG: ${{ inputs.dist_tag || 'latest' }}")
    expect(summaryStep).toContain("\\`$JOB_SUMMARY_DIST_TAG\\`")
    expect(summaryStep).not.toContain("`${{ inputs.dist_tag || 'latest' }}`")
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

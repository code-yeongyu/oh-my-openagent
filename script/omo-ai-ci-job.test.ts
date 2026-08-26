/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const ciWorkflowPath = new URL("../.github/workflows/ci.yml", import.meta.url)
const workflowText = readFileSync(ciWorkflowPath, "utf8")
const workflow = Bun.YAML.parse(workflowText) as CiWorkflow

interface Step {
  name?: string
  uses?: string
  run?: string
  "working-directory"?: string
  env?: Record<string, unknown>
}

interface Job {
  "runs-on"?: string
  needs?: string[]
  steps?: Step[]
}

interface CiWorkflow {
  jobs?: Record<string, Job>
}

function job(name: string): Job {
  const value = workflow.jobs?.[name]
  if (!value) throw new Error(`missing job: ${name}`)
  return value
}

function steps(jobName: string): Step[] {
  return job(jobName).steps ?? []
}

function stepByName(jobName: string, name: string): Step {
  const value = steps(jobName).find((step) => step.name === name)
  if (!value) throw new Error(`missing step: ${jobName}/${name}`)
  return value
}

function stepByUses(jobName: string, uses: string): Step {
  const value = steps(jobName).find((step) => step.uses === uses)
  if (!value) throw new Error(`missing step using ${uses} in ${jobName}`)
  return value
}

describe("omo-ai payload check CI job", () => {
  test("#given the ci workflow #when the omo-ai-payload-check job is inspected #then it runs on ubuntu-latest with the sibling action versions", () => {
    // given
    const payloadJob = job("omo-ai-payload-check")

    // when
    const runsOn = payloadJob["runs-on"]

    // then
    expect(runsOn).toBe("ubuntu-latest")
    expect(stepByUses("omo-ai-payload-check", "actions/checkout@v5")).toBeDefined()
    expect(stepByUses("omo-ai-payload-check", "actions/setup-node@v6")).toBeDefined()
    expect(stepByUses("omo-ai-payload-check", "oven-sh/setup-bun@v2")).toBeDefined()
  })

  test("#given the omo-ai-payload-check install step #when inspected #then it uses frozen lockfile without ignore-scripts", () => {
    // given
    const installStep = stepByName("omo-ai-payload-check", "Install dependencies")

    // when
    const command = installStep.run

    // then
    expect(command).toBe("bun install --frozen-lockfile")
  })

  test("#given the omo-ai-payload-check build and verify steps #when inspected #then they run the specified commands", () => {
    // given
    const buildStep = stepByName("omo-ai-payload-check", "Build omo-native")
    const verifyStep = stepByName("omo-ai-payload-check", "Verify omo-ai payload")

    // when
    const buildCommand = buildStep.run
    const verifyCommand = verifyStep.run

    // then
    expect(buildCommand).toBe("bun run build:omo-native")
    expect(verifyCommand).toBe("node script/verify-omo-ai-payload.mjs")
  })

  test("#given the omo-ai-payload-check dry-run publish step #when inspected #then it never publishes for real and targets the beta tag from the native package directory", () => {
    // given
    const dryRunStep = stepByName("omo-ai-payload-check", "Dry-run publish")

    // when
    const command = dryRunStep.run
    const workingDirectory = dryRunStep["working-directory"]
    const hasNpmAuth = steps("omo-ai-payload-check").some(
      (step) => step.env && ("NODE_AUTH_TOKEN" in step.env || "NPM_TOKEN" in step.env),
    )

    // then
    expect(command).toBe("npm publish --dry-run --ignore-scripts --tag beta")
    expect(workingDirectory).toBe("packages/omo-native")
    expect(hasNpmAuth).toBe(false)
  })

  test("#given the auto-commit-schema job #when its needs array is inspected #then omo-ai-payload-check is wired as a dependency", () => {
    // given
    const autoCommitJob = job("auto-commit-schema")

    // when
    const needs = autoCommitJob.needs

    // then
    expect(needs).toContain("omo-ai-payload-check")
  })

  test("#given the draft-release job #when its needs array is inspected #then omo-ai-payload-check is wired as a dependency", () => {
    // given
    const draftReleaseJob = job("draft-release")

    // when
    const needs = draftReleaseJob.needs

    // then
    expect(needs).toContain("omo-ai-payload-check")
  })
})

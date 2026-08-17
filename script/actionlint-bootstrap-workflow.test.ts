/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { load } from "js-yaml"

const workflowPath = new URL("../.github/workflows/lint-workflows.yml", import.meta.url)
const installStepName = "Install actionlint"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readInstallStep(): Record<string, unknown> {
  const workflow = load(readFileSync(workflowPath, "utf8"))
  if (!isRecord(workflow) || !isRecord(workflow.jobs)) throw new Error("lint-workflows.yml has no jobs")

  const actionlintJob = workflow.jobs["actionlint"]
  if (!isRecord(actionlintJob) || !Array.isArray(actionlintJob.steps)) {
    throw new Error("lint-workflows.yml actionlint job has no steps")
  }

  const installStep = actionlintJob.steps.find(
    (step): boolean => isRecord(step) && step["name"] === installStepName,
  )
  if (!isRecord(installStep)) throw new Error(`lint-workflows.yml has no "${installStepName}" step`)

  return installStep
}

function readInstallStepRun(): string {
  const run = readInstallStep()["run"]
  if (typeof run !== "string") throw new Error(`"${installStepName}" step has no run script`)

  return run
}

describe("actionlint bootstrap workflow", () => {
  test("#given the actionlint install step #when inspected #then it authenticates the pinned fetch with the workflow token", () => {
    // given
    const installStep = readInstallStep()

    // when
    const env = installStep["env"]

    // then
    expect(isRecord(env), "install step must pass a token via env").toBe(true)
    if (isRecord(env)) {
      expect(env["GITHUB_TOKEN"], "GITHUB_TOKEN must come from github.token").toBe("${{ github.token }}")
    }
  })

  test("#given an HTTP error from the bootstrap fetch #when the install step runs #then curl exits non-zero instead of piping the error body into bash", () => {
    // given
    const run = readInstallStepRun()

    // when
    const failsCleanly = /(^|\s)--fail(\s|$)/.test(run)
    const pipesIntoBash = /bash\s*</.test(run)

    // then
    expect(failsCleanly, "curl must pass --fail so 4xx/5xx responses fail the step").toBe(true)
    expect(pipesIntoBash, "no curl output may be executed via bash <( or bash <").toBe(false)
  })

  test("#given the actionlint installer script fetch #when inspected #then it uses the authenticated pinned contents API endpoint", () => {
    // given
    const run = readInstallStepRun()

    // when
    const pinnedUrl = run.match(/https:\/\/api\.github\.com\/repos\/rhysd\/actionlint\/contents\/scripts\/download-actionlint\.bash\?ref=v\d+\.\d+\.\d+/)

    // then
    expect(pinnedUrl, "fetch URL must be the api.github.com contents endpoint pinned to a tag").not.toBeNull()
    expect(run.includes("Authorization: Bearer"), "fetch must send a Bearer authorization header").toBe(true)
    expect(
      run.includes("Accept: application/vnd.github.raw+json"),
      "fetch must negotiate raw content, not the JSON metadata envelope",
    ).toBe(true)
    expect(run.includes("raw.githubusercontent.com"), "fetch must not use the throttled raw host").toBe(false)
  })

  test("#given the pinned installer script #when it runs #then the version argument matches the fetched tag", () => {
    // given
    const run = readInstallStepRun()

    // when
    const refTag = run.match(/\?ref=v(\d+\.\d+\.\d+)/)?.[1]
    const versionArg = run.match(/bash download-actionlint\.bash (\d+\.\d+\.\d+)/)?.[1]

    // then
    expect(refTag, "ref tag must pin the installer script version").toBeDefined()
    expect(versionArg, "the installer must be invoked with an explicit version").toBeDefined()
    expect(versionArg, "installer version argument must match the pinned ref tag").toBe(refTag)
  })

  test("#given the install step #when inspected #then it does not mask bootstrap failures with retries", () => {
    // given
    const run = readInstallStepRun()
    const installStep = readInstallStep()

    // when
    const retryConstructs = /(^|\s)(for\s|until\s)|\|\|\s*true/.test(run)

    // then
    expect(retryConstructs, "the bootstrap must fail fast, not retry through failures").toBe(false)
    expect(installStep["continue-on-error"], "the step must not swallow failures").toBeUndefined()
  })
})

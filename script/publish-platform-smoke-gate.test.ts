import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Runs the publish job's own decision steps exactly as shipped (their `run` bodies take every
// input from env, so they execute locally unchanged) and checks what they decide.

interface WorkflowStep {
  readonly name?: string
  readonly run?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function publishStepRun(stepName: string): string {
  const parsed: unknown = Bun.YAML.parse(
    readFileSync(new URL("../.github/workflows/publish-platform.yml", import.meta.url), "utf8"),
  )
  const jobs = isRecord(parsed) ? parsed.jobs : undefined
  const publish = isRecord(jobs) ? jobs.publish : undefined
  const steps = isRecord(publish) && Array.isArray(publish.steps) ? publish.steps : []
  const step = steps.find((candidate: WorkflowStep) => isRecord(candidate) && candidate.name === stepName)
  if (!isRecord(step) || typeof step.run !== "string") {
    throw new Error(`publish job has no runnable step named ${stepName}`)
  }
  return step.run
}

interface StepOutcome {
  readonly exitCode: number
  readonly output: string
}

function runStep(stepName: string, env: Record<string, string>, cwd: string): StepOutcome {
  const result = spawnSync("bash", ["-eo", "pipefail", "-c", publishStepRun(stepName)], {
    cwd,
    env: { PATH: process.env.PATH ?? "", ...env },
    encoding: "utf8",
  })
  return { exitCode: result.status ?? -1, output: `${result.stdout}${result.stderr}` }
}

const scratchDirs: string[] = []
function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "publish-gate-"))
  scratchDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const PAYLOAD_CHECK = "Require this platform's smoked payload"
const ARM64_GATE = "Require the linux-arm64 smoke for arm64 legs"

describe("publish leg refuses a platform whose smoke did not pass", () => {
  test("#given the build leg's smoke failed so no payload was uploaded #when the publish leg checks its download #then it fails and names the reason", () => {
    const outcome = runStep(PAYLOAD_CHECK, { PLATFORM: "windows-x64" }, scratchDir())

    expect(outcome.exitCode).not.toBe(0)
    expect(outcome.output).toContain("windows-x64 is not published")
    expect(outcome.output).toContain("release-binary smoke did not pass")
  })

  test("#given a smoked unix payload was downloaded #when the publish leg checks it #then publishing proceeds", () => {
    const dir = scratchDir()
    writeFileSync(join(dir, "binary-linux-x64.tar.gz"), "payload")

    expect(runStep(PAYLOAD_CHECK, { PLATFORM: "linux-x64" }, dir).exitCode).toBe(0)
  })

  test("#given a smoked windows payload was downloaded #when the publish leg checks it #then publishing proceeds", () => {
    const dir = scratchDir()
    writeFileSync(join(dir, "binary-windows-x64.zip"), "payload")

    expect(runStep(PAYLOAD_CHECK, { PLATFORM: "windows-x64" }, dir).exitCode).toBe(0)
  })

  test("#given only another platform's payload is present #when this platform's publish leg checks #then it still refuses", () => {
    const dir = scratchDir()
    writeFileSync(join(dir, "binary-linux-x64.tar.gz"), "payload")

    expect(runStep(PAYLOAD_CHECK, { PLATFORM: "linux-x64-baseline" }, dir).exitCode).not.toBe(0)
  })
})

describe("arm64 publish legs wait on the linux-arm64 smoke", () => {
  test("#given the linux-arm64 smoke failed #when an arm64 leg publishes #then it refuses and reports the smoke result", () => {
    const outcome = runStep(ARM64_GATE, { PLATFORM: "linux-arm64", ARM64_SMOKE_RESULT: "failure" }, scratchDir())

    expect(outcome.exitCode).not.toBe(0)
    expect(outcome.output).toContain("linux-arm64 is not published")
    expect(outcome.output).toContain("'failure'")
  })

  test("#given the linux-arm64 smoke was skipped #when the musl arm64 leg publishes #then it refuses", () => {
    const outcome = runStep(ARM64_GATE, { PLATFORM: "linux-arm64-musl", ARM64_SMOKE_RESULT: "skipped" }, scratchDir())

    expect(outcome.exitCode).not.toBe(0)
  })

  test("#given the linux-arm64 smoke passed #when an arm64 leg publishes #then it proceeds", () => {
    expect(runStep(ARM64_GATE, { PLATFORM: "linux-arm64", ARM64_SMOKE_RESULT: "success" }, scratchDir()).exitCode).toBe(0)
  })

  test("#given the linux-arm64 smoke failed #when a non-arm64 leg publishes #then that leg is unaffected", () => {
    expect(runStep(ARM64_GATE, { PLATFORM: "windows-x64", ARM64_SMOKE_RESULT: "failure" }, scratchDir()).exitCode).toBe(0)
  })
})

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { load } from "js-yaml"
import { z } from "zod"
import { receiptGateScenarios, runReceiptGate, workflowStepSchema } from "./receipt-gate.fixture"

const workflowSchema = z.object({
  on: z.record(z.string(), z.object({ paths: z.array(z.string()) })),
  permissions: z.record(z.string(), z.string()),
  jobs: z.object({ smoke: z.object({
    "runs-on": z.string(),
    strategy: z.object({ "fail-fast": z.boolean(), matrix: z.object({ include: z.array(z.object({ os: z.string(), target: z.string(), binary: z.string() })) }) }),
    steps: z.array(workflowStepSchema),
  }) }),
})
function readWorkflow() {
  return workflowSchema.parse(load(readFileSync(new URL("../.github/workflows/release-binary-smoke.yml", import.meta.url), "utf8")))
}

const nativeTargets = [
  { os: "ubuntu-latest", target: "linux-x64", binary: "omo-linux-x64" },
  { os: "macos-latest", target: "darwin-arm64", binary: "omo-darwin-arm64" },
  { os: "windows-latest", target: "windows-x64", binary: "omo-windows-x64.exe" },
] as const

describe("release binary PR smoke workflow", () => {
  test.each([
    "script/build-omo-binary.ts", "script/build-omo-binary.test.ts",
    "script/senpi-worker-compile.ts", "script/senpi-worker-compile.test.ts",
    "script/release-compile-argv.fixture.ts", "script/receipt-gate.fixture.ts",
    "script/release-binary-smoke-workflow.test.ts", "script/publish-release-platform-workflow.test.ts",
    "packages/omo-native/compile-entry.ts", "script/qa/dependency-audit-capture.ts",
    "script/qa/dependency-audit/contracts.ts", "script/qa/dependency-audit/runtime.ts",
    "script/qa/dependency-audit/session-cases.ts", "script/qa/fixtures/dependency-audit/extension.ts",
    "script/qa/fixtures/dependency-audit/baseline-76e54b0-806f8e0/summary.json",
    "package.json", "bun.lock", ".github/workflows/release-binary-smoke.yml",
    ".github/workflows/publish-platform.yml",
  ])("schedules native smoke when %s changes", (changedPath) => {
    // given
    const paths = readWorkflow().on.pull_request?.paths ?? []
    // when
    const scheduled = paths.some((pattern) => new Bun.Glob(pattern).match(changedPath))
    // then: path filters are an unordered OR, not a YAML snapshot.
    expect(scheduled).toBe(true)
  })

  test("runs read-only PR checks when a release input changes", () => {
    // given / when
    const workflow = readWorkflow()
    // then
    expect(Object.keys(workflow.on)).toEqual(["pull_request"])
    expect(Object.values(workflow.permissions).every((value) => value !== "write")).toBe(true)
  })

  test.each([...nativeTargets])("uses a native executable when scheduling $target", (native) => {
    // given / when
    const job = readWorkflow().jobs.smoke
    // then
    expect(job["runs-on"]).toBe("${{ matrix.os }}")
    expect(job.strategy["fail-fast"]).toBe(false)
    expect(job.strategy.matrix.include).toContainEqual(native)
  })

  test.each([
    ["install", "patch"], ["patch", "build"], ["build", "contracts"],
    ["contracts", "capture"], ["capture", "receipts"],
  ])("requires %s before %s when executing smoke", (before, after) => {
    // given
    const steps = readWorkflow().jobs.smoke.steps
    // when
    const first = steps.findIndex((step) => step.id === before)
    const second = steps.findIndex((step) => step.id === after)
    // then: unrelated diagnostic steps may appear anywhere.
    expect(first).toBeGreaterThanOrEqual(0)
    expect(second).toBeGreaterThan(first)
    expect(steps.every((step) => step["continue-on-error"] !== true)).toBe(true)
  })

  test("writes a job summary even when a smoke step fails", () => {
    // given / when
    const summary = readWorkflow().jobs.smoke.steps.find((step) => step.id === "summary")
    // then
    expect(summary?.if).toBe("always()")
    expect(summary?.env?.JOB_SUMMARY_STATUS).toBe("${{ job.status }}")
    expect(summary?.run).toContain(".github/scripts/write-job-summary.sh")
  })

  test.each([...receiptGateScenarios(["bytes", "graph", "rpc", "extension"])])("propagates the gate result when given $name", (scenario) => {
    // given
    const capture = readWorkflow().jobs.smoke.steps.find((step) => step.id === "capture")
    if (capture?.run === undefined) throw new Error("missing capture gate")
    // when
    const result = runReceiptGate(capture.run, scenario)
    // then: assert the real shell exit and whether a downstream step could run.
    expect(result.status === 0, result.stderr).toBe(scenario.accepted)
    expect(result.reached).toBe(scenario.accepted)
    if (scenario.accepted) {
      expect(result.captureArgs.filter((_, index, args) => args[index - 1] === "--case")).toEqual(["bytes", "graph", "rpc", "extension"])
    }
  }, 25_000)

  test("uploads only JSON receipts when collecting CI evidence", () => {
    // given / when
    const steps = readWorkflow().jobs.smoke.steps
    const uploads = steps.filter((step) => step.uses?.startsWith("actions/upload-artifact@"))
    // then
    expect(uploads.length).toBeGreaterThan(0)
    for (const upload of uploads) {
      const paths = z.string().parse(upload.with?.path).trim().split("\n")
      expect(paths.every((path) => path.endsWith(".json"))).toBe(true)
      expect(upload.with?.["if-no-files-found"]).toBe("error")
    }
    expect(steps.some((step) => /(?:npm|bun) publish|gh release|gh workflow run/.test(step.run ?? ""))).toBe(false)
  })
})

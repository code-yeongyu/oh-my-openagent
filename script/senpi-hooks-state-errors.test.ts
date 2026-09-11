import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { join } from "node:path"

const runner = join(import.meta.dir, "fixtures", "senpi-hooks-state-error-runner.ts")

type Result = {
  isPublicationError: boolean
  isAggregateError: boolean
  errors: string[]
  message?: string
  temporarySnapshots: number
}

function run(scenario: "cleanup-succeeds" | "cleanup-fails" | "chmod-cleanup-fails"): Result {
  const child = spawnSync(process.execPath, [runner, scenario], { encoding: "utf8" })
  expect(child.status, child.stderr).toBe(0)
  return JSON.parse(child.stdout) as Result
}

describe("patched Senpi hooks state publication failures", () => {
  test("removes the temporary snapshot and preserves the publication error", () => {
    expect(run("cleanup-succeeds")).toEqual({
      isPublicationError: true,
      isAggregateError: false,
      errors: [],
      message: "injected publication failure",
      temporarySnapshots: 0,
    })
  }, 60_000)

  test("reports publication then cleanup errors in an ordered AggregateError", () => {
    expect(run("cleanup-fails")).toEqual({
      isPublicationError: false,
      isAggregateError: true,
      errors: ["publication", "cleanup"],
      message: "Failed to publish and clean up hook trust state snapshot",
      temporarySnapshots: 1,
    })
  }, 60_000)

  test("reports chmod then cleanup errors in an ordered AggregateError", () => {
    expect(run("chmod-cleanup-fails")).toEqual({
      isPublicationError: false,
      isAggregateError: true,
      errors: ["chmod", "cleanup"],
      message: "Failed to publish and clean up hook trust state snapshot",
      temporarySnapshots: 1,
    })
  }, 60_000)
})

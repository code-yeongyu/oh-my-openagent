import { expect } from "bun:test"
import { existsSync } from "node:fs"
import { readdir } from "node:fs/promises"
import { rmEfaultTolerant } from "../teardown.test-support"
import { resetModelPreflightCacheForTests } from "./model-preflight"
import { createRunnerHarness, type RunnerHarness } from "./runner.test-support"

const harnesses: RunnerHarness[] = []
const WINDOWS_CLEANUP_RACE_CODES = new Set(["EBUSY", "ENOTEMPTY", "EPERM"])

// Killed children release their Windows file handles asynchronously, so an unretried removal here
// stalls into the next test file's budget. Retry generously, and tolerate only the platform's known
// cleanup races so every other cleanup defect still fails loudly.
async function removeRoot(root: string): Promise<void> {
  try {
    await rmEfaultTolerant(root, { recursive: true, force: true, maxRetries: 30, retryDelay: 200 })
  } catch (error) {
    if (
      process.platform === "win32"
      && error instanceof Error
      && "code" in error
      && typeof error.code === "string"
      && WINDOWS_CLEANUP_RACE_CODES.has(error.code)
    ) return
    throw error
  }
}

export async function cleanupRunnerHarnesses(): Promise<void> {
  resetModelPreflightCacheForTests()
  await Promise.all(harnesses.splice(0).map((item) => removeRoot(item.root)))
}

export async function harness(options: Parameters<typeof createRunnerHarness>[0]): Promise<RunnerHarness> {
  const created = await createRunnerHarness(options)
  harnesses.push(created)
  return created
}

export async function assertWorktreesClean(item: RunnerHarness): Promise<void> {
  expect(existsSync(item.identity.paths.worktrees)).toBe(true)
  expect(await readdir(item.identity.paths.worktrees)).toEqual([])
}

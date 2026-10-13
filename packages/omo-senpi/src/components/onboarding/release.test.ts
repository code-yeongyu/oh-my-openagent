import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { claimOnboarding, isOnboardingComplete, releaseOnboarding } from "./state"

const dirs: string[] = []
function stateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-onboarding-release-"))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

test("#given a claim #when released twice #then a new claimant can acquire it", () => {
  const dir = stateDir()
  expect(claimOnboarding(dir)).toBe(true)
  releaseOnboarding(dir)
  releaseOnboarding(dir)
  expect(isOnboardingComplete(dir)).toBe(false)
  expect(claimOnboarding(dir)).toBe(true)
})

test("#given an invalid marker directory #when release fails #then surface the filesystem error", () => {
  const dir = stateDir()
  mkdirSync(join(dir, "onboarding-completed"))
  expect(() => releaseOnboarding(dir)).toThrow()
})

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { SAFE_INVOCATION } from "./ci-test-telemetry-setup.mjs"

// Telemetry must never decide the test outcome: a setup failure runs the original command unchanged.
export async function runUninstrumented(directory, invocation, args, error) {
  const errors = [{ stage: "setup", type: error?.name ?? "Error" }]
  console.warn(`[ci-profile] setup capture failed: ${errors[0].type}; running tests without the profile`)
  const child = Bun.spawn([process.execPath, ...args], { stdin: "inherit", stdout: "inherit", stderr: "inherit" })
  const forward = () => child.kill()
  process.once("SIGTERM", forward)
  process.once("SIGINT", forward)
  let exitCode
  try {
    exitCode = await child.exited
  } finally {
    process.removeListener("SIGTERM", forward)
    process.removeListener("SIGINT", forward)
  }
  try {
    if (SAFE_INVOCATION.test(invocation)) {
      mkdirSync(directory, { recursive: true })
      writeFileSync(resolve(directory, `${invocation}-profile.json`), `${JSON.stringify({
        schemaVersion: 1, sha: process.env.CI_TEST_SHA ?? process.env.GITHUB_SHA ?? null,
        runId: process.env.GITHUB_RUN_ID ?? null, runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
        shard: process.env.WINDOWS_TEST_SHARD ?? null, invocation, fallback: true, exitCode, sampleCount: 0, errors,
      }, null, 2)}\n`)
    }
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### Shard profile: ${SAFE_INVOCATION.test(invocation) ? invocation : "(invalid invocation)"}\nProfile setup failed (${errors[0].type}); tests ran unprofiled with their original arguments. Exit: ${exitCode}.\n`)
    }
  } catch (writeError) {
    console.warn(`[ci-profile] fallback record failed: ${writeError.name}`)
  }
  return exitCode
}

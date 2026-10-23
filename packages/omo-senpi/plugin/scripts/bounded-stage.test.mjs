import { describe, expect, test } from "bun:test"

import { runBoundedStage } from "./bounded-stage.test-support.mjs"

// Stand-in for a packaging stage that stalls, with a child of its own like a shell-launched tool (#10911).
const STALLED_WITH_CHILD = [
  "const { spawn } = require('node:child_process')",
  "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })",
  "console.log(`CHILD ${child.pid}`)",
  "setInterval(() => {}, 1000)",
].join("\n")

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe("runBoundedStage (#10911)", () => {
  test("#given a stage that finishes #when it runs #then its status and output are returned", async () => {
    const result = await runBoundedStage("echo", process.execPath, ["-e", "console.log('done')"], {}, 20_000)
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe("done")
  })

  test.skipIf(process.platform !== "win32")("#given a stage that stalls with a child #when its cap passes #then it fails naming the stage and its child is gone too", async () => {
    const failure = await runBoundedStage("stalled stage", process.execPath, ["-e", STALLED_WITH_CHILD], {}, 2_000).catch((error) => error)
    expect(String(failure?.message)).toContain("stalled stage did not finish within 2000 ms")
    const childPid = Number(String(failure?.message).match(/CHILD (\d+)/)?.[1])
    expect(Number.isSafeInteger(childPid)).toBe(true)
    expect(alive(childPid)).toBe(false)
  }, 30_000)

  test.skipIf(process.platform === "win32")("#given a stage that stalls #when its cap passes #then it fails naming the stage with its output", async () => {
    const failure = await runBoundedStage("stalled stage", process.execPath, ["-e", "console.log('started'); setInterval(() => {}, 1000)"], {}, 2_000).catch((error) => error)
    expect(String(failure?.message)).toContain("stalled stage did not finish within 2000 ms")
    expect(String(failure?.message)).toContain("started")
  }, 30_000)
})

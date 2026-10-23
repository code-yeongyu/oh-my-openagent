import { afterEach, describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { GIT_TIMEOUT_DIAGNOSTICS_ENV, recordGitTimeout } from "./timeout-diagnostics"

const roots: string[] = []
const stops: Array<() => void> = []
afterEach(async () => {
  for (const stop of stops.splice(0)) stop()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

// A stand-in for a stalled git that runs its work in a child process: it starts one long-lived child
// and prints the child's pid, so the test can check that the record covers that child too (#10821).
const PARENT = [
  "const { spawn } = require('node:child_process')",
  "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })",
  "console.log(`CHILD ${child.pid}`)",
  "setInterval(() => {}, 1000)",
].join("\n")

describe("git timeout diagnostics on Windows (#10821)", () => {
  test.skipIf(process.platform !== "win32")("#given a timed-out process with a child #when its timeout is recorded #then the thread states of the process and its child are both in the record", async () => {
    // #given
    const root = realpathSync.native(await mkdtemp(join(tmpdir(), "git-timeout-threads-")))
    roots.push(root)
    const parent = spawn(process.execPath, ["-e", PARENT], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true })
    stops.push(() => parent.kill("SIGKILL"))
    const childPid = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("waited 20 s for the stand-in to print its child pid")), 20_000)
      parent.stdout.on("data", (chunk: Buffer) => {
        const pid = Number(chunk.toString("utf8").match(/CHILD (\d+)/)?.[1])
        if (Number.isSafeInteger(pid) && pid > 0) {
          clearTimeout(timer)
          resolve(pid)
        }
      })
    })
    stops.push(() => process.kill(childPid, "SIGKILL"))

    // #when
    recordGitTimeout({ [GIT_TIMEOUT_DIAGNOSTICS_ENV]: join(root, "diagnostics") }, parent.pid, ["add"], root, 1_000)

    // #then
    const [file] = await readdir(join(root, "diagnostics"))
    const record: { processes: string } = JSON.parse(await readFile(join(root, "diagnostics", file ?? ""), "utf8"))
    expect(record.processes).toContain(`threads of ${parent.pid}`)
    expect(record.processes).toContain(`threads of ${childPid}`)
  }, 60_000)
})

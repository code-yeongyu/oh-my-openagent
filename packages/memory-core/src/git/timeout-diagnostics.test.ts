import { afterEach, describe, expect, test } from "bun:test"
import { spawn, spawnSync } from "node:child_process"
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
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

async function readRecord(directory: string): Promise<{ pid: number; argv: string[]; timeoutMs: number; processes: string }> {
  const [file] = await readdir(directory)
  return JSON.parse(await readFile(join(directory, file ?? ""), "utf8"))
}

describe("recordGitTimeout snapshot contract (#12145)", () => {
  test.each([
    { label: "an injected snapshot naming the pid", snapshot: () => `  4242  1  Ss   0:00.00 /usr/local/bin/git add -A\n` },
    { label: "an injected snapshot that fails with a timeout", snapshot: () => "process snapshot failed: spawnSync ps ETIMEDOUT" },
  ])("#given $label #when git times out #then the record carries that snapshot through", async ({ snapshot }) => {
    // #given
    const directory = await mkdtemp(join(tmpdir(), "git-timeout-record-"))
    roots.push(directory)
    const pid = 4242
    const expected = snapshot()
    // #when
    recordGitTimeout({ [GIT_TIMEOUT_DIAGNOSTICS_ENV]: directory }, pid, ["add", "-A"], directory, 2_000, snapshot)
    // #then
    const record = await readRecord(directory)
    expect(record.pid).toBe(pid)
    expect(record.timeoutMs).toBe(2_000)
    expect(record.processes).toBe(expected)
  })
})

// A `ps` whose table is far past the 1 MiB pipe cap spawnSync applies by default (#12801): 80,000
// filler rows (about 9.7 MB), then the timed-out git's row last, so a capped or truncated capture
// cannot contain it.
const STALLED_GIT_ROW = "   4242      1 Ss   -        05:00 /stalled/bin/git add -A -- n000.md"
const LARGE_PS = `#!/bin/sh
[ "$1" = warm ] && exit 0
awk 'BEGIN { for (i = 0; i < 80000; i++) printf "%7d %7d S    -        00:01 /usr/libexec/filler-%07d --role worker --padding ................................\\n", 100000 + i, 1, i }'
echo '${STALLED_GIT_ROW}'
`

describe("process snapshot on a large process table (#12801)", () => {
  test.skipIf(process.platform === "win32")("#given ps prints a table far past the default pipe buffer #when a git timeout is recorded #then the whole table, with the timed-out git's row, is in the record", async () => {
    // #given
    const root = realpathSync.native(await mkdtemp(join(tmpdir(), "git-timeout-large-ps-")))
    roots.push(root)
    const bin = join(root, "bin")
    await mkdir(bin)
    await writeFile(join(bin, "ps"), LARGE_PS, "utf8")
    await chmod(join(bin, "ps"), 0o755)
    // The first exec of a fresh executable can stall while the OS vets it; pay that before the timed snapshot.
    expect(spawnSync(join(bin, "ps"), ["warm"], { stdio: "ignore", timeout: 60_000 }).status).toBe(0)
    const diagnostics = join(root, "diagnostics")
    // The snapshot resolves `ps` on its own process's PATH, so it runs in a child whose PATH leads with the fake.
    const script = [
      `const { GIT_TIMEOUT_DIAGNOSTICS_ENV, recordGitTimeout } = require(${JSON.stringify(join(import.meta.dir, "timeout-diagnostics.ts"))})`,
      `recordGitTimeout({ [GIT_TIMEOUT_DIAGNOSTICS_ENV]: ${JSON.stringify(diagnostics)} }, 4242, ["add", "-A", "--", "n000.md"], ${JSON.stringify(root)}, 2_000)`,
    ].join("\n")

    // #when
    const child = spawnSync(process.execPath, ["-e", script], { env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` }, encoding: "utf8", timeout: 60_000 })

    // #then
    expect(child.error).toBeUndefined()
    expect(child.status).toBe(0)
    const record = await readRecord(diagnostics)
    expect(record.processes).toContain(STALLED_GIT_ROW)
    expect(record.processes.length).toBeGreaterThan(8 * 1024 * 1024)
  }, 90_000)
})

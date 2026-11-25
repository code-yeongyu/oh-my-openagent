import { afterEach, describe, expect, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import { createRemoteThreadFixture } from "../../omo-senpi/src/components/thread/thread-remote-fixture"
import { runThreadCommand } from "../bin/lib/thread.js"
import {
  agentDirUnexpectedLog,
  UNEXPECTED_LOG_MAX_BYTES,
  UNEXPECTED_RECORD_MAX_BYTES,
} from "../bin/lib/thread-unexpected-log.js"

// B8 sink ruling for omo thread: an unexpected exception's text goes only to an owner-only file under the agent dir,
// which the fixed message names; nowhere else (answer, stdout, stderr). A sink it cannot write names no file.

const TAG = "cnry-b8-cli"
const FIXED = "The thread operation failed unexpectedly."
const UNWRITTEN = `${FIXED} Its details could not be written to the local log.`
const fixture = createRemoteThreadFixture()
afterEach(fixture.cleanup)

async function run(prepare?: (agentDir: string) => void) {
  const remote = fixture.account().remote
  const agentDir = fixture.surface(remote).agentDir
  prepare?.(agentDir)
  const out: string[] = []
  const err: string[] = []
  const exit = await runThreadCommand(["list", "--json"], {
    engine: { run: () => ({ exitCode: 0, stdout: "", stderr: "" }) },
    pluginRoot: "/plugin",
    agentDir,
    env: {},
    cwd: process.cwd(),
    stdout: { write: (text: string) => void out.push(text) },
    stderr: { write: (text: string) => void err.push(text) },
    platform: "linux",
    loadSqlite: async () => ({}),
    importSdk: async () => ({
      createThreadSdk: (options: { readonly onUnexpected?: (error: unknown) => unknown }) => {
        const s = fixture.surface(
          remote,
          options.onUnexpected === undefined ? {} : { onUnexpected: options.onUnexpected },
        )
        const fault = async () => {
          throw new Error(`${TAG}-message`, { cause: new Error(`${TAG}-cause`) })
        }
        Object.assign(s.host, { listView: fault, listSessions: fault })
        return { ...s.sdk(), dispose: async () => {} }
      },
    }),
    identity: { uid: process.getuid?.() ?? 0, user: "qa" },
  })
  const stdout = out.join("")
  return {
    exit,
    stdout,
    stderr: err.join(""),
    agentDir,
    message: (JSON.parse(stdout) as { error: { message: string } }).error.message,
  }
}

describe("omo thread: the unexpected-failure log (B8)", () => {
  test("#given a writable agent dir #when a call fails unexpectedly #then exit 5, the fixed message names the owner-only file, and the text is in that file only", async () => {
    const result = await run()
    const file = join(realpathSync(join(result.agentDir, "logs")), "thread-unexpected.log")
    expect(result.exit).toBe(5)
    expect(result.message).toBe(`${FIXED} The details are in ${file}.`)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(statSync(join(result.agentDir, "logs")).mode & 0o777).toBe(0o700)
    expect(readFileSync(file, "utf8")).toContain(`${TAG}-message`)
    expect(readFileSync(file, "utf8")).toContain(`${TAG}-cause`)
    expect(result.stdout + result.stderr).not.toContain(TAG)
  })

  test("#given the log path is a symlink #when a call fails unexpectedly #then nothing is written through it and the fixed message names no file", async () => {
    const elsewhere = join(fixture.surface(undefined).agentDir, "elsewhere.log")
    const result = await run((agentDir) => {
      mkdirSync(join(agentDir, "logs"), { mode: 0o700 })
      symlinkSync(elsewhere, join(agentDir, "logs", "thread-unexpected.log"))
    })
    expect(result.exit).toBe(5)
    expect(result.message).toBe(UNWRITTEN)
    expect(existsSync(elsewhere)).toBe(false)
    expect(result.stdout + result.stderr).not.toContain(TAG)
  })

  test("#given a log directory it cannot create #when a call fails unexpectedly #then the same exit and the fixed message without a file", async () => {
    const result = await run((agentDir) => writeFileSync(join(agentDir, "logs"), "not a directory"))
    expect(result.exit).toBe(5)
    expect(result.message).toBe(UNWRITTEN)
    expect(result.stdout + result.stderr).not.toContain(TAG)
  })

  test("#given a full log readable by others #when a call fails unexpectedly #then it is neither written nor rotated, and the message names no file", async () => {
    const result = await run((agentDir) => {
      mkdirSync(join(agentDir, "logs"), { mode: 0o700 })
      writeFileSync(join(agentDir, "logs", "thread-unexpected.log"), "x".repeat(UNEXPECTED_LOG_MAX_BYTES), {
        mode: 0o644,
      })
    })
    const logs = join(result.agentDir, "logs")
    expect(result.message).toBe(UNWRITTEN)
    expect(existsSync(join(logs, "thread-unexpected.log.1"))).toBe(false)
    expect(readFileSync(join(logs, "thread-unexpected.log"), "utf8")).not.toContain(TAG)
  })

  test("#given an exception far larger than one record #when it is logged #then the file holds at most one record's bound", async () => {
    const remote = fixture.account().remote
    const agentDir = fixture.surface(remote).agentDir
    const port = agentDirUnexpectedLog(agentDir)
    expect(port(new Error(`${TAG}-${"y".repeat(4 * UNEXPECTED_RECORD_MAX_BYTES)}`))).toBeString()
    expect(statSync(join(agentDir, "logs", "thread-unexpected.log")).size).toBeLessThanOrEqual(
      UNEXPECTED_RECORD_MAX_BYTES + 1,
    )
  })

  test("#given a log that rotates twice #when each rotation happens #then exactly one rotated file is kept, and the two files never pass twice the bound", async () => {
    const remote = fixture.account().remote
    const agentDir = fixture.surface(remote).agentDir
    const logs = join(agentDir, "logs")
    mkdirSync(logs, { mode: 0o700 })
    const port = agentDirUnexpectedLog(agentDir)
    for (const round of [1, 2]) {
      writeFileSync(join(logs, "thread-unexpected.log"), "x".repeat(UNEXPECTED_LOG_MAX_BYTES), { mode: 0o600 })
      expect(port(new Error(`${TAG}-round-${round}`))).toBeString()
    }
    const kept = readdirSync(logs).sort()
    expect(kept).toEqual(["thread-unexpected.log", "thread-unexpected.log.1"])
    const total = kept.reduce((sum, name) => sum + statSync(join(logs, name)).size, 0)
    expect(total).toBeLessThanOrEqual(2 * UNEXPECTED_LOG_MAX_BYTES)
  })

  test("#given a log at its size bound #when a call fails unexpectedly #then the full log moves to .1 and a new owner-only file holds the record", async () => {
    const result = await run((agentDir) => {
      mkdirSync(join(agentDir, "logs"), { mode: 0o700 })
      writeFileSync(join(agentDir, "logs", "thread-unexpected.log"), "x".repeat(UNEXPECTED_LOG_MAX_BYTES), {
        mode: 0o600,
      })
    })
    const logs = join(result.agentDir, "logs")
    expect(statSync(join(logs, "thread-unexpected.log.1")).size).toBe(UNEXPECTED_LOG_MAX_BYTES)
    expect(readFileSync(join(logs, "thread-unexpected.log"), "utf8")).toContain(`${TAG}-message`)
    expect(statSync(join(logs, "thread-unexpected.log")).mode & 0o777).toBe(0o600)
  })
})

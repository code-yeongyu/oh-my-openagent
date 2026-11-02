// Writer P as its own process, for the rows whose test must place P inside a test-owned outer job before P spawns
// the helper (design v4.2 rows T7(c), T7(d), T8). It optionally takes the memory-write lock, prints `ready`, waits for
// `start` on stdin, runs ONE git command through createNodeGitExec with the injected helper, and prints the outcome:
// `result <code>` or `error <name> <message as JSON>`.
import { createInterface } from "node:readline"

import { acquireLock, createLockRecord, memoryWriterLockPath, releaseLock } from "../locks"
import { createNodeGitExec } from "./exec"

type WriterConfig = {
  readonly repo: string
  readonly locks: string
  readonly helper: { readonly path: string; readonly lingerMs?: number }
  readonly argv: readonly string[]
  readonly holdWriterLock: boolean
  readonly env?: Readonly<Record<string, string>>
}

const config = JSON.parse(process.argv[2] ?? "{}") as WriterConfig
const lines = createInterface({ input: process.stdin })
const nextLine = (): Promise<string> => new Promise((resolve) => lines.once("line", resolve))

const record = await createLockRecord("memory-write")
const writerLock = memoryWriterLockPath(config.locks)
if (config.holdWriterLock) {
  await acquireLock(writerLock, record, { waitTimeoutMs: 5_000 })
  process.stdout.write(`locked ${record.nonce}\n`)
}
// The record's protocol claim proves whether this process's helper `selftest` already ran (design section 6.3); the
// outer-job rows read it before they place P in their job.
process.stdout.write(`ready ${record.git_activity_job ?? "unclaimed"}\n`)
if ((await nextLine()) !== "start") process.exit(2)

try {
  const result = await createNodeGitExec({ jobHelper: config.helper }).run(config.argv, {
    cwd: config.repo,
    timeoutMs: 60_000,
    env: { ...process.env, ...config.env },
  })
  process.stdout.write(`result ${result.code}\n`)
} catch (error) {
  const name = error instanceof Error ? error.name : "unknown"
  process.stdout.write(`error ${name} ${JSON.stringify(error instanceof Error ? error.message : String(error))}\n`)
} finally {
  if (config.holdWriterLock) await releaseLock(writerLock, record)
  lines.close()
}
process.exit(0)

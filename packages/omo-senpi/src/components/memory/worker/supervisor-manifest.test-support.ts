import { realpathSync } from "node:fs"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const childFixture = join(import.meta.dir, "__fixtures__", "supervisor-child.ts")

export async function makeSupervisorRun(roots: string[], options: {
  readonly mode: "inspect" | "graceful" | "stubborn" | "model-not-found"
  readonly hardDeadlineAt?: number
  readonly terminationGraceMs?: number
  readonly nextAttempt?: { readonly attempt: number; readonly model: string; readonly thinking?: string }
}): Promise<string> {
  const runDir = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-run-supervisor-")))
  roots.push(runDir)
  await mkdir(runDir, { recursive: true, mode: 0o700 })
  await writeFile(join(runDir, "ledger.json"), `${JSON.stringify({ version: 1, runId: "run-a", kind: "reflection" })}\n`)
  await writeFile(join(runDir, "launch.json"), `${JSON.stringify({
    version: 1,
    runId: "run-a",
    attempt: 1,
    kind: "reflection",
    nextAttempt: options.nextAttempt,
    memoryRoot: runDir,
    command: process.execPath,
    args: [childFixture, options.mode, runDir],
    cwd: runDir,
    env: { ...process.env },
    // Non-deadline runs get a load-tolerant budget: cold bun spawns plus fsync'd identity
    // writes overshoot 10s on a loaded windows-latest runner, and the supervisor records
    // timedOut from the deadline instant being reached even when the child exited cleanly.
    hardDeadlineAt: options.hardDeadlineAt ?? Date.now() + 45_000,
    terminationGraceMs: options.terminationGraceMs ?? 1_000,
    maxOutputBytes: 65_536,
    stdoutPath: join(runDir, "child-stdout.log"),
    stderrPath: join(runDir, "child-stderr.log"),
  })}\n`, { mode: 0o600 })
  return runDir
}

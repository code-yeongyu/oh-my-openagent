import { appendFile, readFile, writeFile } from "../fs/resilient"

import { LockContentionError, acquireLock, createLockRecord, releaseLock } from "./index"

const [mode, lockPath, counterPath, logPath, workerId] = process.argv.slice(2)
if (mode === undefined || lockPath === undefined || workerId === undefined) {
  throw new Error("missing subprocess worker arguments")
}

const record = await createLockRecord("memory-write", { runId: workerId })

async function increment(): Promise<void> {
  if (counterPath === undefined || logPath === undefined) throw new Error("missing counter paths")
  await appendFile(logPath, `${workerId}:enter\n`)
  const current = Number.parseInt(await readFile(counterPath, "utf8"), 10)
  await writeFile(counterPath, `${current + 1}\n`)
  await appendFile(logPath, `${workerId}:exit\n`)
}

process.stdout.write("attempting\n")
if (mode === "contending-increment") {
  try {
    await acquireLock(lockPath, record)
  } catch (error) {
    if (!(error instanceof LockContentionError)) throw error
    process.stdout.write("contended\n")
    await acquireLock(lockPath, record, { waitTimeoutMs: 10_000, retryDelayMs: 10 })
  }
} else {
  await acquireLock(lockPath, record, { waitTimeoutMs: 10_000, retryDelayMs: 10 })
}
process.stdout.write("entered\n")

if (mode === "gated-increment") {
  const gate = new Promise<void>((resolve) => process.stdin.once("data", () => resolve()))
  process.stdin.resume()
  process.stdout.write("ready\n")
  await gate
  process.stdin.pause()
  await increment()
  await releaseLock(lockPath, record)
} else if (mode === "increment" || mode === "contending-increment") {
  await increment()
  await releaseLock(lockPath, record)
} else if (mode === "hold") {
  // Hold the lock for as long as the parent lives, then exit WITHOUT releasing so the marker is
  // left behind exactly like a crashed owner (the recovery tests depend on that). The parent must
  // spawn this worker with a piped stdin it keeps open: EOF/close/error on that pipe - including
  // the kernel closing it on abrupt parent death - is the only exit path. Never park on a bare
  // unsettled promise here: Bun does not exit on an unsettled top-level await, it busy-polls a
  // handle-less event loop at one full core, which is how orphaned holders spun forever (#7335).
  await new Promise<void>((resolve) => {
    const done = (): void => {
      // A still-open stdin would keep the loop alive after the wait resolves; drop it so exit is
      // unconditional on every ownership-loss path.
      process.stdin.destroy()
      resolve()
    }
    process.stdin.once("end", done)
    process.stdin.once("close", done)
    process.stdin.once("error", done)
    process.stdin.resume()
  })
} else {
  await releaseLock(lockPath, record)
  throw new Error(`unknown subprocess worker mode: ${mode}`)
}

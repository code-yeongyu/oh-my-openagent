import { join } from "node:path"

import { appendFile, existsSync } from "../fs/resilient"
import { provenDeadTakeoverFor } from "../locks/proven-dead-takeovers"
import { traceTakeover } from "./takeover-trace.test-support"

import { GitMemoryRepo } from "../git"
import {
  LockContentionError,
  acquireLock,
  createLockRecord,
  memoryWriterLockPath,
  releaseLock,
} from "../locks"
import { runMemoryTool } from "../tools/memory"

type WriterMode = "normal" | "kill-holder" | "recovery"

type WriterTask = {
  readonly writerId: string
  readonly index: number
}

const [modeValue, repoPath, locksPath, writerId, countValue, contentionPath] = process.argv.slice(2)
if (
  (modeValue !== "normal" && modeValue !== "kill-holder" && modeValue !== "recovery") ||
  repoPath === undefined ||
  locksPath === undefined ||
  writerId === undefined ||
  countValue === undefined ||
  contentionPath === undefined
) {
  throw new Error("missing writer child arguments")
}

const mode: WriterMode = modeValue
// An externally terminated child never reaches this handler, so a missing "exit" line in the trace marks the kill.
process.on("exit", (code) => traceTakeover(writerId, "exit", { code }))
const indexLockPresent = (): boolean => existsSync(join(repoPath, ".git", "index.lock"))
const count = Number.parseInt(countValue, 10)
if (!Number.isInteger(count) || count < 1) throw new Error(`invalid writer count: ${countValue}`)

const messages: string[] = []
const waiters: Array<() => void> = []
let buffered = ""

process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk: string) => {
  buffered += chunk
  for (;;) {
    const newline = buffered.indexOf("\n")
    if (newline < 0) break
    messages.push(buffered.slice(0, newline))
    buffered = buffered.slice(newline + 1)
    waiters.shift()?.()
  }
})
process.stdin.resume()

async function waitForMessage(expected: string): Promise<void> {
  for (;;) {
    const index = messages.indexOf(expected)
    if (index >= 0) {
      messages.splice(index, 1)
      return
    }
    await new Promise<void>((resolve) => waiters.push(resolve))
  }
}

function tasksForWriter(): WriterTask[] {
  if (mode !== "recovery") {
    return Array.from({ length: count }, (_, index) => ({ writerId, index }))
  }
  return [
    ...Array.from({ length: count - 1 }, (_, offset) => ({ writerId: "holder", index: offset + 1 })),
    ...Array.from({ length: count }, (_, index) => ({ writerId, index })),
  ]
}

const repo = new GitMemoryRepo({ dir: repoPath, agentId: `concurrency-${writerId}` })
const lockPath = memoryWriterLockPath(locksPath)
let acquisition = 0

async function locked<T>(operation: () => Promise<T>): Promise<T> {
  const record = await createLockRecord("memory-write", { runId: `${writerId}-${acquisition}` })
  const isFirstNormalAcquisition = mode === "normal" && acquisition === 0
  acquisition += 1
  const acquireStart = performance.now()
  traceTakeover(writerId, "acquire-start", { acquisition, indexLock: indexLockPresent() })

  try {
    if (isFirstNormalAcquisition) {
      try {
        await acquireLock(lockPath, record)
      } catch (error) {
        if (!(error instanceof LockContentionError)) throw error
        traceTakeover(writerId, "contended", { acquisition })
        await appendFile(contentionPath, `${writerId}\n`)
        process.stdout.write("contended\n")
        await acquireLock(lockPath, record, { waitTimeoutMs: 15_000, retryDelayMs: 5 })
      }
      process.stdout.write("holding\n")
      await waitForMessage("release-first")
    } else {
      await acquireLock(lockPath, record, { waitTimeoutMs: 15_000, retryDelayMs: 5 })
    }
    traceTakeover(writerId, "acquired", {
      acquisition,
      ms: Math.round(performance.now() - acquireStart),
      tookOverDeadOwnerPid: provenDeadTakeoverFor(lockPath, record.nonce)?.pid ?? null,
      indexLock: indexLockPresent(),
    })

    if (mode === "kill-holder" && acquisition === 2) {
      traceTakeover(writerId, "kill-ready", { acquisition })
      process.stdout.write("kill-ready\n")
      // Hold the lock until the parent SIGKILLs this process. The parent owns our stdin pipe (it
      // spawns us with a piped stdin, already resumed above), so if the parent dies first the
      // kernel closes it and we exit here like a crashed owner - deliberately skipping the
      // release in `finally`. Never park on a bare unsettled promise: Bun does not exit on an
      // unsettled top-level await, it busy-polls a handle-less loop at one full core (#7335).
      await new Promise<void>((resolve) => {
        process.stdin.once("end", resolve)
        process.stdin.once("close", resolve)
        process.stdin.once("error", resolve)
      })
      process.exit(0)
    }
    return await operation()
  } finally {
    await releaseLock(lockPath, record)
  }
}

async function commit(task: WriterTask): Promise<void> {
  const relativePath = `concurrency/${task.writerId}-${task.index}.md`
  const commitStart = performance.now()
  traceTakeover(writerId, "commit-start", { task: `${task.writerId}-${task.index}` })
  try {
    await createNote(task, relativePath)
  } catch (error) {
    traceTakeover(writerId, "commit-error", { task: `${task.writerId}-${task.index}`, ms: Math.round(performance.now() - commitStart), error: String(error).slice(0, 300) })
    throw error
  }
  traceTakeover(writerId, "commit-end", { task: `${task.writerId}-${task.index}`, ms: Math.round(performance.now() - commitStart) })
}

async function createNote(task: WriterTask, relativePath: string): Promise<void> {
  await runMemoryTool({
    repo,
    lock: (_domain, operation) => locked(operation),
    params: {
      command: "create",
      reason: `concurrency: ${task.writerId} ${task.index}`,
      author: { agentId: `concurrency-${task.writerId}`, authorName: `Writer ${task.writerId}` },
      file_path: relativePath,
      description: `multi-process write ${task.writerId} ${task.index}`,
      file_text: `${task.writerId}:${task.index}\n`,
    },
  })
}

traceTakeover(writerId, "ready", { mode })
process.stdout.write("ready\n")
await waitForMessage("go")
traceTakeover(writerId, "go")
if (mode === "recovery") {
  await waitForMessage("begin-recovery")
  traceTakeover(writerId, "begin-recovery")
}
for (const task of tasksForWriter()) await commit(task)
process.stdout.write(`done:${acquisition}\n`)
process.stdin.pause()

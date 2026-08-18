import { appendFile } from "node:fs/promises"

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

  try {
    if (isFirstNormalAcquisition) {
      try {
        await acquireLock(lockPath, record)
      } catch (error) {
        if (!(error instanceof LockContentionError)) throw error
        await appendFile(contentionPath, `${writerId}\n`)
        process.stdout.write("contended\n")
        await acquireLock(lockPath, record, { waitTimeoutMs: 15_000, retryDelayMs: 5 })
      }
      process.stdout.write("holding\n")
      await waitForMessage("release-first")
    } else {
      await acquireLock(lockPath, record, { waitTimeoutMs: 15_000, retryDelayMs: 5 })
    }

    if (mode === "kill-holder" && acquisition === 2) {
      process.stdout.write("kill-ready\n")
      await new Promise<never>(() => {})
    }
    return await operation()
  } finally {
    await releaseLock(lockPath, record)
  }
}

async function commit(task: WriterTask): Promise<void> {
  const relativePath = `concurrency/${task.writerId}-${task.index}.md`
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

process.stdout.write("ready\n")
await waitForMessage("go")
if (mode === "recovery") await waitForMessage("begin-recovery")
for (const task of tasksForWriter()) await commit(task)
process.stdout.write(`done:${acquisition}\n`)
process.stdin.pause()

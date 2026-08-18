import { afterEach, describe, expect, it } from "bun:test"
import { spawn } from "node:child_process"
import { existsSync, realpathSync } from "node:fs"
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { TranscriptJournal, withLocalJournalLock } from "./store"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

async function createJournal(): Promise<{ dir: string; journal: TranscriptJournal }> {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-journal-")))
  tempDirs.push(dir)
  return {
    dir,
    journal: new TranscriptJournal({
      journalDir: dir,
      now: () => new Date("2026-08-09T12:00:00.000Z"),
    }),
  }
}

describe("transcript journal store", () => {
  it("#given three completed assistant messages #when reconciled twice #then rows are idempotent and steps stay derived", async () => {
    // given
    const { dir, journal } = await createJournal()
    const messages = [
      { kind: "user" as const, messageId: "user-1", text: "help" },
      { kind: "assistant" as const, messageId: "assistant-1", textBlocks: ["one"] },
      {
        kind: "assistant" as const,
        messageId: "assistant-tool",
        toolCalls: [{ callId: "tool-1", name: "read" }],
      },
      { kind: "assistant" as const, messageId: "assistant-2", textBlocks: ["two"] },
      { kind: "assistant" as const, messageId: "assistant-3", textBlocks: ["three"] },
    ]

    // when
    const first = await journal.reconcile(messages)
    const second = await journal.reconcile(messages)
    const state = await journal.getState()
    const transcript = await readFile(join(dir, "transcript.jsonl"), "utf8")

    // then
    expect(first).toEqual({ appended: 5, skipped: 0 })
    expect(second).toEqual({ appended: 0, skipped: 5 })
    expect(transcript.trim().split("\n")).toHaveLength(5)
    expect(state).toEqual({
      schema_version: "v3_assistant_steps",
      total_completed_steps: 3,
      reflected_completed_steps: 0,
      steps_since_last_successful_reflection: 3,
    })
  })

  it("#given a stale derived counter on disk #when state is written #then the counter is recomputed", async () => {
    // given
    const { dir, journal } = await createJournal()
    await journal.reconcile([
      { kind: "assistant", messageId: "assistant-1", textBlocks: ["one"] },
    ])
    await writeFile(
      join(dir, "state.json"),
      `${JSON.stringify({
        schema_version: "v3_assistant_steps",
        total_completed_steps: 1,
        reflected_completed_steps: 0,
        steps_since_last_successful_reflection: 99,
      })}\n`,
    )

    // when
    await journal.setPendingCompaction(true)
    const state = await journal.getState()

    // then
    expect(state.steps_since_last_successful_reflection).toBe(1)
    expect(state.pending_compaction).toBe(true)
  })
})

describe("cancellable journal flush", () => {
  it("#given a journal with rows #when flush runs #then it settles and leaves no lock behind", async () => {
    // given
    const { dir, journal } = await createJournal()
    await journal.reconcile([{ kind: "assistant", messageId: "assistant-1", textBlocks: ["one"] }])

    // when
    await journal.flush()

    // then
    expect(existsSync(join(dir, "state.lock"))).toBe(false)
    expect((await readFile(join(dir, "transcript.jsonl"), "utf8")).trim().split("\n")).toHaveLength(1)
  })

  it("#given a signal aborted before acquisition #when flush runs #then it throws AbortError and creates no lock file", async () => {
    // given
    const { dir, journal } = await createJournal()
    await journal.reconcile([{ kind: "assistant", messageId: "assistant-1", textBlocks: ["one"] }])
    const controller = new AbortController()
    controller.abort()

    // when
    const failure = await journal.flush(controller.signal).catch((error: unknown) => error)

    // then
    expect((failure as Error).name).toBe("AbortError")
    expect(existsSync(join(dir, "state.lock"))).toBe(false)
  })

  it("#given an abort during the acquisition retry loop #when the lock is contended #then it throws without acquiring", async () => {
    // given
    const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-journal-lock-")))
    tempDirs.push(dir)
    const lockPath = join(dir, "state.lock")
    await writeFile(lockPath, "held-by-another-holder\n", "utf8")
    const controller = new AbortController()
    let taskRuns = 0

    // when
    queueMicrotask(() => controller.abort())
    const failure = await withLocalJournalLock(
      lockPath,
      async () => { taskRuns += 1 },
      controller.signal,
    ).catch((error: unknown) => error)

    // then
    expect((failure as Error).name).toBe("AbortError")
    expect(taskRuns).toBe(0)
    expect(await readFile(lockPath, "utf8")).toBe("held-by-another-holder\n")
  })

  it("#given an abort raised while the task holds the lock #when the task settles #then the lock file is released anyway", async () => {
    // given
    const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-journal-lock-")))
    tempDirs.push(dir)
    const lockPath = join(dir, "state.lock")
    const controller = new AbortController()

    // when
    await withLocalJournalLock(
      lockPath,
      async () => {
        controller.abort()
        expect(existsSync(lockPath)).toBe(true)
      },
      controller.signal,
    )

    // then
    expect(existsSync(lockPath)).toBe(false)
  })

describe("stale journal lock recovery", () => {
  async function spawnExitedChildPid(): Promise<number> {
    const child = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" })
    await new Promise<void>((resolve, reject) => {
      child.once("exit", () => resolve())
      child.once("error", reject)
    })
    if (child.pid === undefined) throw new Error("exited child has no pid")
    return child.pid
  }

  it("#given a lock file left by a dead process #when the lock is acquired #then the stale lock is reclaimed and the task runs", async () => {
    // given
    const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-journal-lock-")))
    tempDirs.push(dir)
    const lockPath = join(dir, "state.lock")
    const deadPid = await spawnExitedChildPid()
    await writeFile(lockPath, `${deadPid}\n`, "utf8")

    // when
    let taskRuns = 0
    await withLocalJournalLock(lockPath, async () => {
      taskRuns += 1
      const payload = await readFile(lockPath, "utf8")
      expect(payload.startsWith(`${process.pid}\n`)).toBe(true)
    })

    // then
    expect(taskRuns).toBe(1)
    expect(existsSync(lockPath)).toBe(false)
  }, 15_000)

  it("#given a payload-free lock file abandoned mid-acquisition #when the lock is acquired #then the artifact is reclaimed by age", async () => {
    // given
    const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-journal-lock-")))
    tempDirs.push(dir)
    const lockPath = join(dir, "state.lock")
    await writeFile(lockPath, "", "utf8")
    const abandonedAt = new Date(Date.now() - 60_000)
    await utimes(lockPath, abandonedAt, abandonedAt)

    // when
    let taskRuns = 0
    await withLocalJournalLock(lockPath, async () => {
      taskRuns += 1
    })

    // then
    expect(taskRuns).toBe(1)
    expect(existsSync(lockPath)).toBe(false)
  }, 15_000)

  it("#given a lock file owned by a live process #when the wait deadline passes #then it throws and the live lock is never stolen", async () => {
    // given
    const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-journal-lock-")))
    tempDirs.push(dir)
    const lockPath = join(dir, "state.lock")
    await writeFile(lockPath, `${process.pid}\n`, "utf8")

    // when
    let taskRuns = 0
    const failure = await withLocalJournalLock(lockPath, async () => {
      taskRuns += 1
    }).catch((error: unknown) => error)

    // then
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).name).toBe("JournalLockTimeoutError")
    expect(taskRuns).toBe(0)
    expect(await readFile(lockPath, "utf8")).toBe(`${process.pid}\n`)
  }, 15_000)
})

  it("#given a signal aborted mid-flush #when the remaining fsyncs are reached #then flush returns early without throwing", async () => {
    // given
    const { dir, journal } = await createJournal()
    await journal.reconcile([{ kind: "assistant", messageId: "assistant-1", textBlocks: ["one"] }])
    const controller = new AbortController()
    const aborting = new TranscriptJournal({
      journalDir: dir,
      lock: async (lockPath, task, signal) => withLocalJournalLock(lockPath, async () => {
        controller.abort()
        return task()
      }, signal),
    })

    // when
    await aborting.flush(controller.signal)

    // then
    expect(existsSync(join(dir, "state.lock"))).toBe(false)
  })
})

import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

import { OWNER_STALE_MS, SUMMARY_TTL_MS, summaryDir } from "./session-summary-storage"
import { createTempStateDirs } from "./session-summary.test-support"

// Crash-safety contract (plan todo 8, cases a-f), proven with real processes on real files: each fixture
// process runs the production recorder and storage, the test kills it with SIGKILL (or the fixture kills
// itself at an exact protocol step), and a later process on the same state directory must publish every
// window exactly once, under the window's own id.

const FIXTURE = join(import.meta.dir, "session-summary-process.test-support.ts")
const WAIT_MS = 15_000
const T0 = 1_700_000_000_000
const STALE = OWNER_STALE_MS + 1

const stateDirs = createTempStateDirs()
afterEach(() => stateDirs.cleanup())

type SinkRow = { readonly pid: number; readonly uuid: string; readonly properties: Record<string, unknown> }

type Fixture = {
  readonly send: (command: string) => Promise<"ok" | "exited">
  readonly kill: () => Promise<void>
  readonly close: () => Promise<void>
  readonly exited: Promise<number | null>
}

function startFixture(dir: string, now: number, mode = "ack", platform?: typeof process.platform): Fixture {
  const proc = Bun.spawn([process.execPath, FIXTURE], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
    env: { ...process.env, SUMMARY_STATE_DIR: dir, SUMMARY_SINK: join(dir, "sink.jsonl"), SUMMARY_NOW: String(now), SUMMARY_MODE: mode, ...(platform === undefined ? {} : { SUMMARY_PLATFORM: platform }) },
  })
  const lines: string[] = []
  const waiters: Array<() => void> = []
  void (async () => {
    const decoder = new TextDecoder()
    let buffered = ""
    for await (const chunk of proc.stdout) {
      buffered += decoder.decode(chunk)
      const parts = buffered.split("\n")
      buffered = parts.pop() ?? ""
      lines.push(...parts)
      for (const wake of waiters.splice(0)) wake()
    }
    for (const wake of waiters.splice(0)) wake()
  })()
  let sent = 0
  const bounded = <T>(work: Promise<T>, what: string) => Promise.race([
    work,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`waited ${WAIT_MS} ms for ${what}`)), WAIT_MS).unref()),
  ])
  const exited = proc.exited.then(() => proc.exitCode)
  return {
    exited,
    async send(command) {
      sent += 1
      const expected = `ok ${sent}`
      proc.stdin.write(`${command}\n`)
      await proc.stdin.flush()
      const answered = new Promise<"ok" | "exited">((resolve) => {
        const check = () => {
          if (lines.includes(expected)) resolve("ok")
          else if (proc.killed || proc.exitCode !== null || proc.signalCode !== null) resolve("exited")
          else waiters.push(check)
        }
        check()
        void proc.exited.then(() => waiters.push(check)).then(() => check())
      })
      return bounded(answered, `"${expected}" after "${command}"`)
    },
    async kill() {
      proc.kill("SIGKILL")
      await bounded(proc.exited, "SIGKILL to take effect")
    },
    async close() {
      proc.stdin.end()
      await bounded(proc.exited, "the fixture to exit")
    },
  }
}

function sinkRows(dir: string): SinkRow[] {
  const path = join(dir, "sink.jsonl")
  if (!existsSync(path)) return []
  return readFileSync(path, "utf8").split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line) as SinkRow)
}

function windowIdOf(dir: string, sessionHash: string): string {
  const record: unknown = JSON.parse(readFileSync(join(summaryDir(dir), `${sessionHash}.json`), "utf8"))
  const windowId: unknown = typeof record === "object" && record !== null ? Reflect.get(record, "windowId") : undefined
  if (typeof windowId !== "string") throw new Error(`no open window for ${sessionHash}`)
  return windowId
}

const pendingFiles = (dir: string) => readdirSync(join(summaryDir(dir), "pending")).filter((name) => name.endsWith(".json"))

describe("session_summary across killed processes", () => {
  test("(a) #given a process SIGKILLed mid-window #when another process starts after the stale window #then exactly one recovered row carries the window's totals and id", async () => {
    const dir = stateDirs.make()
    const first = startFixture(dir, T0)
    expect(await first.send("turn s1 0 10")).toBe("ok")
    expect(await first.send("turn s1 1 32")).toBe("ok")
    const windowId = windowIdOf(dir, "s1")
    await first.kill()

    const second = startFixture(dir, T0 + STALE)
    expect(await second.send("recover")).toBe("ok")
    const third = startFixture(dir, T0 + STALE * 2)
    expect(await third.send("recover")).toBe("ok")
    await Promise.all([second.close(), third.close()])

    const rows = sinkRows(dir)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.uuid).toBe(windowId)
    expect(rows[0]?.properties).toMatchObject({ $session_id: "s1", ended_by: "recovered", turns: 2, total_tokens: 42, summary_seq: 0 })
  })

  test.each([["the host platform", undefined], ["the win32 probe (no readable start time)", "win32" as const]])("(b) #given two live processes on one session hash on %s #when the second sweeps past the stale threshold #then it never claims the first's window", async (_label, platform) => {
    const dir = stateDirs.make()
    const owner = startFixture(dir, T0, "ack", platform)
    expect(await owner.send("turn s1 0 10")).toBe("ok")

    const other = startFixture(dir, T0 + STALE * 3, "ack", platform)
    expect(await other.send("recover")).toBe("ok")
    expect(await other.send("turn s1 5 7")).toBe("ok")
    expect(await other.send("finish s1 quit")).toBe("ok")
    expect(await owner.send("finish s1 quit")).toBe("ok")
    await Promise.all([owner.close(), other.close()])

    const rows = sinkRows(dir)
    expect(rows.map(({ properties }) => properties.ended_by)).toEqual(["shutdown", "shutdown"])
    expect(rows.map(({ properties }) => properties.total_tokens).toSorted()).toEqual([10, 7].toSorted())
    expect(new Set(rows.map(({ uuid }) => uuid)).size).toBe(2)
  })

  test("(c1) #given death immediately before the pending file is written #when a later process recovers #then the window is published once", async () => {
    const dir = stateDirs.make()
    const first = startFixture(dir, T0, "die-before-pending")
    expect(await first.send("turn s1 0 10")).toBe("ok")
    const windowId = windowIdOf(dir, "s1")
    expect(await first.send("finish s1 quit")).toBe("exited")

    for (const offset of [STALE, STALE * 2]) {
      const next = startFixture(dir, T0 + offset)
      expect(await next.send("recover")).toBe("ok")
      await next.close()
    }
    expect(sinkRows(dir).map(({ uuid, properties }) => [uuid, properties.ended_by, properties.turns])).toEqual([[windowId, "recovered", 1]])
  })

  test("(c2) #given death right after the event was sent but before its acknowledgment #when a later process starts #then the pending copy is re-sent once with the same uuid and no second window appears", async () => {
    const dir = stateDirs.make()
    const first = startFixture(dir, T0, "die-after-send")
    expect(await first.send("turn s1 0 10")).toBe("ok")
    expect(await first.send("finish s1 quit")).toBe("exited")

    for (const offset of [STALE, STALE * 2]) {
      const next = startFixture(dir, T0 + offset)
      expect(await next.send("recover")).toBe("ok")
      await next.close()
    }
    const rows = sinkRows(dir)
    expect(rows.map(({ properties }) => properties.ended_by)).toEqual(["shutdown", "shutdown"])
    expect(new Set(rows.map(({ uuid }) => uuid)).size).toBe(1)
    expect(pendingFiles(dir)).toEqual([])
  })

  test("(d) #given a transport that throws after sending #when the process exits and another starts #then the event is re-sent with the same uuid and then retired", async () => {
    const dir = stateDirs.make()
    const first = startFixture(dir, T0, "throw-after-send")
    expect(await first.send("turn s1 0 10")).toBe("ok")
    expect(await first.send("finish s1 quit")).toBe("ok")
    await first.close()
    expect(pendingFiles(dir)).toHaveLength(1)

    const next = startFixture(dir, T0 + 1)
    expect(await next.send("recover")).toBe("ok")
    await next.close()
    const rows = sinkRows(dir)
    expect(rows).toHaveLength(2)
    expect(rows[0]?.uuid).toBe(rows[1]?.uuid ?? "")
    expect(pendingFiles(dir)).toEqual([])
  })

  test("(e) #given a checkpoint before a kill #when the session resumes in a new process #then its next row has seq + 1", async () => {
    const dir = stateDirs.make()
    const first = startFixture(dir, T0)
    expect(await first.send("turn s1 0 10")).toBe("ok")
    expect(await first.send("advance 1800000")).toBe("ok")
    expect(await first.send("turn s1 1 10")).toBe("ok")
    await first.kill()

    const resumed = startFixture(dir, T0 + 1_800_000 + 1)
    expect(await resumed.send("turn s1 2 10")).toBe("ok")
    expect(await resumed.send("finish s1 quit")).toBe("ok")
    await resumed.close()
    expect(sinkRows(dir).map(({ properties }) => [properties.summary_seq, properties.ended_by])).toEqual([[0, "checkpoint"], [1, "shutdown"]])
  })

  test("(f) #given an unsent window and an unacknowledged event older than 14 days #when a process starts #then both are deleted unsent and counted as dropped", async () => {
    const dir = stateDirs.make()
    const first = startFixture(dir, T0, "throw-after-send")
    expect(await first.send("turn old 0 10")).toBe("ok")
    expect(await first.send("finish old quit")).toBe("ok")
    expect(await first.send("turn open 0 10")).toBe("ok")
    await first.kill()
    const sentBefore = sinkRows(dir).length

    const late = startFixture(dir, T0 + SUMMARY_TTL_MS + 1)
    expect(await late.send("turn fresh 0 3")).toBe("ok")
    expect(await late.send("finish fresh quit")).toBe("ok")
    await late.close()

    const after = sinkRows(dir).slice(sentBefore)
    expect(after.map(({ properties }) => [properties.$session_id, properties.dropped_events])).toEqual([["fresh", 2]])
    expect(pendingFiles(dir)).toEqual([])
  })
})

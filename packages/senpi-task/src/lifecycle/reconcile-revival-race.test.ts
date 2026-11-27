import { mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { resolveChildSessionDir } from "../runners/rpc/spawn"
import type { TaskRecordStore } from "../store"
import { cleanupProjects, seedRecord, tempStore } from "./__fixtures__/lifecycle-fakes"

afterEach(cleanupProjects)

const parentSessionId = "session-resumed"
const raceWorkerPath = resolve(import.meta.dir, "__fixtures__", "reconcile-race-worker.ts")
const WON = "resumed:respawned and reattached"
const LOST = "deferred:foreign_live_owner"

type Worker = {
  readonly pid: number
  readonly next: () => Promise<string>
  readonly release: () => void
  readonly finish: () => Promise<number>
}

// A worker can hold itself at one point of its reconcile pass until the test releases it.
type Hold = "none" | "hold-probe" | "hold-claim"

// The loser can lose the ownership race at three points: its scan already sees the live winner,
// its post-probe ownership re-read sees the winner's claim, or its ownership CAS fails after that
// re-read passed. All three are one lost race and report one outcome. The last row is the unforced
// race the three forced rows model.
const interleavings = [
  { name: "the winner claims before the loser scans", loserHold: "none", forced: true },
  { name: "the winner claims while the loser probes the dead owner", loserHold: "hold-probe", forced: true },
  {
    name: "the winner claims after the loser's ownership re-read, before its CAS",
    loserHold: "hold-claim",
    forced: true,
  },
  { name: "both are released at once", loserHold: "none", forced: false },
] as const satisfies readonly { readonly name: string; readonly loserHold: Hold; readonly forced: boolean }[]

describe("reconcileOnSessionStart scoped revival ownership race", () => {
  test.each(interleavings)(
    "#given two OS processes observe one dead-owner resident #when $name #then exactly one respawns and the loser defers",
    async ({ loserHold, forced }) => {
      // given: both workers are inside session start before either is released.
      const store = tempStore()
      const taskId = seedOrphan(store)
      const launchLog = join(store.stateDir, "race-launches.log")
      const [winner, loser] = [spawnWorker(store, launchLog, "none"), spawnWorker(store, launchLog, loserHold)]
      for (const worker of [winner, loser]) expect(await worker.next()).toBe("started")

      // when: each step awaits the exact line its worker prints at that barrier.
      let outcomes: readonly string[]
      if (!forced) {
        winner.release()
        loser.release()
        outcomes = await Promise.all([winner.next(), loser.next()])
      } else {
        if (loserHold !== "none") {
          loser.release()
          expect(await loser.next()).toBe(loserHold === "hold-probe" ? "probing" : "claiming")
        }
        winner.release()
        const won = await winner.next()
        loser.release()
        outcomes = [won, await loser.next()]
      }
      const exits = await Promise.all([winner.finish(), loser.finish()])

      // then
      const launches = readFileSync(launchLog, "utf8").trim().split("\n").filter(Boolean)
      expect(launches).toHaveLength(1)
      const [winnerOutcome, loserOutcome] = outcomes.map(outcomeOf)
      if (forced) {
        expect(winnerOutcome?.outcome).toBe(`${taskId}:${WON}`)
        expect(loserOutcome?.outcome).toBe(`${taskId}:${LOST}`)
        expect(launches).toEqual([`${winner.pid}:${taskId}`])
      } else {
        expect([winnerOutcome?.outcome, loserOutcome?.outcome].sort()).toEqual([
          `${taskId}:${LOST}`,
          `${taskId}:${WON}`,
        ])
      }
      expect(exits).toEqual([0, 0])

      // Each forced row asserts its own lose-point from the worker's barrier report (omo#11682),
      // not only the final outcome, so a barrier that silently moves fails the row.
      const SEEDED_HOST_PID = 2_147_483_647
      const SEEDED = {
        host_pid: SEEDED_HOST_PID,
        residency_state: "resident",
        residency_claim: undefined,
        updated_at: new Date(1_000_000).toISOString(),
        run_epoch: 0,
      }
      // The winner's own report: its final view is its claim, and it mutated twice (the CAS + the
      // resumed record mark). The unforced row asserts only the outcome split above.
      if (forced) expect(winnerOutcome?.report.scan?.host_pid).toBe(winner.pid)
      if (!forced) return
      if (loserHold === "none") {
        // The loser lost at its scan: its scan already saw the winner's claim, and it never mutated.
        expect(loserOutcome?.report.scan?.host_pid).toBe(winner.pid)
        expect(loserOutcome?.report.mutateCount).toBe(0)
      } else if (loserHold === "hold-probe") {
        // The loser lost at its post-probe ownership re-read: at the probe the record still matched
        // its scan, and after the probe it saw the winner's claim without ever mutating.
        expect(loserOutcome?.report.probe).toEqual(SEEDED)
        expect(loserOutcome?.report.mutateCount).toBe(0)
        expect(loserOutcome?.report.scan?.host_pid).toBe(winner.pid)
      } else {
        // The loser lost at the ownership CAS: parked at its first record mutation with the record
        // still matching its scan, and the mutation found the winner's claim. Exactly two mutations
        // today (the CAS plus the deferral mark), so an earlier store.mutate added before the CAS
        // moves the barrier and fails this row.
        expect(loserOutcome?.report.claim?.before).toEqual(SEEDED)
        expect(loserOutcome?.report.claim?.after?.host_pid).toBe(winner.pid)
        expect(loserOutcome?.report.mutateCount).toBe(2)
      }
    },
    20_000,
  )
})

function seedOrphan(store: TaskRecordStore): string {
  const seeded = seedRecord(store, {
    task_id: "st_10000014",
    parent_session_id: parentSessionId,
    status: "running",
    residency_state: "resident",
    execution_mode: "in-process",
    host_pid: 2_147_483_647,
    updated_at: new Date(1_000_000).toISOString(),
  })
  store.replace({ ...seeded, spawn_spec: { version: 1, cwd: "/tmp/project", prompt: `prompt:${seeded.task_id}` } })
  const directory = resolveChildSessionDir(join(store.stateDir, "children", seeded.task_id), seeded.task_id)
  mkdirSync(directory, { recursive: true })
  const transcript = join(directory, "resume.jsonl")
  writeFileSync(transcript, "{}\n")
  utimesSync(transcript, new Date(2_000), new Date(2_000))
  return seeded.task_id
}

function spawnWorker(store: TaskRecordStore, launchLog: string, hold: Hold): Worker {
  const child = Bun.spawn(
    [process.execPath, raceWorkerPath, store.stateDir, parentSessionId, launchLog, ...(hold === "none" ? [] : [hold])],
    { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
  )
  const read = lineReader(child.stdout)
  const stderr = new Response(child.stderr).text()
  return {
    pid: child.pid,
    next: () => withTimeout(read(), 10_000, `worker ${child.pid} line`),
    release: () => {
      child.stdin.write("g")
      child.stdin.flush()
    },
    finish: async () => {
      child.stdin.write("x")
      child.stdin.end()
      const code = await child.exited
      if (code !== 0) throw new Error(`worker ${child.pid} exited ${code}: ${await stderr}`)
      return code
    },
  }
}

function outcomeOf(line: string): {
  readonly outcome: string
  readonly report: {
    readonly scan?: Observation
    readonly probe?: Observation
    readonly claim?: { readonly before?: Observation; readonly after?: Observation }
    readonly mutateCount: number
  }
} {
  const result = JSON.parse(line) as {
    readonly outcomes: readonly { readonly task_id: string; readonly kind: string; readonly reason?: string }[]
    readonly report?: {
      readonly scan?: Observation
      readonly probe?: Observation
      readonly claim?: { readonly before?: Observation; readonly after?: Observation }
      readonly mutateCount?: number
    }
  }
  expect(result.outcomes).toHaveLength(1)
  const [outcome] = result.outcomes
  return {
    outcome: `${outcome?.task_id}:${outcome?.kind}:${outcome?.reason}`,
    report: {
      scan: result.report?.scan,
      probe: result.report?.probe,
      claim: result.report?.claim,
      mutateCount: result.report?.mutateCount ?? -1,
    },
  }
}

type Observation = {
  readonly host_pid: number | undefined
  readonly residency_state: string
  readonly residency_claim: string | undefined
  readonly updated_at: string
  readonly run_epoch: number
}

function lineReader(stream: ReadableStream<Uint8Array>): () => Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffered = ""
  return async () => {
    for (;;) {
      const newline = buffered.indexOf("\n")
      if (newline >= 0) {
        const line = buffered.slice(0, newline)
        buffered = buffered.slice(newline + 1)
        return line
      }
      const next = await reader.read()
      if (next.done) throw new Error("worker stdout ended before the expected line")
      buffered += decoder.decode(next.value, { stream: true })
    }
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

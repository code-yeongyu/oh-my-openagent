/// <reference types="bun-types" />

import { afterEach, describe, expect, spyOn, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Worker } from "node:worker_threads"

import { claimOnboardingOwned, readOnboardingState, type ClaimOwnerSeams } from "./claim-owner"

// A dead claim taken over by N claimants at once (#10481 review LOW 1). Two claimants run on this
// thread with every fs step they make in the state dir intercepted; the others run the real claim on
// worker threads and are released, one at a time and to completion, into the gap before a chosen
// step. Sweeping the gap over every step makes each interleaving deterministic.
const NOW = Date.parse("2026-10-19T00:00:00.000Z")
const DEAD_OWNER = 4242
const SIGNAL_TIMEOUT_MS = 10_000
const contenderPath = new URL("./claim-takeover-contender.ts", import.meta.url).href

const realFs = {
  readFileSync: fs.readFileSync,
  renameSync: fs.renameSync,
  linkSync: fs.linkSync,
  unlinkSync: fs.unlinkSync,
  writeFileSync: fs.writeFileSync,
}

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

interface ThreadContender {
  readonly pid: number
  readonly worker: Worker
  readonly signal: Int32Array
  released: boolean
}

interface Outcome {
  readonly winners: number[]
  readonly violations: string[]
  readonly finalOwner: unknown
  readonly inProgress: boolean
}

function aliveMap(pids: readonly number[]): Record<number, string> {
  return Object.fromEntries(pids.map((pid) => [pid, `proc-start-epoch:${pid}`]))
}

function seamsFor(pid: number, alive: Record<number, string>): ClaimOwnerSeams {
  return {
    pid,
    getPidLiveness: (probed) => (probed in alive ? "alive" : "dead"),
    getProcessStartIdentity: async (probed) => alive[probed] ?? null,
    now: () => NOW,
  }
}

async function startThreadContender(stateDir: string, pid: number, alive: Record<number, string>): Promise<ThreadContender> {
  const signal = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2))
  const worker = new Worker(new URL(contenderPath), { workerData: { stateDir, pid, alive, now: NOW, signal: signal.buffer } })
  await new Promise<void>((resolve, reject) => {
    worker.once("message", () => resolve())
    worker.once("error", reject)
  })
  return { pid, worker, signal, released: false }
}

function runToCompletion(contender: ThreadContender): boolean {
  contender.released = true
  Atomics.store(contender.signal, 0, 1)
  Atomics.notify(contender.signal, 0)
  while (Atomics.load(contender.signal, 1) === 0) {
    if (Atomics.wait(contender.signal, 1, 0, SIGNAL_TIMEOUT_MS) === "timed-out") throw new Error(`contender ${contender.pid} did not finish`)
  }
  return Atomics.load(contender.signal, 1) === 1
}

/**
 * Runs one interleaving: `inThread` claimants on this thread, plus thread claimants released before
 * the fs step numbered in `releaseAt` (or at the end when the run has fewer steps). The marker is
 * observed after every step: once a live claimant's claim lands, it must stay there, byte for byte.
 */
async function runInterleaving(inThread: readonly number[], threaded: readonly number[], releaseAt: readonly number[]): Promise<Outcome & { steps: number }> {
  const stateDir = fs.mkdtempSync(join(tmpdir(), "omo-claim-takeover-"))
  dirs.push(stateDir)
  const marker = join(stateDir, "onboarding-completed")
  realFs.writeFileSync(marker, JSON.stringify({ claimedAt: new Date(NOW).toISOString(), version: 2, owner: { pid: DEAD_OWNER, processStart: "proc-start-epoch:1" }, nonce: "dead" }))
  const alive = aliveMap([...inThread, ...threaded])
  const contenders = await Promise.all(threaded.map((pid) => startThreadContender(stateDir, pid, alive)))
  const winners: number[] = []
  const violations: string[] = []
  let held: string | null = null
  let step = 0

  const observe = (when: string): void => {
    let current: string | null
    try {
      current = realFs.readFileSync(marker, "utf8")
    } catch {
      current = null
    }
    if (held !== null && current !== held) {
      violations.push(`${when}: the live claim ${held} was ${current === null ? "removed (marker absent)" : `replaced by ${current}`}`)
    }
    if (held === null && current !== null && current.includes("\"pid\":") && !current.includes(`"pid":${DEAD_OWNER}`)) held = current
  }
  const releaseDue = (): void => {
    contenders.forEach((contender, index) => {
      if (contender.released || releaseAt[index] !== step) return
      if (runToCompletion(contender)) winners.push(contender.pid)
      observe(`after thread claimant ${contender.pid} ran before step ${step}`)
    })
  }
  const intercept = <K extends "renameSync" | "linkSync" | "unlinkSync" | "writeFileSync">(name: K) =>
    spyOn(fs, name).mockImplementation(((...args: unknown[]) => {
      const inStateDir = args.some((arg) => typeof arg === "string" && arg.startsWith(stateDir))
      if (inStateDir) releaseDue()
      try {
        return Reflect.apply(realFs[name], fs, args)
      } finally {
        if (inStateDir) {
          observe(`after step ${step} (${name})`)
          step += 1
        }
      }
    }) as never)

  const spies = [intercept("renameSync"), intercept("linkSync"), intercept("unlinkSync"), intercept("writeFileSync")]
  try {
    const results = await Promise.all(inThread.map((pid) => claimOnboardingOwned(stateDir, seamsFor(pid, alive))))
    results.forEach((won, index) => { if (won) winners.push(inThread[index]!) })
  } finally {
    for (const spy of spies) spy.mockRestore()
  }
  const steps = step
  for (const contender of contenders) {
    if (contender.released) continue
    if (runToCompletion(contender)) winners.push(contender.pid)
    observe(`after thread claimant ${contender.pid} ran at the end`)
  }
  await Promise.all(contenders.map((contender) => contender.worker.terminate()))

  let finalOwner: unknown = null
  try {
    finalOwner = (JSON.parse(realFs.readFileSync(marker, "utf8")) as { owner?: { pid?: unknown } }).owner?.pid ?? null
  } catch {
    finalOwner = null
  }
  const { inProgress } = await readOnboardingState(stateDir, seamsFor(1, alive))
  return { winners, violations, finalOwner, inProgress, steps }
}

async function sweep(inThread: readonly number[], threaded: readonly number[], schedule: (gap: number) => number[]): Promise<string[]> {
  const failures: string[] = []
  for (let gap = 0; gap < 64; gap += 1) {
    const releaseAt = schedule(gap)
    const outcome = await runInterleaving(inThread, threaded, releaseAt)
    const label = `release before steps [${releaseAt.join(", ")}]`
    if (outcome.winners.length !== 1) failures.push(`${label}: ${outcome.winners.length} winners (${outcome.winners.join(", ")})`)
    else if (outcome.finalOwner !== outcome.winners[0]) failures.push(`${label}: winner ${outcome.winners[0]} but the marker names ${String(outcome.finalOwner)}`)
    if (!outcome.inProgress) failures.push(`${label}: the state reads not in progress while ${outcome.winners.join(", ")} holds the claim`)
    for (const violation of outcome.violations) failures.push(`${label}: ${violation}`)
    if (Math.min(...releaseAt) >= outcome.steps) return failures
  }
  failures.push("the sweep never reached the end of the interleaving")
  return failures
}

describe("dead onboarding claim takeover by many claimants", () => {
  test("#given a dead claim #when three processes claim at once, the third landing at any step of the others' takeover #then exactly one wins and its claim is never removed or replaced", async () => {
    const failures = await sweep([5101, 5102], [5103], (gap) => [gap])
    expect(failures).toEqual([])
  }, 60_000)

  test("#given a dead claim #when five processes claim at once, three landing together or one after another at any step #then exactly one wins and its claim is never removed or replaced", async () => {
    const together = await sweep([5201, 5202], [5203, 5204, 5205], (gap) => [gap, gap, gap])
    const staggered = await sweep([5301, 5302], [5303, 5304, 5305], (gap) => [gap, gap + 1, gap + 2])
    expect([...together, ...staggered]).toEqual([])
  }, 120_000)
})

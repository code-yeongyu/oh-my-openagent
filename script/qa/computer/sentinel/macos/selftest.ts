import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { hostname } from "node:os"

import { admitWindow, type LatencyRecord, p99 } from "../latency.ts"
import { observeCell } from "../observe-cell.ts"
import { judgeAxSheetTrial, judgeSelfTest, observerFailureLines, PLANT_NOUN, type Trial } from "../selftest-judge.ts"
import { dialogHits, SIGNALS, type Signal } from "../summary.ts"
import { withSentinel } from "../with-sentinel.ts"
import { plant } from "./plants.ts"
import { type HelperPaths, MacSession } from "./session.ts"
import { ensureSecondSpace } from "./spaces.ts"

type SelfTestOptions = {
  readonly helpers: HelperPaths
  readonly windowMs: number
  readonly calibrationTrials: number
  readonly latencyFile: string
  readonly drop?: Signal
}

async function trial(
  session: MacSession,
  which: Signal | null,
  options: SelfTestOptions,
): Promise<Trial & { latency?: number }> {
  const run = await withSentinel(
    `selftest-${which ?? "null"}`,
    async () => (which === null ? undefined : plant(session, options.helpers, which)),
    { session, windowMs: options.windowMs, ...(options.drop === undefined ? {} : { drop: options.drop }) },
  )
  const { result: outcome, summary } = run
  if (which === null) return { plant: null, summary }
  if (outcome === undefined) return { plant: which, failed: "plant never ran" }
  if ("failed" in outcome) return { plant: which, failed: outcome.failed }
  const firstAt = summary.signals[which].firstAt
  return firstAt === null ? { plant: which, summary } : { plant: which, summary, latency: firstAt - outcome.plantedAt }
}

async function calibrate(session: MacSession, options: SelfTestOptions): Promise<LatencyRecord> {
  const p99Ms: Record<string, number> = {}
  for (const signal of SIGNALS) {
    const latencies: number[] = []
    for (let index = 0; index < options.calibrationTrials; index++) {
      const result = await trial(session, signal, options)
      if (result.latency !== undefined) latencies.push(result.latency)
    }
    const noun = PLANT_NOUN[signal]
    if (latencies.length === 0) {
      console.log(
        `SENTINEL_CALIBRATION ${signal} missed the planted ${noun} in all ${options.calibrationTrials} trials`,
      )
      continue
    }
    p99Ms[noun] = Math.round(p99(latencies))
    console.log(
      `SENTINEL_CALIBRATION ${signal} p99_ms=${p99Ms[noun]} detected=${latencies.length}/${options.calibrationTrials}`,
    )
  }
  const record: LatencyRecord = { host: hostname(), os: "macos", trials: options.calibrationTrials, p99Ms }
  writeFileSync(options.latencyFile, `${JSON.stringify(record, null, 2)}\n`)
  return record
}

function recordedLatency(file: string): LatencyRecord | undefined {
  if (!existsSync(file)) return undefined
  const value: unknown = JSON.parse(readFileSync(file, "utf8"))
  if (typeof value !== "object" || value === null || !("p99Ms" in value) || !("host" in value)) return undefined
  const { host, p99Ms } = value
  if (typeof host !== "string" || typeof p99Ms !== "object" || p99Ms === null) return undefined
  const entries = Object.entries(p99Ms).filter((entry): entry is [string, number] => typeof entry[1] === "number")
  return { host, os: "macos", trials: 0, p99Ms: Object.fromEntries(entries) }
}

// The dialog detector has three branches: a modal-panel window layer (the alert plant), a sheet-created notification,
// and the AX role/subrole read of a new window. This trial plants a layer-0 sheet while the planter blocks, and counts
// as a dialog detection only when the role read saw it after at least one retried read - so a dead AX read or retry
// path fails the self-test instead of hiding behind the layer or notification branch.
async function axOnlyDialogTrial(session: MacSession, options: SelfTestOptions): Promise<Trial> {
  const run = await withSentinel("selftest-dialog-ax", () => plant(session, options.helpers, "sheet"), {
    session,
    windowMs: options.windowMs,
    ...(options.drop === undefined ? {} : { drop: options.drop }),
  })
  if ("failed" in run.result) return { plant: "dialog", failed: `AX-only sheet: ${run.result.failed}` }
  const hits = dialogHits(run.events)
  const shown = hits.map((hit) => `${hit.branch}:${hit.axReads ?? "-"}`).join(",") || "none"
  console.log(`SENTINEL_DIALOG_BRANCH sheet hits=${shown}`)
  const unproven = options.drop === "dialog" ? undefined : judgeAxSheetTrial(hits)
  if (unproven !== undefined) return { plant: "dialog", failed: unproven }
  return { plant: "dialog", summary: run.summary }
}

export async function runSelfTest(options: SelfTestOptions): Promise<{ exitCode: number; receipts: string[] }> {
  const session = await MacSession.open({
    helpers: options.helpers,
    targetPids: [],
    withPlanter: true,
    beforeTypist: async (opened) => {
      const spaces = await ensureSecondSpace(opened)
      console.log(`SENTINEL_SETUP spaces=${spaces}`)
    },
  })
  try {
    const latency = recordedLatency(options.latencyFile) ?? (await calibrate(session, options))
    const admission = admitWindow(options.windowMs, latency)
    if (!admission.ok) {
      console.log(`sentinel: refusing to judge negatives: ${admission.reason}`)
      return { exitCode: 2, receipts: await session.close() }
    }
    const trials: Trial[] = [await trial(session, null, options)]
    for (const signal of SIGNALS) trials.push(await trial(session, signal, options))
    trials.push(await axOnlyDialogTrial(session, options))
    const control = await observeCell(session, () => plant(session, options.helpers, "warp"), options.windowMs)
    const status = "failed" in control.status ? `failed: ${control.status.failed}` : "planted"
    console.log(`SENTINEL_OBSERVER negative_control=${status} pointer_moved=${control.observed.pointerMoved}`)
    const unregistered = session.events.filter((event) => event.kind === "observer_failed").length
    const lateRegistered = session.events.filter((event) => event.kind === "observer_late").length
    console.log(`SENTINEL_OBSERVERS failed=${unregistered} late=${lateRegistered}`)
    for (const line of observerFailureLines(session.events)) console.log(line)
    const result = judgeSelfTest(trials, control.observed.signals)
    for (const line of result.lines) console.log(line)
    return { exitCode: result.exitCode, receipts: await session.close() }
  } catch (error) {
    const receipts = await session.close()
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { receipts })
  }
}

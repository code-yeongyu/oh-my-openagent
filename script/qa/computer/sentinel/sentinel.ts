// The disturbance sentinel's driver.
//   bun script/qa/computer/sentinel/sentinel.ts --self-test --os macos [--sabotage drop-detector=<signal>]
//       [--window-ms <n>] [--calibration-trials <n>] [--latency-file <path>]
// `withSentinel(scenario, fn, options)` runs one scenario while the synthetic user types and returns the eight signals.
// It only runs in a disposable QA desktop session (OMO_COMPUTER_QA_SESSION=1), never in a person's session.

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { admitWindow, type LatencyRecord } from "./latency.ts"
import { buildHelpers } from "./macos/build.ts"
import { runSelfTest } from "./macos/selftest.ts"
import { type HelperPaths, MacSession } from "./macos/session.ts"
import { formatSignals, type SentinelSummary, SIGNALS, type Signal, summarize, type Verdict, verdict } from "./summary.ts"

const USAGE =
  "usage: bun script/qa/computer/sentinel/sentinel.ts --self-test --os macos [--sabotage drop-detector=<signal>] [--window-ms <n>] [--calibration-trials <n>] [--latency-file <path>]"
const DEFAULT_WINDOW_MS = 3_000
const DEFAULT_CALIBRATION_TRIALS = 5

export type SentinelRun<T> = { readonly result: T; readonly summary: SentinelSummary; readonly verdict: Verdict }

export type SentinelOptions = {
  readonly helpers: HelperPaths
  readonly latency: LatencyRecord
  readonly targetPids: readonly number[]
  readonly windowMs?: number
}

function qaSessionRefusal(os: string): string | undefined {
  if (os !== "macos") return `the ${os} sentinel is not part of this driver yet; only --os macos is built`
  if (process.platform !== "darwin") return `--os macos needs a macOS QA session; this host is ${process.platform}`
  if (process.env.OMO_COMPUTER_QA_SESSION !== "1")
    return "refusing to run outside a disposable QA desktop session (OMO_COMPUTER_QA_SESSION=1)"
  return undefined
}

export async function withSentinel<T>(
  scenario: string,
  fn: () => Promise<T>,
  options: SentinelOptions,
): Promise<SentinelRun<T>> {
  const refusal = qaSessionRefusal("macos")
  if (refusal !== undefined) throw new Error(`sentinel: ${refusal}`)
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS
  const admission = admitWindow(windowMs, options.latency)
  if (!admission.ok) throw new Error(`sentinel: ${admission.reason}`)
  const session = await MacSession.open({ helpers: options.helpers, targetPids: options.targetPids, withPlanter: false })
  try {
    let result: { readonly value: T } | undefined
    const events = await session.segment(async () => {
      result = { value: await fn() }
    }, windowMs)
    if (result === undefined) throw new Error(`sentinel: scenario ${scenario} never completed`)
    const summary = summarize(events)
    const judged = verdict(summary)
    console.log(`SENTINEL ${scenario} verdict=${judged} ${formatSignals(summary)}`)
    return { result: result.value, summary, verdict: judged }
  } finally {
    console.log((await session.close()).join("\n"))
  }
}

type Cli = {
  readonly os: string
  readonly drop: Signal | undefined
  readonly windowMs: number
  readonly calibrationTrials: number
  readonly latencyFile: string | undefined
}

const isSignal = (value: string): value is Signal => SIGNALS.some((signal) => signal === value)

function parseCli(argv: readonly string[]): Cli | string {
  const value = (flag: string): string | undefined => {
    const index = argv.indexOf(flag)
    return index >= 0 ? argv[index + 1] : undefined
  }
  if (!argv.includes("--self-test")) return USAGE
  const os = value("--os")
  if (os === undefined) return USAGE
  const sabotage = value("--sabotage")
  let drop: Signal | undefined
  if (sabotage !== undefined) {
    const signal = /^drop-detector=(.+)$/.exec(sabotage)?.[1] ?? ""
    if (!isSignal(signal)) return `unknown sabotage '${sabotage}'; use drop-detector=<${SIGNALS.join("|")}>`
    drop = signal
  }
  const windowMs = Number(value("--window-ms") ?? DEFAULT_WINDOW_MS)
  const calibrationTrials = Number(value("--calibration-trials") ?? DEFAULT_CALIBRATION_TRIALS)
  if (!Number.isInteger(windowMs) || windowMs <= 0 || !Number.isInteger(calibrationTrials) || calibrationTrials <= 0)
    return USAGE
  return { os, drop, windowMs, calibrationTrials, latencyFile: value("--latency-file") }
}

async function main(argv: readonly string[]): Promise<number> {
  const cli = parseCli(argv)
  if (typeof cli === "string") {
    console.error(cli)
    return 2
  }
  const refusal = qaSessionRefusal(cli.os)
  if (refusal !== undefined) {
    console.error(`sentinel: ${refusal}`)
    return 2
  }
  const runDir = mkdtempSync(join(tmpdir(), "omo-sentinel-"))
  let receipts: readonly string[] = []
  try {
    const helpers = await buildHelpers(runDir)
    const outcome = await runSelfTest({
      helpers,
      windowMs: cli.windowMs,
      calibrationTrials: cli.calibrationTrials,
      latencyFile: cli.latencyFile ?? join(runDir, "latency-macos.json"),
      ...(cli.drop === undefined ? {} : { drop: cli.drop }),
    })
    receipts = outcome.receipts
    return outcome.exitCode
  } catch (error) {
    if (error instanceof Error && "receipts" in error && Array.isArray(error.receipts)) receipts = error.receipts.map(String)
    console.error(`sentinel: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  } finally {
    rmSync(runDir, { recursive: true, force: true })
    for (const receipt of receipts) console.log(receipt)
    console.log(`dir REMOVED ${runDir}`)
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)))

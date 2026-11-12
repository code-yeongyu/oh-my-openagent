// The disturbance sentinel's driver.
//   bun script/qa/computer/sentinel/sentinel.ts --self-test --os macos [--sabotage drop-detector=<signal>]
//       [--window-ms <n>] [--calibration-trials <n>] [--latency-file <path>]
// Scenarios run under the sentinel through `withSentinel` (with-sentinel.ts). The driver only runs in a disposable QA
// desktop session (OMO_COMPUTER_QA_SESSION=1), never in a person's session.

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildHelpers } from "./macos/build.ts"
import { runSelfTest } from "./macos/selftest.ts"
import { SIGNALS, type Signal } from "./summary.ts"

const USAGE =
  "usage: bun script/qa/computer/sentinel/sentinel.ts --self-test --os macos [--sabotage drop-detector=<signal>] [--window-ms <n>] [--calibration-trials <n>] [--latency-file <path>]"
const DEFAULT_WINDOW_MS = 3_000
const DEFAULT_CALIBRATION_TRIALS = 5

const RECORDED_OSES: readonly string[] = ["macos"]

// Whether this sentinel has a recorder for the OS. A consumer writes its eight signals as not_observed where this is
// false, never none: an OS without a recorder observed nothing.
export function recordsOn(os: string): boolean {
  return RECORDED_OSES.includes(os)
}

function qaSessionRefusal(os: string): string | undefined {
  if (!recordsOn(os)) return `the ${os} sentinel has no recorder yet; it records on ${RECORDED_OSES.join(", ")}`
  if (process.platform !== "darwin") return `--os macos needs a macOS QA session; this host is ${process.platform}`
  if (process.env.OMO_COMPUTER_QA_SESSION !== "1")
    return "refusing to run outside a disposable QA desktop session (OMO_COMPUTER_QA_SESSION=1)"
  return undefined
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
    if (error instanceof Error && "receipts" in error && Array.isArray(error.receipts))
      receipts = error.receipts.map(String)
    console.error(`sentinel: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  } finally {
    rmSync(runDir, { recursive: true, force: true })
    for (const receipt of receipts) console.log(receipt)
    console.log(`dir REMOVED ${runDir}`)
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)))

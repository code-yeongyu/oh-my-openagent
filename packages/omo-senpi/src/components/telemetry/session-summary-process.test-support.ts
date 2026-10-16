import { appendFileSync } from "node:fs"
import { createInterface } from "node:readline"

import { createSessionSummaryRecorder } from "./omo-native-session-summary"
import { currentProcessOwner } from "./session-summary-owner"
import { createSummaryStorage, type SummaryStorage } from "./session-summary-storage"
import { summaryTurn } from "./session-summary.test-support"

// A real OmO-like process for the crash tests: the real recorder and storage on real files, with an
// injected clock and a publish that appends to a sink file. Driven over stdin, one command per line, and
// it answers `ok <n>` after command n has fully settled, so the test never sleeps or polls.
//   turn <session> <turnIndex> <totalTokens>   finish <session> <reason>   advance <ms>   heartbeat   recover
// SUMMARY_MODE: ack | throw-after-send | die-after-send | die-before-pending

const stateDir = requiredEnv("SUMMARY_STATE_DIR")
const sink = requiredEnv("SUMMARY_SINK")
const mode = process.env["SUMMARY_MODE"] ?? "ack"
let clock = Number(requiredEnv("SUMMARY_NOW"))
let heartbeat: (() => void) | undefined

const realStorage = createSummaryStorage({ stateDir, owner: currentProcessOwner(), now: () => clock })
const storage: SummaryStorage = mode === "die-before-pending"
  ? { ...realStorage, writePending: () => process.kill(process.pid, "SIGKILL") }
  : realStorage

const summary = createSessionSummaryRecorder({
  consentScope: () => ({ cwd: "/repo" }),
  storage,
  sessionRole: "root",
  sampleRate: () => 0.05,
  now: () => clock,
  scheduleHeartbeat: (tick) => {
    heartbeat = tick
    return () => {
      heartbeat = undefined
    }
  },
  publish: async ({ uuid, properties }) => {
    appendFileSync(sink, `${JSON.stringify({ pid: process.pid, uuid, properties })}\n`)
    if (mode === "die-after-send") process.kill(process.pid, "SIGKILL")
    if (mode === "throw-after-send") throw new Error("acknowledgment lost")
    return true
  },
})

let count = 0
for await (const line of createInterface({ input: process.stdin })) {
  const [command, first, second, third] = line.trim().split(/\s+/)
  if (command === "turn") {
    await summary.recordTurn(first ?? "s1", summaryTurn({ turnIndex: Number(second), totalTokens: Number(third ?? 40) }))
  } else if (command === "finish") {
    await summary.finish(first ?? "s1", second)
  } else if (command === "advance") {
    clock += Number(first)
  } else if (command === "heartbeat") {
    heartbeat?.()
  } else if (command === "recover") {
    await summary.recover()
  }
  count += 1
  process.stdout.write(`ok ${count}\n`)
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`)
  return value
}

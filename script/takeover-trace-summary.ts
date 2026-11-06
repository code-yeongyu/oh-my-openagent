// Summarizes the OMO_TAKEOVER_TRACE timelines written by the memory-takeover-trace workflow (#10959) into one
// markdown table of phase durations per run, so the Windows-vs-baseline difference can be read from the job summary.
// Usage: bun script/takeover-trace-summary.ts <dir with run-*.jsonl> [os label]

import { readdirSync } from "node:fs"
import { join } from "node:path"

import { readTakeoverTrace, type TakeoverTraceEvent } from "../packages/memory-core/src/concurrency/takeover-trace.test-support"

type RunSummary = {
  readonly run: string
  readonly result: string
  readonly killToExitMs: number | undefined
  readonly deathProofMs: number | undefined
  readonly takeoverMs: number | undefined
  readonly commitMedianMs: number | undefined
  readonly commitMaxMs: number | undefined
  readonly recoveryTotalMs: number | undefined
  readonly earlyExits: string
}

const at = (events: readonly TakeoverTraceEvent[], actor: string, event: string): TakeoverTraceEvent | undefined =>
  events.find((entry) => entry.actor === actor && entry.event === event)
const gap = (from: TakeoverTraceEvent | undefined, to: TakeoverTraceEvent | undefined): number | undefined =>
  from === undefined || to === undefined ? undefined : Math.round(to.t - from.t)
const median = (values: readonly number[]): number | undefined => {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]
}

function summarize(run: string, events: readonly TakeoverTraceEvent[]): RunSummary {
  const killSent = at(events, "test", "kill-sent")
  const survivorCommits = events
    .filter((event) => event.actor === "survivor" && event.event === "commit-end")
    .map((event) => Number(event.detail?.["ms"] ?? 0))
  const takeover = events.find((event) => event.actor === "survivor" && event.event === "acquired" && event.detail?.["tookOverDeadOwnerPid"] !== null)
  const earlyExits = events
    .filter((event) => event.actor === "test" && event.event.endsWith("-exit") && (killSent === undefined || event.t < killSent.t))
    .map((event) => `${event.event.replace(/-exit$/, "")} ${JSON.stringify({ code: event.detail?.["code"], signal: event.detail?.["signal"] })}`)
  const selfExited = new Set(events.filter((event) => event.event === "exit").map((event) => event.actor))
  const silentlyGone = earlyExits.filter((entry) => !selfExited.has(entry.split(" ")[0] ?? ""))
  return {
    run,
    result: at(events, "test", "passed") !== undefined ? "pass" : at(events, "test", "failed") !== undefined ? "FAIL" : "no verdict",
    killToExitMs: gap(killSent, at(events, "test", "holder-exit")),
    deathProofMs: Number.isFinite(Number(at(events, "test", "death-proof")?.detail?.["ms"])) ? Number(at(events, "test", "death-proof")?.detail?.["ms"]) : undefined,
    takeoverMs: takeover === undefined ? undefined : Number(takeover.detail?.["ms"]),
    commitMedianMs: median(survivorCommits),
    commitMaxMs: survivorCommits.length === 0 ? undefined : Math.max(...survivorCommits),
    recoveryTotalMs: gap(at(events, "survivor", "begin-recovery"), at(events, "test", "survivor-done")),
    earlyExits: earlyExits.length === 0 ? "" : `${earlyExits.join("; ")}${silentlyGone.length > 0 ? " (no own exit line: terminated from outside)" : ""}`,
  }
}

const [dir, label = ""] = process.argv.slice(2)
if (dir === undefined) throw new Error("usage: bun script/takeover-trace-summary.ts <trace dir> [os label]")
const runs = readdirSync(dir).filter((name) => /^run-\d+\.jsonl$/.test(name)).sort((left, right) => Number(left.match(/\d+/)?.[0]) - Number(right.match(/\d+/)?.[0]))
const cell = (value: number | string | undefined): string => (value === undefined || value === "" ? "-" : String(value))
const rows = runs.map((name) => summarize(name.replace(/\.jsonl$/, ""), readTakeoverTrace(join(dir, name))))
console.log(`### SIGKILL takeover trace ${label} (#10959): ${String(rows.filter((row) => row.result === "pass").length)}/${String(rows.length)} passed\n`)
console.log("| run | result | kill->exit ms | death proof ms | takeover acquire ms | survivor commit median ms | max ms | recovery total ms | early exits |")
console.log("|---|---|---|---|---|---|---|---|---|")
for (const row of rows) {
  console.log(`| ${row.run} | ${row.result} | ${cell(row.killToExitMs)} | ${cell(row.deathProofMs)} | ${cell(row.takeoverMs)} | ${cell(row.commitMedianMs)} | ${cell(row.commitMaxMs)} | ${cell(row.recoveryTotalMs)} | ${cell(row.earlyExits)} |`)
}

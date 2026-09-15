#!/usr/bin/env node
// summarize.mjs <probe.jsonl> <out.json> <out.md>
// Reduces the listener-probe JSONL into per-process cap values, warning counts,
// and a per-event listener-count table (start / peak / after cleanup).
import fs from "node:fs"

const [, , input, outJson, outMd] = process.argv
const lines = fs.readFileSync(input, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
const WATCHED = ["exit", "beforeExit", "SIGINT", "SIGTERM", "SIGHUP", "uncaughtException", "unhandledRejection", "warning"]
const PHASES = ["startup", "sessions-active", "sessions-deleted", "cli-run", "disposed", "shutdown"]

const byPid = new Map()
for (const r of lines) {
  if (!byPid.has(r.pid)) byPid.set(r.pid, [])
  byPid.get(r.pid).push(r)
}

function maxOf(records, name) {
  return records.reduce((m, r) => Math.max(m, r.counts?.[name] ?? 0), 0)
}
function summarizePid(pid, records) {
  const caps = [...new Set(records.map((r) => r.maxListeners))]
  const importRec = records.find((r) => r.kind === "module-import")
  const initRec = records.find((r) => r.kind === "server-init")
  const exitRec = records.find((r) => r.kind === "process-exit")
  const disposeRecs = records.filter((r) => r.kind === "dispose")
  const leakRec = records.find((r) => r.kind === "leak-injected")
  const warnings = records.filter((r) => r.kind === "process-warning")
  const maxWarnings = warnings.filter((r) => r.isMaxListenersExceeded)
  const eventKinds = records.filter((r) => r.kind === "event").length
  const isServe = records.some((r) => PHASES.includes(r.phase) && r.phase !== "cli-run")
  const perEvent = {}
  for (const name of WATCHED) {
    const row = {
      moduleImport: importRec?.counts?.[name] ?? null,
      serverInit: initRec?.counts?.[name] ?? null,
      peakOverall: maxOf(records.filter((r) => r.kind !== "process-exit"), name),
    }
    for (const ph of PHASES) {
      const recs = records.filter((r) => r.phase === ph && r.kind !== "process-exit")
      if (recs.length === 0) continue
      row[`peak:${ph}`] = maxOf(recs, name)
      row[`last:${ph}`] = recs[recs.length - 1].counts?.[name] ?? null
    }
    row.processExit = exitRec?.counts?.[name] ?? null
    perEvent[name] = row
  }
  const eventNamesCount = {
    moduleImport: importRec?.eventNamesCount ?? null,
    serverInit: initRec?.eventNamesCount ?? null,
    peak: records.reduce((m, r) => Math.max(m, r.eventNamesCount ?? 0), 0),
    processExit: exitRec?.eventNamesCount ?? null,
  }
  return {
    pid,
    role: isServe ? "opencode serve" : "opencode run",
    argv1: records[0]?.argv1 ?? null,
    records: records.length,
    eventHookCalls: eventKinds,
    disposeHookCalls: disposeRecs.length,
    leakControl: leakRec
      ? {
          injected: leakRec.leaked,
          sighupAfterInjection: leakRec.counts?.SIGHUP ?? null,
          sighupAfterDispose: disposeRecs[0]?.counts?.SIGHUP ?? null,
          removedAtDispose: disposeRecs[0]?.leakRemoved ?? null,
        }
      : null,
    capValuesSeen: caps,
    capAtModuleImport: importRec?.maxListeners ?? null,
    capAtServerInit: initRec?.maxListeners ?? null,
    capAtExit: exitRec?.maxListeners ?? null,
    warningsTotal: warnings.length,
    maxListenersExceededWarnings: maxWarnings.length,
    maxListenersExceededMessages: maxWarnings.map((r) => r.warningMessage),
    otherWarnings: warnings.filter((r) => !r.isMaxListenersExceeded).map((r) => `${r.warningName}: ${r.warningMessage}`),
    eventNamesCount,
    perEvent,
    firstSample: records[0]?.t ?? null,
    lastSample: records[records.length - 1]?.t ?? null,
  }
}

const processes = [...byPid.entries()].map(([pid, recs]) => summarizePid(pid, recs))
processes.sort((a, b) => (a.role === b.role ? 0 : a.role === "opencode serve" ? -1 : 1))
const summary = {
  input: input.split("/").pop(),
  totalRecords: lines.length,
  processes,
  totals: {
    maxListenersExceededWarnings: processes.reduce((s, p) => s + p.maxListenersExceededWarnings, 0),
    capValuesSeen: [...new Set(processes.flatMap((p) => p.capValuesSeen))],
  },
}
fs.writeFileSync(outJson, JSON.stringify(summary, null, 2) + "\n")

let md = `# Probe summary: ${summary.input}\n\n`
md += `Records: ${summary.totalRecords}. Processes: ${processes.length}. MaxListenersExceededWarning captured by probe: ${summary.totals.maxListenersExceededWarnings}. Cap values seen: ${summary.totals.capValuesSeen.join(", ")}.\n\n`
for (const p of processes) {
  md += `## ${p.role} (pid ${p.pid})\n\n`
  md += `- records ${p.records}, \`event\` hook calls ${p.eventHookCalls}, dispose hook calls ${p.disposeHookCalls}\n`
  md += `- process.getMaxListeners(): at module import ${p.capAtModuleImport}, at server-init ${p.capAtServerInit}, at exit ${p.capAtExit} (all values seen: ${p.capValuesSeen.join(", ")})\n`
  md += `- MaxListenersExceededWarning: ${p.maxListenersExceededWarnings}${p.maxListenersExceededMessages.length ? " - " + p.maxListenersExceededMessages.join(" | ") : ""}\n`
  if (p.otherWarnings.length) md += `- other process warnings: ${p.otherWarnings.join(" | ")}\n`
  if (p.leakControl) md += `- leak control: injected ${p.leakControl.injected} SIGHUP listeners -> SIGHUP count ${p.leakControl.sighupAfterInjection}; after dispose removed ${p.leakControl.removedAtDispose} -> SIGHUP count ${p.leakControl.sighupAfterDispose}\n`
  md += `- process.eventNames().length: import ${p.eventNamesCount.moduleImport}, server-init ${p.eventNamesCount.serverInit}, peak ${p.eventNamesCount.peak}, exit ${p.eventNamesCount.processExit}\n\n`
  const phasesPresent = PHASES.filter((ph) => Object.keys(p.perEvent.exit).some((k) => k === `peak:${ph}`))
  md += `| event | import | server-init | ${phasesPresent.map((ph) => `peak ${ph}`).join(" | ")} | ${phasesPresent.map((ph) => `last ${ph}`).join(" | ")} | exit |\n`
  md += `|---|---|---|${phasesPresent.map(() => "---").join("|")}|${phasesPresent.map(() => "---").join("|")}|---|\n`
  for (const name of WATCHED) {
    const row = p.perEvent[name]
    md += `| ${name} | ${row.moduleImport} | ${row.serverInit} | ${phasesPresent.map((ph) => row[`peak:${ph}`]).join(" | ")} | ${phasesPresent.map((ph) => row[`last:${ph}`]).join(" | ")} | ${row.processExit} |\n`
  }
  md += "\n"
}
fs.writeFileSync(outMd, md)
process.stdout.write(md)

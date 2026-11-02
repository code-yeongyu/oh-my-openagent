#!/usr/bin/env node
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { cpus, homedir, loadavg, totalmem } from "node:os"
import { join, resolve } from "node:path"

import { sandboxProcesses } from "./task-host-e2e-process.mjs"
import { createRunRoot } from "./task-host-e2e-sandbox.mjs"
import { applyTargetOverrides, DEFAULT_TARGETS, evaluate, REQUIRED_SAMPLES } from "./task-host-e2e-shard-cost-eval.mjs"
import { idleExit } from "./task-host-e2e-shard-cost-idle-exit.mjs"
import { latency } from "./task-host-e2e-shard-cost-latency.mjs"
import { controlIdle, idleAndMarginal, totals } from "./task-host-e2e-shard-cost-memory.mjs"
import { provisionConfig } from "./task-host-e2e-shard-cost-support.mjs"
import { prewarmIdle } from "./task-host-e2e-shard-cost-user-latency.mjs"

function parseArgs(argv) {
  const options = { targets: [], skip: [], control: false, keepSandbox: false }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === "--control") options.control = true
    else if (flag === "--keep-sandbox") options.keepSandbox = true
    else if (flag === "--target") options.targets.push(argv[++index])
    else if (flag === "--skip") options.skip.push(argv[++index])
    else if (flag.startsWith("--")) options[flag.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++index]
  }
  return options
}

const log = (line) => console.error(`[shard-cost ${new Date().toISOString().slice(11, 19)}] ${line}`)

function hardware() {
  const gb = Math.round(totalmem() / 1024 ** 3)
  const family = process.platform === "darwin" && process.arch === "arm64" ? "Apple M-series" : `${process.platform}/${process.arch}`
  return `${family} ${cpus().length}-core, ${gb} GB`
}

function realAgentFingerprint() {
  const dir = join(homedir(), ".omo", "agent")
  const digest = (name) => (existsSync(join(dir, name)) ? createHash("sha256").update(readFileSync(join(dir, name))).digest("hex").slice(0, 16) : "absent")
  const socket = join(dir, "rpc", "rpc.sock")
  const stat = existsSync(socket) ? statSync(socket) : undefined
  return { auth: digest("auth.json"), models: digest("models.json"), rpc_sock: stat === undefined ? "absent" : `${stat.ino}:${stat.mtimeMs}` }
}

function sweep(runRoot) {
  const before = sandboxProcesses({ root: runRoot })
  for (const entry of before) {
    try {
      process.kill(entry.pid, "SIGKILL")
    } catch {
      // gone
    }
  }
  return { before: before.map((entry) => entry.pid), after: sandboxProcesses({ root: runRoot }).map((entry) => entry.pid) }
}

function table(report, verdict) {
  const lines = [`# shard cost (${report.hardware})`, "", `sharded: ${report.binaries.sharded?.version ?? "n/a"}`, `control: ${report.binaries.control?.version ?? "n/a"}`, "", "| target | measured | acceptance | verdict |", "|---|---|---|---|"]
  for (const row of verdict.rows) lines.push(`| ${row.id} | ${row.measured} | ${row.target} | ${row.verdict} |`)
  const latencyRows = report.sections.latency?.scenarios ?? {}
  lines.push("", "| latency scenario | n | p50 ms | p95 ms | min ms | max ms |", "|---|---|---|---|---|---|")
  for (const [name, cell] of Object.entries(latencyRows)) lines.push(`| ${name} | ${cell.n} | ${cell.p50_ms} | ${cell.p95_ms} | ${cell.min_ms} | ${cell.max_ms} |`)
  for (const [name, idle] of Object.entries(report.sections.prewarm_idle ?? {})) {
    lines.push("", `pre-warm idle (${name}, no child): ${idle.idle?.endpoint_footprint_mb} MB footprint / ${idle.idle?.endpoint_rss_mb} MB RSS; host exited ${idle.host_exit_ms_after_last_probe} ms after the last probe (idle window ${idle.idle_exit_ms_configured} ms), parent alive ${idle.parent_alive_at_host_exit}`)
  }
  for (const row of report.sections.totals?.rows ?? []) lines.push(`\nN=${row.parents} x 4: sharded ${row.sharded.rss_mb} MB RSS / ${row.sharded.footprint_mb} MB footprint over ${row.sharded.endpoints_alive} hosts; control ${row.control.rss_mb} / ${row.control.footprint_mb} MB on 1 host`)
  return `${lines.join("\n")}\n`
}

function finish(out, report, options) {
  const targets = applyTargetOverrides(DEFAULT_TARGETS, options.targets)
  for (const name of options.skip) delete report.sections[name]
  const verdict = evaluate(report, { targets, requiredSamples: REQUIRED_SAMPLES })
  const leaked = report.cleanup_ok === false
  const exitCode = leaked ? 1 : verdict.exitCode
  const final = { ...report, verdict: { ...verdict, exitCode, harness_leak: leaked } }
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, "shard-cost.json"), `${JSON.stringify(final, null, 2)}\n`)
  writeFileSync(join(out, "shard-cost.md"), table(report, verdict))
  console.log(JSON.stringify({ exitCode, verdict: verdict.verdict, completeness: verdict.completeness, rows: verdict.rows.map(({ id, measured, target, verdict: v }) => ({ id, measured, target, verdict: v })), out }))
  return exitCode
}

async function main(options) {
  const out = resolve(options.out ?? join(process.cwd(), "shard-cost-out"))
  if (options.reevaluate !== undefined) {
    const recorded = JSON.parse(readFileSync(resolve(options.reevaluate), "utf8"))
    return finish(out, { ...recorded, reevaluated_from: resolve(options.reevaluate) }, options)
  }
  if (process.platform === "win32") {
    console.log(JSON.stringify({ result: "SKIP", reason: "per-parent shards are POSIX-only; win32 children use the child-process runner" }))
    return 0
  }
  const bin = options.bin ?? process.env.SENPI_BIN
  const samples = Number(options.samples ?? REQUIRED_SAMPLES)
  if (bin === undefined && !options.control) throw new Error("--bin <compiled omo from this branch> (or SENPI_BIN) is required")
  if (options.beforeBin === undefined && (options.control || !["idle", "totals", "idle_exit", "latency"].every((name) => options.skip.includes(name)))) {
    throw new Error("--before-bin <compiled R0 omo> is required for the control halves")
  }
  const realBefore = realAgentFingerprint()
  const runRoot = createRunRoot()
  const cleanup = []
  const report = { plan_todo: 15, mode: options.control ? "control" : "full", started: new Date().toISOString(), hardware: hardware(), samples, run_root: runRoot, binaries: {}, load_average: {}, sections: {}, errors: {}, cleanup }
  try {
    const sharded = options.control ? undefined : provisionConfig("sharded", resolve(bin), runRoot)
    const control = options.beforeBin === undefined ? undefined : provisionConfig("control", resolve(options.beforeBin), runRoot)
    const run = { sharded, control }
    report.binaries = Object.fromEntries(Object.entries(run).filter(([, value]) => value !== undefined).map(([kind, value]) => [kind, { path: value.bin, version: value.version, sha256: value.digest }]))
    const wanted = (name) => !options.skip.includes(name)
    const measure = async (name, fn) => {
      if (!wanted(name)) return
      log(`section ${name}`)
      report.load_average[name] = loadavg().map((value) => Math.round(value * 10) / 10)
      try {
        report.sections[name] = await fn()
      } catch (error) {
        report.errors[name] = String(error?.stack ?? error)
        log(`section ${name} FAILED: ${report.errors[name].split("\n")[0]}`)
      }
    }
    if (options.control) {
      await measure("idle_exit", () => idleExit(run, [control], cleanup, log))
    } else {
      let marginal
      await measure("idle", async () => {
        const measured = await idleAndMarginal(run, cleanup, log)
        marginal = measured.marginal
        return { sharded: measured.idle, control: await controlIdle(run, cleanup) }
      })
      if (wanted("marginal") && marginal !== undefined) report.sections.marginal = marginal
      else if (wanted("marginal") && !wanted("idle")) await measure("marginal", async () => (await idleAndMarginal(run, cleanup, log)).marginal)
      await measure("totals", () => totals(run, cleanup, log))
      await measure("latency", () => latency(run, samples, cleanup, log))
      await measure("prewarm_idle", () => prewarmIdle(run, cleanup, log))
      await measure("idle_exit", () => idleExit(run, [sharded, control], cleanup, log))
    }
  } finally {
    const swept = sweep(runRoot)
    if (!options.keepSandbox) rmSync(runRoot, { recursive: true, force: true })
    const realAfter = realAgentFingerprint()
    report.finished = new Date().toISOString()
    report.sweep = { ...swept, run_root_removed: !existsSync(runRoot) }
    report.real_agent_dir = { before: realBefore, after: realAfter, untouched: JSON.stringify(realBefore) === JSON.stringify(realAfter) }
    report.cleanup_ok = swept.after.length === 0 && cleanup.every((entry) => (entry.stillAlive ?? []).length === 0 && (entry.endpoints ?? []).every((endpoint) => endpoint.stillAlive.length === 0))
  }
  return finish(out, report, options)
}

if (import.meta.main ?? process.argv[1]?.endsWith("task-host-e2e-shard-cost.mjs")) {
  const options = parseArgs(process.argv.slice(2))
  main(options).then((code) => { process.exitCode = code }, (error) => {
    console.error(error?.stack ?? error)
    process.exitCode = 1
  })
}

export { parseArgs }

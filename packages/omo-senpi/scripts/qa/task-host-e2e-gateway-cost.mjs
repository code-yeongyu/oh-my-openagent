#!/usr/bin/env bun
/**
 * Session-gateway cost (plan todo 23): what the terminal control endpoint costs a TUI, and how fast
 * the gateway answers.
 *
 * Sections (each in `task-host-e2e-gateway-cost-<section>.mjs`):
 * - `ab`: (a) TUI startup and (b) idle memory, listener OFF vs ON on ONE engine and launcher: plugin A
 *   is a scratch build whose thread component gets `sessionControl: null`, plugin B the plugin as
 *   built; interleaved pairs, min-of-N, median and p95 with bootstrap intervals (`-ab.mjs`, `-probe.mjs`);
 * - `gateway`: on the released engine (`THREAD_QA_SENPI_VERSION`, default 2026.10.8), (c)
 *   `thread_list` at N = 1, 5, 12 pty TUIs and (d) `thread_send` to an idle terminal, timed at the
 *   tool boundary (`-gateway.mjs`, `-list.mjs`, `-send.mjs`, `-trace.mjs`);
 * - (e) every pty stream and sandbox agent dir, host `stderr.log` included, scanned for
 *   `event loop blocked`, with a positive control (`-scan.mjs`).
 * Every sample batch records load and compressor share before and after; a batch whose load jumped
 * is discarded, listed and re-taken (`-batch.mjs`). Past `--deadline-at` (or `--max-run-ms`) every
 * section stops between samples and the report says exactly what was measured.
 *
 * Usage: bun task-host-e2e-gateway-cost.mjs --engine-a <senpi engine dir> [--engine-b <dir>]
 *        [--plugin-a <omo-senpi plugin dir>] [--plugin-b <dir>] [--endpoints-a 0] [--endpoints-b 1]
 *        [--label-a <text>] [--label-b <text>] [--samples 20] [--list-samples 20] [--send-cycles 10]
 *        [--cli-samples 10] [--idle-ms 1000] [--echo-window-ms 2000] [--batch-size 5]
 *        [--list-ns 1,5,12] [--skip ab|gateway|control]...
 *        [--deadline-at <epoch ms>|--max-run-ms <ms>] [--out <dir>]
 * Exit 0 every bound PASS, 2 measured but a bound FAIL or PARTIAL, 1 a harness failure or leftover.
 * Never touches the real agent dir: every TUI runs with its own HOME and agent dir under /tmp.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { cpus, totalmem } from "node:os"
import { join, resolve } from "node:path"

const argv = process.argv.slice(2)
const opt = (name, fallback) => {
  const index = argv.indexOf(`--${name}`)
  return index === -1 ? fallback : argv[index + 1]
}
const startedAt = Date.now()
const opts = {
  engineA: opt("engine-a"),
  engineB: opt("engine-b", opt("engine-a")),
  pluginA: opt("plugin-a"),
  pluginB: opt("plugin-b"),
  endpointsA: Number(opt("endpoints-a", 0)),
  endpointsB: Number(opt("endpoints-b", 1)),
  labelA: opt("label-a", "A"),
  labelB: opt("label-b", "B"),
  echoWindowMs: Number(opt("echo-window-ms", 2000)),
  samples: Number(opt("samples", 20)),
  listSamples: Number(opt("list-samples", 20)),
  sendCycles: Number(opt("send-cycles", 10)),
  cliSamples: Number(opt("cli-samples", 10)),
  idleMs: Number(opt("idle-ms", 1000)),
  batchSize: Number(opt("batch-size", 5)),
  listNs: String(opt("list-ns", "1,5,12")).split(",").map(Number),
  skips: argv.flatMap((value, index) => (argv[index - 1] === "--skip" ? [value] : [])),
  out: resolve(opt("out", join(process.cwd(), "gateway-cost-out"))),
}
const deadlineAt = Number(opt("deadline-at", startedAt + Number(opt("max-run-ms", 45 * 60_000))))
const RUN_ROOT = mkdtempSync("/tmp/t23-run-")
process.env.THREAD_QA_SENPI_VERSION ??= "2026.10.8"
process.env.THREAD_QA_KIT_DIR ??= join(RUN_ROOT, "kit")

const gw = await import("./thread-tools/lib/gateway.mjs")
const { createDeadline, hostLoad } = await import("./task-host-e2e-gateway-cost-batch.mjs")
const scanning = await import("./task-host-e2e-gateway-cost-scan.mjs")
const { verdicts } = await import("./task-host-e2e-gateway-cost-verdict.mjs")
const log = (line) => console.error(`[gateway-cost ${new Date().toISOString().slice(11, 19)}] ${line}`)
const ctx = { opts, runRoot: RUN_ROOT, log, deadline: createDeadline(deadlineAt), scan: scanning.createLoopScan() }

const report = {
  plan_todo: 23,
  omo_head: Bun.spawnSync(["git", "-C", gw.OMO_ROOT, "rev-parse", "HEAD"]).stdout.toString().trim(),
  started: new Date(startedAt).toISOString(),
  deadline_at: ctx.deadline.at,
  hardware: `${process.platform}/${process.arch} ${cpus().length}-core ${Math.round(totalmem() / 1024 ** 3)} GB`,
  node: Bun.spawnSync([process.env.THREAD_QA_NODE ?? "node", "--version"]).stdout.toString().trim(),
  bun: Bun.version,
  options: { ...opts, engineA: undefined, engineB: undefined, pluginA: undefined, pluginB: undefined },
  host_load_start: hostLoad(),
  sections: {},
  errors: {},
}

function writeReport(name) {
  mkdirSync(opts.out, { recursive: true })
  report.deadline = { at: ctx.deadline.at, reached: Date.now() >= deadlineAt, stopped_in: ctx.deadline.stoppedIn ?? null }
  report.event_loop_blocked = { count: ctx.scan.hits.length, hits: ctx.scan.hits, files_scanned: ctx.scan.filesScanned, streams_scanned: ctx.scan.streamsScanned, host_stderr_files: [...new Set(ctx.scan.hostStderrFiles.map((file) => file.path))].length, control: report.loop_scan_control ?? null }
  report.acceptance = verdicts(report)
  writeFileSync(join(opts.out, name), `${JSON.stringify(report, null, 2)}\n`)
}

async function teardownAndExit(code) {
  await gw.cleanupAll()
  scanning.sweepMarker(RUN_ROOT)
  scanning.sweepMarker("/tmp/qa-thread-tools-t23")
  rmSync(RUN_ROOT, { recursive: true, force: true })
  process.exit(code)
}

gw.installCleanupHooks()
// Hard stop 4 min past the soft deadline: whatever is in the report is written, then everything goes.
setTimeout(() => {
  log("hard deadline: writing what was measured and tearing down")
  report.errors.hard_deadline = "stopped mid-sample at the hard deadline"
  writeReport("gateway-cost.json")
  void teardownAndExit(124)
}, Math.max(0, deadlineAt + 4 * 60_000 - Date.now())).unref()

const realBefore = scanning.realAgentFingerprint()
let harnessFailure = false
try {
  await gw.ensureKit()
  const fake = await gw.startFakeModel()
  const sections = [
    ["ab", async () => (await import("./task-host-e2e-gateway-cost-ab.mjs")).abSection],
    ["gateway", async () => (await import("./task-host-e2e-gateway-cost-gateway.mjs")).gatewaySection],
  ]
  for (const [name, load] of sections) {
    if (opts.skips.includes(name) || ctx.deadline.reached(`before section ${name}`)) continue
    log(`section ${name} (load ${hostLoad().load.join(" ")})`)
    report.sections[name] = {}
    try {
      await (await load())(ctx, fake, report.sections[name])
      if (report.sections[name].error !== undefined) harnessFailure = true
    } catch (error) {
      harnessFailure = true
      report.errors[name] = String(error?.stack ?? error).split("\n").slice(0, 8).join("\n")
      log(`section ${name} FAILED: ${report.errors[name].split("\n")[0]}`)
    }
  }
  if (!opts.skips.includes("control")) report.loop_scan_control = await (await import("./task-host-e2e-gateway-cost-gateway.mjs")).loopScanControl(ctx, fake)
} finally {
  report.host_load_end = hostLoad()
  writeReport("gateway-cost.pre-teardown.json")
  log("teardown: stopping every process of this run")
  await gw.cleanupAll()
  const survivors = Bun.spawnSync(["pgrep", "-f", "/tmp/qa-thread-tools-t23"]).stdout.toString().trim()
  const runSurvivors = Bun.spawnSync(["pgrep", "-f", RUN_ROOT]).stdout.toString().trim()
  const leftDirs = readdirSync("/tmp").filter((name) => name.startsWith("qa-thread-tools-t23"))
  rmSync(RUN_ROOT, { recursive: true, force: true })
  report.finished = new Date().toISOString()
  report.cleanup = { sandbox_survivors: survivors, run_root_survivors: runSurvivors, sandbox_dirs_left: leftDirs, run_root_removed: !existsSync(RUN_ROOT), swept_sandbox_pids: [...gw.swept] }
  const mentions = scanning.realAgentDirMentions([RUN_ROOT, "qa-thread-tools-t23"])
  const realAfter = scanning.realAgentFingerprint()
  report.real_agent_dir = { before: realBefore, after: realAfter, files_naming_this_run: mentions, untouched: JSON.stringify(realBefore) === JSON.stringify(realAfter) && mentions.length === 0 }
  const leftovers = survivors !== "" || runSurvivors !== "" || leftDirs.length > 0 || existsSync(RUN_ROOT) || !report.real_agent_dir.untouched
  writeReport("gateway-cost.json")
  const allPass = Object.values(report.acceptance).every((row) => row.verdict === "PASS")
  const exitCode = harnessFailure || leftovers ? 1 : allPass ? 0 : 2
  console.log(`GATEWAY_COST_SUMMARY ${JSON.stringify({ exitCode, out: join(opts.out, "gateway-cost.json"), deadline: report.deadline, acceptance: report.acceptance, event_loop_blocked: report.event_loop_blocked.count, control: report.loop_scan_control, cleanup: report.cleanup, real_agent_dir_untouched: report.real_agent_dir.untouched, errors: report.errors })}`)
  process.exitCode = exitCode
}
process.exit(process.exitCode ?? 0)

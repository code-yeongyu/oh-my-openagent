#!/usr/bin/env node
// CU latency bench: warm runs of each SDK operation through the `spawn` transport, wall time measured at the
// port (request written to reply read) and the engine's per-stage `ActionReport.timings` (row 11, microseconds,
// `trace: true` sessions) read from the raw reply before the SDK parses it.
//
//   node packages/omo-senpi/scripts/qa/cu-eval/bench.mjs (--fake-engine | --live) [--engine <path>]
//        [--runs 30] [--warmup 3] [--out <file>] [--write-baseline] [--compare <baseline.json>] [--json]
//
// The host key names the baseline file: baselines/<platform>-<arch>-<fake|live>.json. --write-baseline writes
// it; --compare exits 1 when any op's wall p50 exceeds the baseline's by more than 30% (DESIGN section 9) and
// by more than 0.5 ms. Host load (1/5/15 min load averages, cpu count) is recorded before and after the runs.
// --live targets a TextEdit document the bench opens itself (macOS only) and closes without saving.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { cpus, loadavg, platform, tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, "..", "..", "..", "..", "..")

if (process.versions.bun === undefined) {
  const child = spawnSync("bun", [fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: "inherit" })
  if (child.error !== undefined) {
    console.log(JSON.stringify({ verdict: "FAIL", reason: `the bench needs bun on PATH to load the SDK: ${child.error.message}` }))
    process.exit(1)
  }
  process.exit(child.status ?? 1)
}

const { connect } = await import(join(repoRoot, "packages", "senpi-desktop-sdk", "src", "index.ts"))
const { engineLauncher } = await import("./engine-port.mjs")
const core = await import("./eval-core.mjs")
const { locateEngine } = await import("./run.mjs")

/** One window with a text area and a button: every op below has a target. */
const BENCH_SCENARIO = {
  displays: [
    { id: "1", name: "Built-in Display", x: 0, y: 0, width: 1920, height: 1080, scale: 1, pixelX: 0, pixelY: 0, pixelWidth: 1920, pixelHeight: 1080, isPrimary: true },
  ],
  windows: [{ id: "401", title: "cu-bench.txt", app: "TextEdit", pid: 4401, x: 100, y: 100, width: 760, height: 584, focused: true, elevated: null }],
  ax: {
    401: {
      role: "window",
      native_role: "AXWindow",
      title: "cu-bench.txt",
      bounds: { x: 100, y: 100, width: 760, height: 584 },
      children: [
        { role: "textarea", native_role: "AXTextArea", title: "document", value: "", bounds: { x: 110, y: 140, width: 740, height: 480 }, actions: ["focus"] },
        { role: "button", native_role: "AXButton", title: "Bench", bounds: { x: 760, y: 640, width: 80, height: 30 }, actions: ["press"] },
      ],
    },
  },
}

/** A fresh element each time: a capture or snapshot starts a new ref generation, so refs do not outlive a round. */
async function element(win, role, title) {
  const [found] = (await win.find({ role })).filter((candidate) => candidate.node?.role === role && (title === undefined || candidate.node?.title === title))
  if (found === undefined) throw new Error(`bench target ${role} ${title ?? ""} is missing`)
  return found
}

/** The ops of one warm run, in order; `method` is the engine reply each op times (its last request). */
export const OPS = {
  windows: { method: "windows", run: (ctx) => ctx.computer.windows() },
  capture: { method: "capture", run: (ctx) => ctx.win.screenshot() },
  observe: { method: "observe", run: (ctx) => ctx.win.observe() },
  "ax.query": { method: "ax.query", run: (ctx) => ctx.win.find({ role: "textarea" }) },
  click: {
    method: "click",
    run: async (ctx) => {
      const frame = await ctx.win.screenshot()
      return ctx.win.pointer.click({ frame, x: Math.round(frame.width / 2), y: Math.round(frame.height / 2) })
    },
  },
  "ax.setValue": { method: "ax.setValue", run: async (ctx) => (await element(ctx.win, "textarea")).setValue("") },
  "ax.typeText": { method: "ax.typeText", run: async (ctx) => (await element(ctx.win, "textarea")).type("bench") },
  "ax.perform": { method: "ax.perform", run: async (ctx) => (await element(ctx.win, "button", "Bench")).press(), fakeOnly: true },
}

function load() {
  const [one, five, fifteen] = loadavg()
  return { load1: Math.round(one * 100) / 100, load5: Math.round(five * 100) / 100, load15: Math.round(fifteen * 100) / 100, cpus: cpus().length }
}

function hostKey(live) {
  return `${platform()}-${process.arch}-${live ? "live" : "fake"}`
}

/** Folds raw samples into the bench JSON: wall p50/p95 per op and per-stage µs p50/p95 where the engine timed it. */
export function foldSamples(samples) {
  const ops = {}
  for (const [op, list] of Object.entries(samples)) {
    const stages = {}
    for (const sample of list) for (const [stage, us] of Object.entries(sample.timings ?? {})) (stages[stage] ??= []).push(us)
    ops[op] = {
      wallMs: core.stats(list.map((sample) => sample.wallMs)),
      stagesUs: Object.fromEntries(Object.entries(stages).map(([stage, values]) => [stage, core.stats(values)])),
      timedRuns: list.filter((sample) => sample.timings !== null && sample.timings !== undefined).length,
    }
  }
  return ops
}

async function runBench({ enginePath, live, runs, warmup }) {
  const scratch = mkdtempSync(join(tmpdir(), "cu-bench-"))
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(OMO|SENPI|PI)_/.test(key)))
  delete env.SENPI_DESKTOP_BACKEND
  let livePrep
  if (live) {
    livePrep = await import("./live-macos.mjs")
    livePrep.openBenchDocument(scratch)
  } else {
    const scenarioPath = join(scratch, "bench-scenario.json")
    writeFileSync(scenarioPath, JSON.stringify(BENCH_SCENARIO))
    env.SENPI_DESKTOP_BACKEND = `fake:${scenarioPath}`
  }
  let last
  let hello
  const onReply = (method, result, wallMs) => {
    last = { method, wallMs, timings: result !== null && typeof result === "object" ? (result.timings ?? result.report?.timings ?? null) : null }
  }
  const computer = await connect({
    kind: "spawn",
    launch: engineLauncher({ enginePath, env, session: { reportMode: "object", trace: true }, onReply, opened: (info) => (hello = info) }),
  })
  const before = load()
  const samples = Object.fromEntries(Object.keys(OPS).filter((op) => !(live && OPS[op].fakeOnly)).map((op) => [op, []]))
  try {
    if (livePrep !== undefined) await livePrep.waitForWindow(computer, { app: "TextEdit", title: "cu-bench" })
    const win = await computer.window(live ? { app: "TextEdit", title: "cu-bench" } : { app: "TextEdit" })
    const ctx = { computer, win }
    for (let round = 0; round < warmup + runs; round += 1) {
      for (const op of Object.keys(samples)) {
        last = undefined
        await OPS[op].run(ctx)
        const reply = last
        if (round >= warmup && reply?.method === OPS[op].method) samples[op].push({ wallMs: reply.wallMs, timings: reply.timings })
      }
    }
    await (await element(win, "textarea")).setValue("")
  } finally {
    await computer.close()
    if (livePrep !== undefined) livePrep.closeBenchDocument()
    rmSync(scratch, { recursive: true, force: true })
  }
  return {
    schema: 1,
    hostKey: hostKey(live),
    surface: live ? "live-macos" : "fake-engine",
    engine: { version: hello?.hello?.engineVersion ?? null, buildSha: hello?.hello?.buildSha ?? null, features: hello?.features ?? [] },
    runs,
    warmup,
    unit: { wallMs: "ms, request write to reply read at the stdio port", stagesUs: "engine ActionReport.timings, microseconds" },
    load: { before, after: load() },
    generatedAt: new Date().toISOString(),
    ops: foldSamples(samples),
  }
}

async function main() {
  const argv = process.argv.slice(2)
  const value = (name) => {
    const index = argv.indexOf(name)
    return index === -1 ? undefined : argv[index + 1]
  }
  const live = argv.includes("--live")
  const refuse = (reason) => {
    console.log(JSON.stringify({ verdict: "FAIL", reason }))
    process.exit(2)
  }
  if (live === argv.includes("--fake-engine")) refuse("pass exactly one of --fake-engine or --live")
  if (live && platform() !== "darwin") refuse("--live benches real macOS apps and runs only on darwin")
  const runs = Number(value("--runs") ?? 30)
  const warmup = Number(value("--warmup") ?? 3)
  if (!Number.isInteger(runs) || runs < 1 || !Number.isInteger(warmup) || warmup < 0) refuse("--runs must be a positive integer and --warmup a non-negative one")
  const enginePath = locateEngine(value("--engine"))
  if (!existsSync(enginePath)) refuse(`no engine at ${enginePath}`)
  const result = await runBench({ enginePath, live, runs, warmup })
  const missing = Object.entries(result.ops).filter(([, op]) => op.wallMs.n !== runs).map(([op]) => op)
  const comparePath = value("--compare")
  const comparison = comparePath === undefined ? undefined : core.compareBench(result, JSON.parse(readFileSync(comparePath, "utf8")))
  const report = { ...result, ...(comparison === undefined ? {} : { comparison }), missingSamples: missing }
  const text = `${JSON.stringify(report, null, 2)}\n`
  const out = value("--out")
  if (out !== undefined) {
    mkdirSync(dirname(resolve(out)), { recursive: true })
    writeFileSync(out, text)
  }
  if (argv.includes("--write-baseline")) {
    const path = join(here, "baselines", `${result.hostKey}.json`)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
  }
  if (argv.includes("--json")) process.stdout.write(text)
  else {
    for (const [op, stats] of Object.entries(result.ops)) console.log(`${op.padEnd(12)} wall p50 ${stats.wallMs.p50} ms p95 ${stats.wallMs.p95} ms  stages ${JSON.stringify(stats.stagesUs)}`)
    if (comparison !== undefined) console.log(JSON.stringify(comparison))
  }
  process.exit(missing.length === 0 && (comparison?.ok ?? true) ? 0 : 1)
}

if (import.meta.main) await main()

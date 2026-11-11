#!/usr/bin/env node
// CU eval: the seven tasks of tasks.mjs through one of three arms, each task judged by its own oracles and
// followed by a restore step and a post-check.
//
//   node packages/omo-senpi/scripts/qa/cu-eval/run.mjs --arm sdk-direct|model-tool|model-cua|all
//        (--fake-engine | --live) [--engine <senpi-desktop-engine>] [--json] [--out <file>]
//        [--tasks id,id] [--mismatch <task id>|all] [--senpi <senpi binary or cli.js>]
//
// sdk-direct  no model: the SDK `spawn` transport starts the engine and runs each task plan.
// model-tool  the real senpi + built plugin against a local fake model server (mock-completions-server.mjs)
//             scripted to call the `computer` tool with `run` code.
// model-cua   the same, scripted to call `computer_actions` (screenshot, click, type) with cua_adapter on.
// No arm ever calls a real model: the model arms only accept the fake server (`--fake-model` is implied).
//
// --fake-engine  the engine on its fake backend (any OS, CI): oracles read the fake's AX tree and the engine
//                audit; an effect the fake cannot show (app logic) is `unverified`, never `pass`.
// --live         macOS only, sdk-direct only: real apps (Calculator, Finder, TextEdit, Safari, System
//                Settings), each task restored and post-checked so the shared Mac is left as found.
// --mismatch     the QA control: the named task's expected values are made wrong, so it must be `fail`.
//
// Exit 0 only when every selected task ran with no `fail`/`error` and every restore post-check held.
// The SDK is TypeScript source, so under Node this script re-runs itself on Bun (`bun` on PATH).
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir, platform, tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { withTelemetryOptOut } from "../telemetry-opt-out-env.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, "..", "..", "..", "..", "..")

if (process.versions.bun === undefined) {
  const child = spawnSync("bun", [fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: "inherit", env: withTelemetryOptOut(process.env) })
  if (child.error !== undefined) {
    console.log(JSON.stringify({ verdict: "FAIL", reason: `cu-eval needs bun on PATH to load the SDK: ${child.error.message}` }))
    process.exit(1)
  }
  process.exit(child.status ?? 1)
}

const { connect } = await import(join(repoRoot, "packages", "senpi-desktop-sdk", "src", "index.ts"))
const { engineLauncher } = await import("./engine-port.mjs")
const core = await import("./eval-core.mjs")
const { runModelTask } = await import("./model-arms.mjs")
const { TASKS } = await import("./tasks.mjs")

const ARMS = ["sdk-direct", "model-tool", "model-cua"]

function argValue(argv, name) {
  const index = argv.indexOf(name)
  return index === -1 ? undefined : argv[index + 1]
}

function parseArgs(argv) {
  const arm = argValue(argv, "--arm") ?? "sdk-direct"
  const arms = arm === "all" ? ARMS : [arm]
  const only = argValue(argv, "--tasks")?.split(",").filter(Boolean)
  return {
    arms,
    fakeEngine: argv.includes("--fake-engine"),
    live: argv.includes("--live"),
    json: argv.includes("--json"),
    out: argValue(argv, "--out"),
    engine: argValue(argv, "--engine"),
    senpi: argValue(argv, "--senpi") ?? process.env.SENPI_BIN?.trim(),
    mismatch: argValue(argv, "--mismatch"),
    tasks: only === undefined ? TASKS : TASKS.filter((task) => only.includes(task.id)),
    unknownTasks: only?.filter((id) => !TASKS.some((task) => task.id === id)) ?? [],
    unknownArms: arms.filter((name) => !ARMS.includes(name)),
  }
}

/** The engine binary: `--engine`, then the cargo target dir, then the repo's release build. */
export function locateEngine(explicit) {
  const candidates = [
    explicit,
    process.env.CARGO_TARGET_DIR === undefined ? undefined : join(process.env.CARGO_TARGET_DIR, "release", "senpi-desktop-engine"),
    join(repoRoot, "target", "release", "senpi-desktop-engine"),
  ].filter((path) => path !== undefined)
  return candidates.map((path) => resolve(path)).find((path) => existsSync(path)) ?? resolve(candidates[0])
}

function surfaceOf(task, live) {
  return live ? task.live : task.fake
}

function errorRow(task, arm, error, wallMs = 0) {
  return {
    task: task.id,
    title: task.title,
    arm,
    status: "error",
    error: error instanceof Error ? error.message : String(error),
    checks: [],
    restore: { status: "error", checks: [] },
    steps: 0,
    tokens: null,
    wallMs: Math.round(wallMs),
    dispositions: {},
  }
}

// ---------------------------------------------------------------- sdk-direct

/**
 * Observes what the plan left (the oracle's windows and files), restores, reads the restored state back, runs
 * the teardown ops, then observes again for the post-check: a teardown op closes the window the oracle checks.
 * `progress` records each finished phase, so `finishRestore` runs only what an error left undone.
 */
export async function restoreAndObserve({ computer, win, surface, live, dir, remembered, readback, progress = {} }) {
  const observe = async () =>
    live === undefined ? { windows: [], files: {} } : { windows: (await computer.windows()).map(({ app, title }) => ({ app, title })), files: live.files(surface, dir) }
  const observed = await observe()
  const teardown = surface.restore.filter((step) => live?.TEARDOWN_OPS.has(step.op))
  await core.runPlan(computer, win, surface.restore.filter((step) => !teardown.includes(step)), { remembered, readback, live })
  progress.restored = true
  const restoredReadback = await core.readBack(computer, win, [...surface.readback, ...(surface.remember ?? [])])
  await core.runPlan(computer, win, teardown, { live })
  progress.tornDown = true
  const restored = await observe()
  return { ...observed, restoredReadback, restoredWindows: restored.windows, restoredFiles: restored.files }
}

/**
 * The live restore steps a task did not finish, then its teardown ops, one step at a time: a failed step is
 * recorded and the next one still runs. A fresh readback feeds `onlyIfChanged`; when that state is unknown the
 * step is skipped and recorded, since pressing a switch blind could flip it the wrong way.
 */
async function finishRestore({ computer, win, surface, live, remembered, restored, tornDown }) {
  const errors = []
  const steps = surface.restore.filter((step) => (live.TEARDOWN_OPS.has(step.op) ? tornDown !== true : restored !== true))
  const readback = steps.some((step) => step.onlyIfChanged !== undefined) ? await core.readBack(computer, win, surface.readback) : {}
  for (const step of steps) {
    try {
      const key = step.onlyIfChanged
      if (key !== undefined && ((readback[key] ?? null) === null || (remembered[key] ?? null) === null)) throw new Error(`${key} unknown, left as is`)
      await core.runPlan(computer, win, [step], { remembered, readback, live })
    } catch (error) {
      errors.push(`${step.op}${step.app === undefined ? "" : ` ${step.app}`}: ${error?.message ?? String(error)}`)
    }
  }
  return errors
}

/**
 * One sdk-direct task. On the live surface the `finally` runs whatever restore and teardown an error skipped,
 * before the engine closes and before the scratch dir that open documents point into is removed; a step that
 * fails there lands in the row's `restoreErrors` and never changes its status. `liveHarness` and `open` stand in
 * for live-macos.mjs and the SDK's `connect`.
 */
export async function runSdkTask({ task, enginePath, live, mismatch, scratch, liveHarness, open = connect }) {
  const begun = performance.now()
  const surface = surfaceOf(task, live)
  const dir = mkdtempSync(join(scratch, `${task.id}-`))
  const env = core.scrubbedEnv()
  delete env.SENPI_DESKTOP_BACKEND
  if (!live) {
    const scenarioPath = join(dir, "scenario.json")
    writeFileSync(scenarioPath, `${JSON.stringify(surface.scenario, null, 2)}\n`)
    env.SENPI_DESKTOP_BACKEND = `fake:${scenarioPath}`
  }
  const auditPath = join(dir, "audit.jsonl")
  const live$ = live ? (liveHarness ?? (await import("./live-macos.mjs"))) : undefined
  const at = { remembered: {} }
  let row
  try {
    if (live$ !== undefined) live$.prepare(surface, dir)
    const started = performance.now()
    const computer = (at.computer = await open({ kind: "spawn", launch: engineLauncher({ enginePath, env, session: { auditPath, reportMode: "object" } }) }))
    if (live$ !== undefined) await live$.waitForWindow(computer, surface.window)
    const win = (at.win = await computer.window(surface.window))
    if (surface.before !== undefined) await core.runPlan(computer, win, surface.before, { live: live$ })
    const remembered = (at.remembered = surface.remember === undefined ? {} : await core.readBack(computer, win, surface.remember))
    const reports = await core.runPlan(computer, win, surface.plan, { live: live$ })
    const readback = await core.readBack(computer, win, surface.readback)
    const wallMs = performance.now() - started
    const audit = core.readJsonLines(auditPath)
    const restoreFrom = audit.length
    const observed = await restoreAndObserve({ computer, win, surface, live: live$, dir, remembered, readback, progress: at })
    const all = core.readJsonLines(auditPath)
    row = core.oracleRow({
      task,
      arm: "sdk-direct",
      surface,
      mismatch,
      outcome: {
        reports,
        readback,
        remembered,
        ...observed,
        audit: all.slice(0, restoreFrom),
        restoreAudit: all.slice(restoreFrom),
        steps: reports.length,
        tokens: { input: 0, output: 0, source: "none (no model)" },
        wallMs,
      },
    })
  } catch (error) {
    row = errorRow(task, "sdk-direct", error, performance.now() - begun)
  } finally {
    const restoreErrors = live$ === undefined ? [] : await finishRestore({ ...at, surface, live: live$ })
    if (restoreErrors.length > 0) row = { ...row, restoreErrors }
    try {
      await at.computer?.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  return row
}

// ---------------------------------------------------------------- main

async function runEval(options) {
  const enginePath = locateEngine(options.engine)
  const scratch = mkdtempSync(join(tmpdir(), "cu-eval-"))
  const rows = []
  try {
    for (const arm of options.arms) {
      for (const task of options.tasks) {
        const mismatch = options.mismatch === "all" || options.mismatch === task.id
        const started = performance.now()
        try {
          if (arm === "sdk-direct") rows.push(await runSdkTask({ task, enginePath, live: options.live, mismatch, scratch }))
          else rows.push(await runModelTask({ task, arm, enginePath, senpi: options.senpi, mismatch }))
        } catch (error) {
          rows.push(errorRow(task, arm, error, performance.now() - started))
        }
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
  const byArm = Object.fromEntries(options.arms.map((arm) => [arm, core.summarize(rows.filter((row) => row.arm === arm))]))
  const summary = core.summarize(rows)
  return { enginePath, rows, byArm, summary }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const refuse = (reason) => {
    console.log(JSON.stringify({ verdict: "FAIL", reason }))
    process.exit(2)
  }
  if (options.unknownArms.length > 0) refuse(`unknown --arm ${options.unknownArms.join(",")}; expected ${ARMS.join(", ")} or all`)
  if (options.unknownTasks.length > 0) refuse(`unknown --tasks ${options.unknownTasks.join(",")}`)
  if (options.fakeEngine === options.live) refuse("pass exactly one of --fake-engine or --live")
  if (options.live && platform() !== "darwin") refuse("--live drives real macOS apps and runs only on darwin")
  if (options.live && options.arms.some((arm) => arm !== "sdk-direct")) {
    refuse("--live runs only the sdk-direct arm: model arms use the fake model server and the fake engine (no live model calls)")
  }
  const enginePath = locateEngine(options.engine)
  if (!existsSync(enginePath)) refuse(`no engine at ${enginePath}; run cargo build --release -p senpi-desktop-engine or pass --engine`)
  if (options.arms.some((arm) => arm !== "sdk-direct")) {
    options.senpi ??= join(repoRoot, "node_modules", "@code-yeongyu", "senpi", "dist", "cli.js")
    if (!existsSync(options.senpi)) refuse(`no senpi at ${options.senpi}; pass --senpi or set SENPI_BIN`)
  }
  const protectedFiles = [join(homedir(), ".senpi", "agent", "auth.json"), join(homedir(), ".omo", "agent", "auth.json")]
  const digest = (path) => (existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : "absent")
  const before = protectedFiles.map(digest)
  const result = await runEval(options)
  const realStateUntouched = protectedFiles.map(digest).every((value, index) => value === before[index])
  const code = realStateUntouched ? core.exitCodeFor(result.summary) : 1
  const report = {
    schema: 1,
    verdict: code === 0 ? "PASS" : "FAIL",
    surface: options.live ? "live-macos" : "fake-engine",
    arms: options.arms,
    host: { platform: platform(), arch: process.arch, bun: process.versions.bun },
    generatedAt: new Date().toISOString(),
    realStateUntouched,
    ...result,
  }
  const text = `${JSON.stringify(report, null, 2)}\n`
  if (options.out !== undefined) {
    mkdirSync(dirname(resolve(options.out)), { recursive: true })
    writeFileSync(options.out, text)
  }
  if (options.json) process.stdout.write(text)
  else {
    for (const row of result.rows) console.log(`${row.arm.padEnd(10)} ${row.status.padEnd(10)} restore=${row.restore.status.padEnd(10)} ${row.task}${row.error ? ` (${row.error})` : ""}`)
    console.log(JSON.stringify({ verdict: report.verdict, summary: result.summary }))
  }
  process.exit(code)
}

if (import.meta.main) await main()

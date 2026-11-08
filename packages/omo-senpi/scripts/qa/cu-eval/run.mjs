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
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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

/** The caller's session variables never reach the engine or senpi (they redirect children to installed runtimes). */
function scrubbedEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(OMO|SENPI|PI)_/.test(key)))
}

function surfaceOf(task, live) {
  return live ? task.live : task.fake
}

function expectOf(surface, mismatch) {
  return mismatch ? core.mismatched(surface.expect) : surface.expect
}

/** The oracle judges what the plan left; the post-check judges the restored readback, audit, windows and files. */
export function oracleRow({ task, arm, surface, mismatch, outcome }) {
  const checks = surface.oracle({ ...outcome, expect: expectOf(surface, mismatch) }).map(normalizeCheck)
  const restored = { readback: outcome.restoredReadback, audit: outcome.restoreAudit, windows: outcome.restoredWindows, files: outcome.restoredFiles }
  const restoreChecks = (surface.postcheck({ ...outcome, ...restored }) ?? []).map(normalizeCheck)
  return {
    task: task.id,
    title: task.title,
    arm,
    status: core.judge(checks),
    mismatchInjected: mismatch,
    checks,
    restore: { status: core.judge(restoreChecks), checks: restoreChecks },
    steps: outcome.steps,
    harnessCalls: outcome.harnessCalls ?? 0,
    tokens: outcome.tokens,
    wallMs: Math.round(outcome.wallMs),
    dispositions: core.dispositionHistogram(outcome.reports),
    readback: outcome.readback,
  }
}

function normalizeCheck(check) {
  return { check: check.check, kind: check.kind, ok: check.ok, ...(check.why === undefined ? {} : { why: check.why }) }
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
 */
export async function restoreAndObserve({ computer, win, surface, live, dir, remembered, readback }) {
  const observe = async () =>
    live === undefined ? { windows: [], files: {} } : { windows: (await computer.windows()).map(({ app, title }) => ({ app, title })), files: live.files(surface, dir) }
  const observed = await observe()
  const teardown = surface.restore.filter((step) => live?.TEARDOWN_OPS.has(step.op))
  await core.runPlan(computer, win, surface.restore.filter((step) => !teardown.includes(step)), { remembered, readback, live })
  const restoredReadback = await core.readBack(computer, win, [...surface.readback, ...(surface.remember ?? [])])
  await core.runPlan(computer, win, teardown, { live })
  const restored = await observe()
  return { ...observed, restoredReadback, restoredWindows: restored.windows, restoredFiles: restored.files }
}

async function runSdkTask({ task, enginePath, live, mismatch, scratch }) {
  const surface = surfaceOf(task, live)
  const dir = mkdtempSync(join(scratch, `${task.id}-`))
  const env = scrubbedEnv()
  delete env.SENPI_DESKTOP_BACKEND
  if (!live) {
    const scenarioPath = join(dir, "scenario.json")
    writeFileSync(scenarioPath, `${JSON.stringify(surface.scenario, null, 2)}\n`)
    env.SENPI_DESKTOP_BACKEND = `fake:${scenarioPath}`
  }
  const auditPath = join(dir, "audit.jsonl")
  const live$ = live ? await import("./live-macos.mjs") : undefined
  if (live$ !== undefined) live$.prepare(surface, dir)
  const started = performance.now()
  const computer = await connect({ kind: "spawn", launch: engineLauncher({ enginePath, env, session: { auditPath, reportMode: "object" } }) })
  try {
    if (live$ !== undefined) await live$.waitForWindow(computer, surface.window)
    const win = await computer.window(surface.window)
    if (surface.before !== undefined) await core.runPlan(computer, win, surface.before, { live: live$ })
    const remembered = surface.remember === undefined ? {} : await core.readBack(computer, win, surface.remember)
    const reports = await core.runPlan(computer, win, surface.plan, { live: live$ })
    const readback = await core.readBack(computer, win, surface.readback)
    const wallMs = performance.now() - started
    const audit = core.readJsonLines(auditPath)
    const restoreFrom = audit.length
    const observed = await restoreAndObserve({ computer, win, surface, live: live$, dir, remembered, readback })
    const all = core.readJsonLines(auditPath)
    return oracleRow({
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
  } finally {
    await computer.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------- model arms (fake model server)

const READBACK = "CUEVAL_READBACK"

/** JS for the `computer` tool's run: helpers shared by every generated snippet. */
const RUN_PRELUDE = `const pick = async (w, role, name, last) => { const els = (await w.find({ role })).filter((e) => e.role === role && (name === "" || e.title === name || e.description === name)); const el = last ? els[els.length - 1] : els[0]; if (el === undefined) throw new Error("no " + role + " named " + JSON.stringify(name)); return el };`

function windowExpr(filter) {
  return `await desktop.window(${JSON.stringify(filter)})`
}

/** Run code that performs `plan` through the run facade (the model+tool arm's one tool call per plan). */
export function planCode(surface, plan) {
  const lines = [RUN_PRELUDE, `const win = ${windowExpr(surface.window)};`, "let n = 0;"]
  for (const step of plan) {
    const w = step.window === undefined ? "win" : `(${windowExpr(step.window)})`
    const el = step.el === undefined ? "" : `(await pick(${w}, ${JSON.stringify(step.el.role)}, ${JSON.stringify(step.el.name)}, false))`
    if (step.op === "press") lines.push(`await ${el}.press(); n++;`)
    else if (step.op === "setValue") lines.push(`await ${el}.setValue(${JSON.stringify(step.value)}); n++;`)
    else if (step.op === "type") lines.push(`await ${el}.type(${JSON.stringify(step.text)}); n++;`)
    else if (step.op === "menu") lines.push(`await ${w}.menu.select(${JSON.stringify(step.path)}); n++;`)
    else throw new Error(`plan op ${step.op} has no run-code form`)
  }
  lines.push("return 'CUEVAL_DONE ' + n;")
  return lines.join("\n")
}

/** Run code that reads every readback spec and returns it behind a marker, with the engine clock. */
export function readbackCode(surface) {
  const lines = [RUN_PRELUDE, `const win = ${windowExpr(surface.window)};`, "const out = {};"]
  for (const spec of surface.readback) {
    const w = spec.window === undefined ? "win" : `(${windowExpr(spec.window)})`
    const read =
      spec.menu !== undefined
        ? `(await ${w}.menu.items(${JSON.stringify(spec.menu)})).map((item) => item.title)`
        : `(await (await pick(${w}, ${JSON.stringify(spec.el.role)}, ${JSON.stringify(spec.el.name)}, ${spec.last === true})).value()) ?? null`
    lines.push(`try { out[${JSON.stringify(spec.key)}] = ${read} } catch { out[${JSON.stringify(spec.key)}] = null }`)
  }
  // `at` is this host's clock when the reads finished: the restore's audit and trace lines come after it.
  lines.push(`return ${JSON.stringify(`${READBACK} `)} + JSON.stringify({ ...out, at: Date.now() });`)
  return lines.join("\n")
}

function centerOf(scenario, filter, { role, name }) {
  const win = scenario.windows.find((w) => (filter.title === undefined || w.title === filter.title) && w.app === filter.app)
  const stack = win === undefined ? [] : [scenario.ax[win.id]]
  while (stack.length > 0) {
    const node = stack.shift()
    if (node === undefined) continue
    if (node.role === role && (name === "" || node.title === name || node.description === name) && node.bounds !== undefined) {
      return { x: Math.round(node.bounds.x + node.bounds.width / 2), y: Math.round(node.bounds.y + node.bounds.height / 2) }
    }
    stack.push(...(node.children ?? []))
  }
  return undefined
}

/**
 * What a perfect-vision CUA model would send for `plan`: a click at the element's center (the fake desktop is
 * one 1920x1080 display at scale 1, so frame pixels are global points) and typed text. A menu path has no
 * pixels on the fake desktop: the scripted model reports it cannot reach it, and the oracle fails the task.
 */
export function cuaActions(surface, plan) {
  const actions = []
  for (const step of plan) {
    if (step.op === "menu") return { actions, unreachable: `menu ${step.path.join(" > ")}` }
    const at = centerOf(surface.scenario, step.window ?? surface.window, step.el)
    if (at === undefined) return { actions, unreachable: `${step.el.role} ${step.el.name}` }
    actions.push({ action: "click", ...at })
    if (step.op === "setValue") actions.push({ action: "type", text: step.value })
    if (step.op === "type") actions.push({ action: "type", text: step.text })
  }
  return { actions, unreachable: undefined }
}

function computerRun(code) {
  return { type: "tool_call", name: "computer", arguments: { action: "run", code } }
}

/** The scripted turns of one task: the arm's own calls, then the harness readback, restore and post-readback. */
export function modelScript(arm, surface) {
  const own = []
  if (arm === "model-tool") own.push(computerRun(planCode(surface, surface.plan)))
  else {
    // `computer_actions` is declared once the computer tool is active (#9048); a screenshot activates it.
    own.push({ type: "tool_call", name: "computer", arguments: { action: "call", chain: [{ method: "screenshot" }] }, harness: true })
    own.push({ type: "tool_call", name: "computer_actions", arguments: { action: "screenshot" } })
    const { actions, unreachable } = cuaActions(surface, surface.plan)
    if (actions.length > 0) own.push({ type: "tool_call", name: "computer_actions", arguments: { action: "batch", actions } })
    if (unreachable !== undefined) own.push({ type: "text", text: `cannot reach ${unreachable} from the screenshot`, harness: false, note: true })
  }
  const tail = [computerRun(readbackCode(surface)), ...(surface.restore.length > 0 ? [computerRun(planCode(surface, surface.restore))] : []), computerRun(readbackCode(surface))]
  return { own: own.filter((step) => step.note !== true), tail, unreachable: own.find((step) => step.note === true)?.text }
}

function filesNamed(root, predicate, found = []) {
  if (!existsSync(root)) return found
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) filesNamed(path, predicate, found)
    else if (predicate(entry.name, path)) found.push(path)
  }
  return found
}

function toolResults(agentDir) {
  return filesNamed(join(agentDir, "sessions"), (name) => name.endsWith(".jsonl"))
    .flatMap((path) => core.readJsonLines(path))
    .map((entry) => entry.message ?? entry)
    .filter((message) => message?.role === "toolResult")
}

function resultText(result) {
  return (result?.content ?? []).map((part) => (typeof part?.text === "string" ? part.text : "")).join("\n")
}

/** The readback payload behind the marker; the tool may print the returned string JSON-quoted. */
export function parseReadback(text) {
  const index = text.indexOf(READBACK)
  if (index === -1) return undefined
  const rest = text.slice(index + READBACK.length + 1)
  for (const candidate of [rest, rest.replace(/\\"/g, '"').replace(/\\\\/g, "\\")]) {
    const end = candidate.lastIndexOf("}")
    if (end === -1) continue
    try {
      return JSON.parse(candidate.slice(0, end + 1))
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
    }
  }
  return undefined
}

function withoutClock({ at, ...readback }) {
  return readback
}

function runChild(command, args, options) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => (stdout += chunk))
    child.stderr.on("data", (chunk) => (stderr = (stderr + chunk).slice(-8000)))
    const timer = setTimeout(() => child.kill("SIGKILL"), options.timeout)
    child.on("close", (code, signal) => {
      clearTimeout(timer)
      resolveRun({ code, signal, stdout, stderr })
    })
  })
}

async function runModelTask({ task, arm, enginePath, senpi, mismatch }) {
  const surface = task.fake
  const { createSandbox, seedSandbox } = await import("../drive.mjs")
  const { isolatedChildEnv } = await import("../sandbox-child-env.mjs")
  const { startMockCompletionsServer } = await import("../mock-completions-server.mjs")
  const { own, tail, unreachable } = modelScript(arm, surface)
  const steps = [...own, ...tail, { type: "text", text: "done" }].map(({ harness, ...step }) => step)
  const requests = []
  const server = startMockCompletionsServer({ steps, onRequest: (body) => requests.push(body) })
  const sandbox = createSandbox()
  const started = performance.now()
  try {
    seedSandbox(sandbox)
    const scenarioPath = join(sandbox.root, "scenario.json")
    writeFileSync(scenarioPath, `${JSON.stringify(surface.scenario, null, 2)}\n`)
    writeFileSync(
      join(sandbox.agentDir, "models.json"),
      JSON.stringify({
        providers: {
          "cu-eval-fake": {
            api: "openai-completions",
            baseUrl: await server.ready,
            apiKey: "fake",
            models: [{ id: "fake-cu", name: "Fake CU", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 8192 }],
          },
        },
      }),
    )
    mkdirSync(join(sandbox.cwd, ".omo"), { recursive: true })
    writeFileSync(
      join(sandbox.cwd, ".omo", "omo.jsonc"),
      JSON.stringify({ computer: { engine_path: enginePath, allow_host_relay_only_stop: true, trace: true, ...(arm === "model-cua" ? { cua_adapter: true } : {}) } }),
    )
    const runsOnBun = /\.(?:c|m)?js$/.test(senpi)
    const args = ["-p", "--provider", "cu-eval-fake", "--model", "fake-cu", task.prompt]
    const run = await runChild(runsOnBun ? process.execPath : senpi, runsOnBun ? [senpi, ...args] : args, {
      cwd: sandbox.cwd,
      env: {
        ...isolatedChildEnv(scrubbedEnv(), sandbox.agentDir),
        OMO_CODING_AGENT_DIR: sandbox.agentDir,
        SENPI_CODING_AGENT_DIR: sandbox.agentDir,
        PI_CODING_AGENT_DIR: sandbox.agentDir,
        HOME: sandbox.homeDir,
        USERPROFILE: sandbox.homeDir,
        XDG_CONFIG_HOME: sandbox.xdgConfigHome,
        XDG_DATA_HOME: sandbox.xdgDataHome,
        XDG_CACHE_HOME: sandbox.xdgCacheHome,
        PI_OFFLINE: "1",
        OMO_SENPI_QA: "1",
        SENPI_DESKTOP_BACKEND: `fake:${scenarioPath}`,
      },
      timeout: 120_000,
    })
    const wallMs = performance.now() - started
    if (run.code !== 0) throw new Error(`senpi exited ${run.code ?? run.signal}: ${run.stderr.trim().slice(-600)}`)
    const results = toolResults(sandbox.agentDir)
    const readbacks = results.map((result) => parseReadback(resultText(result))).filter((value) => value !== undefined)
    if (readbacks.length !== 2) throw new Error(`expected 2 readbacks, found ${readbacks.length}: ${results.map(resultText).join(" | ").slice(0, 600)}`)
    const auditFile = filesNamed(sandbox.root, (name) => name === ".computer-audit.jsonl")[0]
    const traceLines = filesNamed(sandbox.root, (_name, path) => /[\\/]trace[\\/][^\\/]+\.jsonl$/.test(path)).flatMap((path) => core.readJsonLines(path))
    const audit = auditFile === undefined ? [] : core.readJsonLines(auditFile)
    // The readback run sends no input, so every audit line before the first `ax.query` of the restore run is
    // the arm's own. The trace carries the boundary: the first reply after the first readback's last read.
    const ownCalls = own.filter((step) => step.harness !== true).length
    const ownResults = results.filter((result) => result.toolName === "computer_actions" || resultText(result).includes("CUEVAL_DONE")).slice(0, ownCalls)
    const failedOwn = ownResults.filter((result) => result.isError === true).map((result) => resultText(result).slice(0, 300))
    const boundary = readbacks[0].at
    const audited = new Set(audit.map((line) => line.action))
    const replies = traceLines.filter((line) => line.type === "reply" && audited.has(line.method))
    const auditBefore = audit.filter((line) => Date.parse(line.timestamp) <= boundary)
    return {
      ...oracleRow({
        task,
        arm,
        surface,
        mismatch,
        outcome: {
          reports: replies.filter((line) => line.atMs <= boundary).map(traceDisposition),
          readback: withoutClock(readbacks[0]),
          restoredReadback: withoutClock(readbacks[1]),
          audit: auditBefore,
          restoreAudit: audit.slice(auditBefore.length),
          steps: ownCalls,
          harnessCalls: steps.length - 1 - ownCalls,
          tokens: tokenEstimate(requests, own.flatMap((step, index) => (step.harness === true ? [] : [index]))),
          wallMs,
        },
      }),
      traceLines: traceLines.length,
      auditLines: audit.length,
      ...(failedOwn.length > 0 ? { toolErrors: failedOwn } : {}),
      ...(unreachable === undefined ? {} : { modelNote: unreachable }),
    }
  } finally {
    server.close()
    rmSync(sandbox.root, { recursive: true, force: true })
  }
}

/**
 * A trace reply as a report for the histogram: its own `report` when the session returns ActionReports, else
 * `legacy_null` (the tool's session replies `null`, which the SDK reads as delivered_unverified) or the
 * refusal code.
 */
export function traceDisposition(line) {
  if (line.report?.disposition !== undefined) return line.report
  return { disposition: { delivery: line.ok === true ? "legacy_null" : `refused:${line.code ?? "unknown"}` } }
}

/**
 * The fake server reports no usage, so tokens are estimated from request size (chars / 4), labeled as such.
 * `own` lists the requests whose answer was one of the arm's own steps (the rest are the harness readback).
 */
function tokenEstimate(requests, own) {
  const size = (body) => JSON.stringify(body?.messages ?? []).length
  const chars = requests.reduce((sum, body) => sum + size(body), 0)
  const ownChars = own.reduce((sum, index) => sum + size(requests[index]), 0)
  const toolChars = requests[0] === undefined ? 0 : JSON.stringify(requests[0].tools ?? []).length
  return {
    requests: requests.length,
    ownRequests: own.length,
    ownInputTokensEstimate: Math.ceil(ownChars / 4),
    inputTokensEstimateTotal: Math.ceil(chars / 4),
    toolSchemaChars: toolChars,
    source: "ESTIMATE chars/4 (the fake model server reports no usage)",
  }
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
  const digest = (path) => (existsSync(path) ? readFileSync(path).toString("base64").length : -1)
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

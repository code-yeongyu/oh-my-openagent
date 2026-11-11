// The two model arms of the CU eval (model-tool, model-cua): the real senpi CLI and the built plugin against a
// local fake model server scripted to drive the `computer` tool, with the engine on its fake backend.
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import * as core from "./eval-core.mjs"

const { oracleRow, scrubbedEnv } = core

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

export async function runModelTask({ task, arm, enginePath, senpi, mismatch }) {
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

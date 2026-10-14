#!/usr/bin/env node
// Real-surface QA for the task_summary field: a real senpi process on the mock provider spawns
// background children with task_summary (normal + over-limit), then this driver asserts the
// on-disk record, the tool-result text, and the widget/footer row rendered from the real record.
// Usage: node scripts/qa/task-summary-e2e.mjs   (TASK_SUMMARY_E2E_OUT_DIR=<dir> writes a receipt)
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { SessionManager, SessionSelectorComponent, initTheme } from "@code-yeongyu/senpi"
import { chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { basename, delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createSandbox, seedSandbox } from "./drive.mjs"
import { isolatedChildEnv, sandboxStateDir } from "./sandbox-child-env.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = dirname(scriptDir)
const mockProviderEntry = join(scriptDir, "task-e2e-mock-provider.ts")

// A daemon uses the package's static launch spec, not the parent's CLI -e entries.
// Give only this scenario's plugin copy the local provider so the actual host can
// resolve the same model as the parent; never alter the shared built package.
function seedHostProvider(sandbox) {
  const plugin = join(sandbox.root, "plugin")
  cpSync(resolve(scriptDir, "../../plugin"), plugin, { recursive: true })
  const providerName = basename(mockProviderEntry)
  copyFileSync(mockProviderEntry, join(plugin, providerName))
  const specPath = join(plugin, "daemon-launch-spec.json")
  const spec = JSON.parse(readFileSync(specPath, "utf8"))
  spec.core.extensions.push(`./${providerName}`)
  writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`)
  chmodSync(specPath, 0o600)
  const settingsPath = join(sandbox.agentDir, "settings.json")
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"))
  settings.packages = [plugin]
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
}

async function stopOwnedHosts(senpiBin, sandbox) {
  const alt = `/tmp/omo-rpc-${createHash("sha256").update(sandbox.agentDir).digest("hex").slice(0, 8)}`
  const sockets = []
  for (const root of [join(sandbox.agentDir, "rpc", "shards"), alt]) {
    if (!existsSync(root)) continue
    for (const name of readdirSync(root)) {
      const socket = join(root, name)
      if (/^p-[0-9a-f]{16}\.sock$/.test(name) && lstatSync(socket).isSocket()) sockets.push(socket)
    }
  }
  const receipts = []
  for (const socket of sockets) {
    const options = { cwd: sandbox.cwd, env: childEnv(process.env, sandbox, join(sandbox.root, "sessions")), encoding: "utf8", timeout: 30_000 }
    const status = spawnSync(senpiBin, ["host", "status", "--socket", socket, "--json"], options)
    const before = JSON.parse(status.stdout?.trim() || "{}")
    const stopped = spawnSync(senpiBin, ["host", "stop", "--socket", socket, "--force", "--json"], options)
    const receipt = JSON.parse(stopped.stdout?.trim() || "{}")
    const pid = before.pid ?? receipt.pid
    const alive = () => { if (typeof pid !== "number") return false; try { process.kill(pid, 0); return true } catch { return false } }
    const deadline = Date.now() + 5_000
    while (alive() && Date.now() < deadline) await new Promise((resolveWait) => setTimeout(resolveWait, 50))
    receipts.push({ socket, pid, stopExit: stopped.status, receipt, pidStillAlive: alive() })
  }
  return receipts
}

const SUMMARY = "Audit auth session flow"
const OVER_LIMIT_MARKER = "audit auth session flow and the surrounding token refresh pipeline for regressions across the relay"

const executionMode = process.env.TASK_SUMMARY_E2E_EXECUTION_MODE ?? "in-process"
const processRunner = process.env.TASK_SUMMARY_E2E_PROCESS_RUNNER ?? "child-process"
if (!["in-process", "process"].includes(executionMode)) throw new Error("invalid task-summary execution mode")
if (!["child-process", "host"].includes(processRunner)) throw new Error("invalid task-summary process runner")

const OMO_CONFIG = {
  task: { default_execution_mode: executionMode, process_runner: processRunner },
  categories: {
    mockcat: { description: "Local mock category pinned to the mock provider.", model: "omo-mock/mock-1" },
  },
}

const SCRIPT = {
  childSteps: [{ type: "text", text: "task-summary e2e child unit complete" }],
  parentSteps: [
    {
      type: "tool_call",
      name: "task",
      arguments: {
        category: "mockcat",
        prompt: "TASK: Inspect the auth session flow and report the findings in detail.",
        task_summary: SUMMARY,
        run_in_background: true,
        name: "sum-child",
      },
    },
    {
      type: "tool_call",
      name: "task",
      arguments: {
        category: "mockcat",
        prompt: "TASK: Inspect the refresh pipeline and report the findings in detail.",
        task_summary: `${OVER_LIMIT_MARKER} ${OVER_LIMIT_MARKER}`,
        run_in_background: true,
        name: "sum-long",
      },
    },
    { type: "text", text: "task-summary e2e parent done" },
  ],
}

function findOnPath(bin) {
  if (bin.includes("/")) return existsSync(bin) ? bin : null
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = resolve(dir || ".", bin)
    if (existsSync(candidate)) return candidate
  }
  return null
}

function childEnv(baseEnv, sandbox, sessionDir) {
  const env = {}
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined) continue
    if (/TOKEN|SECRET|PASSWORD|COOKIE|CREDENTIAL|API_KEY/i.test(key)) continue
    if (key === "SENPI_CODING_AGENT_DIR" || key === "SENPI_CODING_AGENT_SESSION_DIR") continue
    env[key] = value
  }
  return {
    ...isolatedChildEnv(env, sandbox.agentDir),
    HOME: sandbox.homeDir,
    SENPI_CODING_AGENT_DIR: sandbox.agentDir,
    XDG_CONFIG_HOME: sandbox.xdgConfigHome,
    SENPI_CODING_AGENT_SESSION_DIR: sessionDir,
    OMO_SENPI_QA: "1",
    OMO_SENPI_DISABLE_POSTHOG: "1",
    PI_OFFLINE: "1",
    PI_TELEMETRY: "0",
  }
}

function runChild(command, args, options) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, options)
    child.on("error", (error) => resolveRun({ status: 1, error: String(error.message ?? error) }))
    child.on("close", (status) => resolveRun({ status: status ?? 1, error: null }))
  })
}

function sessionTranscript(sessionDir) {
  let text = ""
  const walk = (dir) => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith(".jsonl")) text += `${readFileSync(path, "utf8")}\n`
    }
  }
  walk(sessionDir)
  return text
}

function readRecords(sandbox) {
  const tasksDir = join(sandboxStateDir(sandbox), "tasks")
  if (!existsSync(tasksDir)) return {}
  const records = {}
  for (const file of readdirSync(tasksDir)) {
    if (!file.endsWith(".json")) continue
    const record = JSON.parse(readFileSync(join(tasksDir, file), "utf8"))
    records[record.name ?? record.task_id] = record
  }
  return records
}

function hostDiagnostics(root) {
  const lines = []
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (/stderr|host.*log/.test(entry.name)) {
        const errors = readFileSync(path, "utf8").split("\n").filter((line) => /Error|EPERM|EACCES|failed|not permitted/.test(line)).slice(-15)
        lines.push(...errors.map((line) => line.replaceAll(root, "<sandbox>").slice(0, 600)))
      }
    }
  }
  walk(root)
  return lines
}

async function run() {
  const senpiBin = findOnPath(process.env.SENPI_BIN?.trim() || "senpi")
  if (senpiBin === null) throw new Error("senpi-binary-unavailable")
  const sandbox = createSandbox()
  seedSandbox(sandbox)
  if (executionMode === "process" && processRunner === "host") seedHostProvider(sandbox)
  const sessionDir = join(sandbox.root, "sessions")
  mkdirSync(sessionDir, { recursive: true })
  mkdirSync(join(sandbox.cwd, ".omo"), { recursive: true })
  writeFileSync(join(sandbox.cwd, ".omo", "omo.json"), `${JSON.stringify(OMO_CONFIG, null, 2)}\n`)
  writeFileSync(join(sandbox.cwd, "mock-script.json"), `${JSON.stringify(SCRIPT, null, 2)}\n`)

  const checks = []
  const check = (name, ok, detail) => checks.push({ name, ok, detail })
  let run = { status: 2, error: null }
  let hostCleanup = []
  try {
    run = await runChild(
      senpiBin,
      ["-e", mockProviderEntry, "--provider", "omo-mock", "--model", "mock-1", "--session-dir", sessionDir, "--offline", "--approve", "--no-context-files", "Run the task_summary QA scenario."],
      { cwd: sandbox.cwd, env: childEnv(process.env, sandbox, sessionDir), stdio: "inherit" },
    )
    check("senpi-run", run.status === 0, `exit ${run.status}${run.error ? ` (${run.error})` : ""}`)

    const transcript = sessionTranscript(sessionDir)
    check(
      "tool-result-label",
      transcript.includes(`Started task ${SUMMARY} (`),
      `tool result leads with the summary: ${transcript.includes(`Started task ${SUMMARY} (`) ? "yes" : "no"}`,
    )

    const records = readRecords(sandbox)
    const normal = records["sum-child"]
    check("record-summary", normal?.task_summary === SUMMARY, `sum-child record task_summary=${JSON.stringify(normal?.task_summary)}`)
    const long = records["sum-long"]
    const clampOk =
      typeof long?.task_summary === "string" &&
      long.task_summary.length === 80 &&
      long.task_summary.endsWith("...")
    check("record-clamp", clampOk, `sum-long record task_summary length=${long?.task_summary?.length} tail=${JSON.stringify(long?.task_summary?.slice(-8))}`)

    const rowChecks = Object.values(records)
      .filter((record) => record.task_summary !== undefined)
      .map((record) => `${record.task_summary} beats ${record.name ?? record.task_id}`)
    check("widget-identity-source", rowChecks.length === 2, `records with displayable summaries: ${rowChecks.length}`)

    const pickerRows = []
    const pickerCaptures = []
    initTheme("dark")
    for (const record of Object.values(records)) {
      const childDir = join(sandboxStateDir(sandbox), "children", record.task_id, "sessions", record.task_id)
      const rows = await SessionManager.list(sandbox.cwd, childDir)
      const row = rows.find((entry) => entry.id === record.child_session_id) ?? (rows.length === 1 ? rows[0] : undefined)
      check(`picker-runner-${record.name}`, record.execution_mode === executionMode && (executionMode === "in-process" || (processRunner === "host" ? record.runner_kind === "host-session" : typeof record.pid === "number")), `mode=${record.execution_mode} kind=${record.runner_kind} pid=${record.pid}`)
      const expected = `task [${record.parent_session_id}]: ${record.task_summary}`
      check(`picker-title-${record.name}`, row?.name === expected, `name=${JSON.stringify(row?.name)} expected=${JSON.stringify(expected)}`)
      check(`picker-messages-${record.name}`, row !== undefined && row.messageCount > 0 && row.firstMessage !== "(no messages)", `messageCount=${row?.messageCount} firstMessage=${JSON.stringify(row?.firstMessage)}`)
      const selector = new SessionSelectorComponent(async () => rows, async () => rows, () => {}, () => {}, () => {}, () => {}, { showHeader: false })
      await selector.loadScope("current")
      const rendered = selector.render(80).join("\n")
      pickerCaptures.push({ taskId: record.task_id, rendered })
      check(`picker-visible-parent-${record.name}`, rendered.includes(record.parent_session_id), "actual 80-column picker must show parent identity")
      check(`picker-visible-title-${record.name}`, rendered.includes(record.task_summary.slice(0, 12)), "actual 80-column picker must show task title")
      pickerRows.push({ taskId: record.task_id, executionMode: record.execution_mode, runnerKind: record.runner_kind, parentSessionId: record.parent_session_id, row, rows })
    }
    check("picker-child-count", pickerRows.length === 2, `actual child rows: ${pickerRows.length}`)

    const outDir = process.env.TASK_SUMMARY_E2E_OUT_DIR
    if (outDir !== undefined) {
      mkdirSync(outDir, { recursive: true })
      writeFileSync(join(outDir, "session-picker-render.txt"), pickerCaptures.map((entry) => `${entry.taskId}\n${entry.rendered}`).join("\n"))
      writeFileSync(join(outDir, "host-diagnostics.json"), JSON.stringify(hostDiagnostics(sandbox.root), null, 2))
      writeFileSync(join(outDir, "session-picker-rows.json"), `${JSON.stringify(pickerRows, null, 2)}\n`)
      writeFileSync(join(outDir, "task-summary-records.json"), `${JSON.stringify(records, null, 2)}\n`)
      writeFileSync(join(outDir, "transcript-tail.txt"), transcript.slice(-6000))
    }
  } finally {
    if (executionMode === "process" && processRunner === "host") {
      hostCleanup = await stopOwnedHosts(senpiBin, sandbox)
      check("owned-host-cleanup", hostCleanup.every((entry) => entry.stopExit === 0 && !entry.pidStillAlive), JSON.stringify(hostCleanup))
    }
    rmSync(sandbox.root, { recursive: true, force: true })
  }

  const result = checks.every((entry) => entry.ok) && run.status === 0 ? "PASS" : "FAIL"
  const payload = { result, checks, hostCleanup, sandboxCleaned: !existsSync(sandbox.root), cleanup: `removed ${sandbox.root}` }
  const outDir = process.env.TASK_SUMMARY_E2E_OUT_DIR
  if (outDir !== undefined) {
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, "cleanup-receipt.json"), `${JSON.stringify(payload, null, 2)}\n`)
  }
  console.log(JSON.stringify(payload))
  if (result !== "PASS") process.exitCode = 1
}

if (process.argv.includes("--self-test")) {
  if (!SUMMARY.includes("auth")) throw new Error("self-test: summary constant drifted")
  console.log(JSON.stringify({ result: "PASS", selfTest: true }))
} else {
  await run()
}

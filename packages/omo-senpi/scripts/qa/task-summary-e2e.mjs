#!/usr/bin/env node
// Real-surface QA for the task_summary field: a real senpi process on the mock provider spawns
// background children with task_summary (normal + over-limit), then this driver asserts the
// on-disk record, the tool-result text, and the widget/footer row rendered from the real record.
// Usage: node scripts/qa/task-summary-e2e.mjs   (TASK_SUMMARY_E2E_OUT_DIR=<dir> writes a receipt)
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createSandbox, seedSandbox } from "./drive.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = dirname(scriptDir)
const mockProviderEntry = join(scriptDir, "task-e2e-mock-provider.ts")

const SUMMARY = "Audit auth session flow"
const OVER_LIMIT_MARKER = "audit auth session flow and the surrounding token refresh pipeline for regressions across the relay"

const OMO_CONFIG = {
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
    ...env,
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

function readRecords(sandboxCwd) {
  const tasksDir = join(sandboxCwd, ".omo", "senpi-task", "tasks")
  if (!existsSync(tasksDir)) return {}
  const records = {}
  for (const file of readdirSync(tasksDir)) {
    if (!file.endsWith(".json")) continue
    const record = JSON.parse(readFileSync(join(tasksDir, file), "utf8"))
    records[record.name ?? record.task_id] = record
  }
  return records
}

async function run() {
  const senpiBin = findOnPath(process.env.SENPI_BIN?.trim() || "senpi")
  if (senpiBin === null) throw new Error("senpi-binary-unavailable")
  const sandbox = createSandbox()
  seedSandbox(sandbox)
  const sessionDir = join(sandbox.root, "sessions")
  mkdirSync(sessionDir, { recursive: true })
  mkdirSync(join(sandbox.cwd, ".omo"), { recursive: true })
  writeFileSync(join(sandbox.cwd, ".omo", "omo.json"), `${JSON.stringify(OMO_CONFIG, null, 2)}\n`)
  writeFileSync(join(sandbox.cwd, "mock-script.json"), `${JSON.stringify(SCRIPT, null, 2)}\n`)

  const checks = []
  const check = (name, ok, detail) => checks.push({ name, ok, detail })
  let run = { status: 2, error: null }
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

    const records = readRecords(sandbox.cwd)
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

    const outDir = process.env.TASK_SUMMARY_E2E_OUT_DIR
    if (outDir !== undefined) {
      mkdirSync(outDir, { recursive: true })
      writeFileSync(join(outDir, "task-summary-records.json"), `${JSON.stringify(records, null, 2)}\n`)
      writeFileSync(join(outDir, "transcript-tail.txt"), transcript.slice(-6000))
    }
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }

  const result = checks.every((entry) => entry.ok) && run.status === 0 ? "PASS" : "FAIL"
  const payload = { result, checks, sandboxCleaned: !existsSync(sandbox.root), cleanup: `removed ${sandbox.root}` }
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

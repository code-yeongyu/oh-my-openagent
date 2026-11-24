#!/usr/bin/env node
// devin-acp-e2e.mjs — live QA for the `devin-acp` execution mode (packages/senpi-task/src/runners/devin-acp).
// Drives the REAL senpi binary with the built omo plugin and the lane mock provider: the parent's
// scripted `task` tool call targets `subagent_type: "devin"`, which resolves the builtin devin agent
// (execution_mode "devin-acp") and spawns a REAL `devin acp` ACP child — no mock answers the child.
// Proves: task record lands execution_mode "devin-acp" with an ACP session id, the turn completes,
// the child's final text reaches the parent, and the real ~/.senpi/agent stays untouched.
// Env: SENPI_BIN (or --senpi-bin), TASK_E2E_OUT_DIR (or --out-dir), DEVIN_ACP_COMMAND/DEVIN_BIN pass
// through to the runner untouched. --self-test runs offline assertions only.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createSandbox, digestDirectory, seedSandbox } from "./drive.mjs"
import { parseJsonEvents, snapshotDir, changedRealPaths, classifyRealSenpiChanges, findInlineFinal, jsonlSignatures } from "./task-e2e-analysis.mjs"
import { isAlive, killTree } from "./task-e2e-process.mjs"
import { isolatedChildEnv, sandboxStateDir } from "./sandbox-child-env.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const mockProviderEntry = join(scriptDir, "task-e2e-mock-provider.ts")
const realSenpiAgentDir = join(homedir(), ".senpi", "agent")

const DEVIN_MARKER = "DEVIN_ACP_QA_OK"
const DEVIN_PROMPT = `Reply with exactly the text ${DEVIN_MARKER} and nothing else. Do not use any tools, do not read or write any files.`

const DEVIN_SCRIPT = {
  childSteps: [],
  parentSteps: [
    {
      type: "tool_call",
      name: "task",
      arguments: { subagent_type: "devin", prompt: DEVIN_PROMPT, run_in_background: false, name: "devinchild" },
    },
    { type: "text", text: "devin child returned, reporting result" },
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

function seedDevinScenario(script) {
  const sandbox = createSandbox()
  seedSandbox(sandbox)
  const sessionDir = join(sandbox.root, "sessions")
  mkdirSync(sessionDir, { recursive: true })
  const omoDir = join(sandbox.cwd, ".omo")
  mkdirSync(omoDir, { recursive: true })
  writeFileSync(join(omoDir, "omo.json"), `${JSON.stringify({}, null, 2)}\n`)
  writeFileSync(join(sandbox.cwd, "mock-script.json"), `${JSON.stringify(script, null, 2)}\n`)
  return { sandbox, sessionDir, stateDir: sandboxStateDir(sandbox) }
}

function driveSenpi(senpiBin, scenario, prompt, pids, timeoutMs = 300_000) {
  const run = spawnSync(
    senpiBin,
    [
      "-e",
      mockProviderEntry,
      "-p",
      "--mode",
      "json",
      "--provider",
      "omo-mock",
      "--model",
      "mock-1",
      "--session-dir",
      scenario.sessionDir,
      prompt,
    ],
    {
      cwd: scenario.sandbox.cwd,
      env: {
        ...isolatedChildEnv(process.env, scenario.sandbox.agentDir),
        SENPI_CODING_AGENT_DIR: scenario.sandbox.agentDir,
        XDG_CONFIG_HOME: scenario.sandbox.xdgConfigHome,
        SENPI_CODING_AGENT_SESSION_DIR: scenario.sessionDir,
        OMO_SENPI_QA: "1",
      },
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
    },
  )
  if (typeof run.pid === "number") pids.push(run.pid)
  return { run, events: parseJsonEvents(run.stdout ?? "") }
}

function readStoreTaskIds(stateDir) {
  const tasksDir = join(stateDir, "tasks")
  if (!existsSync(tasksDir)) return []
  return readdirSync(tasksDir)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => entry.replace(/\.json$/, ""))
}

function readTaskRecord(stateDir, taskId) {
  const path = join(stateDir, "tasks", `${taskId}.json`)
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined
}

function readStoreJsonl(stateDir, taskId) {
  const path = join(stateDir, "logs", `${taskId}.jsonl`)
  return existsSync(path) ? readFileSync(path, "utf8") : ""
}

function taskRecordSummary(record) {
  if (record === undefined || record === null || typeof record !== "object") return {}
  const pick = (key) => (key in record ? record[key] : undefined)
  return {
    id: pick("id"),
    status: pick("status"),
    execution_mode: pick("execution_mode"),
    runner_kind: pick("runner_kind"),
    model: pick("model"),
    resolved_model: pick("resolved_model"),
    child_session_id: pick("child_session_id") === undefined ? undefined : "<set>",
    agent: pick("agent") ?? pick("subagent_type") ?? pick("agent_name"),
    pid: pick("pid") ?? pick("runner_pid") ?? pick("child_pid"),
  }
}

async function runDevinFlow(senpiBin, checks, capture, pids, keepSandbox) {
  const scenario = seedDevinScenario(DEVIN_SCRIPT)
  const { run, events } = driveSenpi(senpiBin, scenario, "spawn a devin child and report its answer", pids)
  const taskIds = readStoreTaskIds(scenario.stateDir)
  const taskId = taskIds[0]
  const record = taskId === undefined ? undefined : readTaskRecord(scenario.stateDir, taskId)
  const jsonl = taskId === undefined ? "" : readStoreJsonl(scenario.stateDir, taskId)
  const recordSummary = taskRecordSummary(record)

  capture.devinStdout = run.stdout ?? ""
  capture.devinStderr = run.stderr ?? ""
  capture.devinTaskIds = taskIds
  capture.devinTaskRecord = recordSummary
  capture.devinTaskJsonl = jsonl
  capture.devinEvents = events.map((event) => event?.type ?? event)

  const recordPath = taskId === undefined ? "" : join(scenario.stateDir, "tasks", `${taskId}.json`)
  const devinProcessPid = typeof recordSummary.pid === "number" ? recordSummary.pid : undefined

  checks.senpi_exit_zero = run.status === 0 ? "PASS" : "FAIL"
  checks.task_record_written =
    taskId !== undefined && existsSync(recordPath) && record !== undefined ? "PASS" : "FAIL"
  checks.execution_mode_devin_acp = recordSummary.execution_mode === "devin-acp" ? "PASS" : "FAIL"
  checks.child_session_recorded = typeof record?.child_session_id === "string" && record.child_session_id.length > 0 ? "PASS" : "FAIL"
  checks.task_completed = recordSummary.status === "completed" ? "PASS" : "FAIL"
  checks.devin_marker_in_transcript =
    jsonl.includes(DEVIN_MARKER) || JSON.stringify(events).includes(DEVIN_MARKER) ? "PASS" : "FAIL"
  checks.parent_final_text = findInlineFinal(events, "devin child returned") ? "PASS" : "FAIL"
  checks.no_leaked_devin_process =
    devinProcessPid === undefined || !isAlive(devinProcessPid) ? "PASS" : "FAIL"

  return { sandbox: scenario.sandbox, stateDir: scenario.stateDir, taskId, record, jsonl, run, events }
}

function writeEvidence(outDir, name, content) {
  if (outDir === undefined) return
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, name), content)
}

async function main() {
  const args = process.argv.slice(2)
  const outFlag = args.indexOf("--out-dir")
  const binFlag = args.indexOf("--senpi-bin")
  const configuredOutDir = outFlag >= 0 ? args[outFlag + 1] : process.env.TASK_E2E_OUT_DIR?.trim()
  const outDir = configuredOutDir ? resolve(configuredOutDir) : undefined
  const configuredBin = binFlag >= 0 ? args[binFlag + 1] : process.env.SENPI_BIN?.trim()

  const beforeDigest = digestDirectory(realSenpiAgentDir)
  const beforeSnapshot = snapshotDir(realSenpiAgentDir)
  const providedAgentDir = process.env.SENPI_CODING_AGENT_DIR ? "IGNORED" : "unset"
  const senpiBin = findOnPath(configuredBin || "senpi")
  if (senpiBin === null) {
    console.log(JSON.stringify({ result: "SKIP", reason: "senpi-binary-unavailable", providedAgentDir }))
    return
  }
  if (findOnPath(process.env.DEVIN_ACP_COMMAND?.trim() || process.env.DEVIN_BIN?.trim() || "devin") === null) {
    console.log(JSON.stringify({ result: "SKIP", reason: "devin-binary-unavailable", providedAgentDir }))
    return
  }

  const checks = {}
  const capture = {}
  const pids = []
  const sandboxes = []
  let devinRun
  try {
    devinRun = await runDevinFlow(senpiBin, checks, capture, pids)
    sandboxes.push(devinRun.sandbox)
  } finally {
    for (const pid of pids) if (isAlive(pid)) killTree(pid)
  }

  const leakedPids = pids.filter(isAlive).length
  const afterDigest = digestDirectory(realSenpiAgentDir)
  const allChangedRealPaths = changedRealPaths(beforeSnapshot, snapshotDir(realSenpiAgentDir))
  const sandboxTokens = sandboxes.map((sandbox) => basename(sandbox.root))
  const { qaAttributedPaths, concurrentSessionPaths } = classifyRealSenpiChanges(allChangedRealPaths, sandboxTokens)
  const realSenpiUntouched = qaAttributedPaths.length === 0
  checks.real_senpi_untouched = realSenpiUntouched ? "PASS" : "FAIL"
  checks.no_leaked_pids = leakedPids === 0 ? "PASS" : "FAIL"

  const values = Object.values(checks)
  const result = values.length > 0 && values.every((verdict) => verdict === "PASS") ? "PASS" : "FAIL"
  const receipt = {
    driver: "devin-acp-e2e",
    result,
    checks,
    leakedPids,
    realSenpiUntouched,
    realSenpiChangedPathCount: qaAttributedPaths.length,
    concurrentRealSenpiChangedPathCount: concurrentSessionPaths.length,
    allRealSenpiChangedPathCount: allChangedRealPaths.length,
    realSenpiDigestUnchanged: beforeDigest === afterDigest,
    providedAgentDir,
    sandboxCount: sandboxes.length,
    taskCount: capture.devinTaskIds?.length ?? 0,
    taskRecord: capture.devinTaskRecord ?? {},
    devinMarker: DEVIN_MARKER,
    signatures: devinRun === undefined ? [] : jsonlSignatures(devinRun.jsonl ?? ""),
  }

  if (outDir !== undefined && devinRun !== undefined) {
    writeEvidence(outDir, "verdict.json", `${JSON.stringify(receipt, null, 2)}\n`)
    writeEvidence(outDir, "senpi-stdout.jsonl", `${devinRun.run.stdout ?? ""}\n`)
    writeEvidence(outDir, "senpi-stderr.txt", `${devinRun.run.stderr ?? ""}\n`)
    if (devinRun.taskId !== undefined) {
      writeEvidence(outDir, "task-record.json", `${JSON.stringify(devinRun.record, null, 2)}\n`)
      writeEvidence(outDir, "task-transcript.jsonl", `${devinRun.jsonl}\n`)
    }
  }

  for (const sandbox of sandboxes) {
    try {
      rmSync(sandbox.root, { recursive: true, force: true })
    } catch {
      // best-effort sandbox cleanup; the receipt still records what ran
    }
  }
  console.log(JSON.stringify(receipt))
}

function runSelfTest() {
  if (DEVIN_SCRIPT.parentSteps[0]?.arguments?.subagent_type !== "devin") {
    throw new Error("self-test: scenario must target subagent_type devin")
  }
  if (DEVIN_SCRIPT.parentSteps[0]?.arguments?.run_in_background !== false) {
    throw new Error("self-test: devin scenario must run the task in the foreground")
  }
  const events = parseJsonEvents(
    [
      JSON.stringify({ type: "tool_execution_start", payload: { name: "task" } }),
      JSON.stringify({ type: "tool_execution_end", payload: { name: "task" } }),
      JSON.stringify({ type: "message_end", payload: { text: `child said ${DEVIN_MARKER}` } }),
    ].join("\n"),
  )
  if (!JSON.stringify(events).includes(DEVIN_MARKER)) {
    throw new Error("self-test: event stream must carry the devin marker")
  }
  if (findInlineFinal(events, "unrelated text")) throw new Error("self-test: findInlineFinal must reject unrelated text")
  const record = { id: "t1", status: "completed", execution_mode: "devin-acp", child_session_id: "acp-1" }
  const summary = taskRecordSummary(record)
  if (summary.execution_mode !== "devin-acp" || summary.child_session_id !== "<set>") {
    throw new Error("self-test: taskRecordSummary must summarize the record")
  }
  console.log("SELF-TEST OK")
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) runSelfTest()
  else await main()
}

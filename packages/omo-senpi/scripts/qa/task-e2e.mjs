#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createSandbox, digestDirectory, seedSandbox } from "./drive.mjs"
import {
  changedRealPaths,
  findCategoryListingError,
  findInlineFinal,
  findRevived,
  findTranscript,
  findWakeNotification,
  jsonlSignatures,
  MAIN_FLOW_EXPECTED_SEQUENCE,
  matchesOrderedSubsequence,
  parseJsonEvents,
  SHARED_SENPI_LOG,
  snapshotDir,
} from "./task-e2e-analysis.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const mockProviderEntry = join(scriptDir, "task-e2e-mock-provider.ts")
const realSenpiAgentDir = join(homedir(), ".senpi", "agent")
const CHILD_FIRST = "omo e2e child first unit complete"
const CHILD_SECOND = "omo e2e child second unit complete"
const SYNC_FINAL = "omo e2e sync child final text"
const OMO_CONFIG = { categories: { mockcat: { description: "Local mock category pinned to the mock provider.", model: "omo-mock/mock-1" } } }

const MAIN_SCRIPT = {
  childSteps: [{ type: "text", text: CHILD_FIRST }, { type: "text", text: CHILD_SECOND }],
  parentSteps: [
    { type: "tool_call", name: "task", arguments: { category: "mockcat", prompt: "do the first unit", run_in_background: true, name: "e2echild" } },
    { type: "text", text: "parent turn one done, going idle" },
    { type: "tool_call", name: "task_send", arguments: { to: "e2echild", deliver_as: "interrupt" } },
    { type: "tool_call", name: "task_send", arguments: { to: "e2echild", message: "do the second unit" } },
    { type: "text", text: "parent turn two done, going idle" },
    { type: "tool_call", name: "task_output", arguments: { name: "e2echild", mode: "full", block: true } },
    { type: "text", text: "parent read the transcript, all done" },
  ],
}
const SYNC_SCRIPT = {
  childSteps: [{ type: "text", text: SYNC_FINAL }],
  parentSteps: [
    { type: "tool_call", name: "task", arguments: { category: "mockcat", prompt: "do sync work", run_in_background: false, name: "syncchild" } },
    { type: "text", text: "sync task returned inline, done" },
  ],
}
const NEGATIVE_SCRIPT = {
  childSteps: [{ type: "text", text: "unused" }],
  parentSteps: [
    { type: "tool_call", name: "task", arguments: { category: "nonexistent-xyz", prompt: "route nowhere", run_in_background: true, name: "badchild" } },
    { type: "text", text: "saw the category error" },
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

function seedScenario(script, { withMarker } = {}) {
  const sandbox = createSandbox()
  seedSandbox(sandbox)
  const sessionDir = join(sandbox.root, "sessions")
  mkdirSync(sessionDir, { recursive: true })
  const omoDir = join(sandbox.cwd, ".omo")
  mkdirSync(omoDir, { recursive: true })
  writeFileSync(join(omoDir, "omo.json"), `${JSON.stringify(OMO_CONFIG, null, 2)}\n`)
  writeFileSync(join(sandbox.cwd, "mock-script.json"), `${JSON.stringify(script, null, 2)}\n`)
  let markerLog
  if (withMarker === true) {
    markerLog = join(sandbox.root, "marker-invocations.log")
    const extDir = join(sandbox.agentDir, "extensions")
    mkdirSync(extDir, { recursive: true })
    writeFileSync(join(extDir, "marker.js"), `import { appendFileSync } from "node:fs"\nexport default function () { appendFileSync(${JSON.stringify(markerLog)}, "x\\n") }\n`)
  }
  return { sandbox, sessionDir, markerLog, stateDir: join(sandbox.cwd, ".omo", "senpi-task") }
}

function driveSenpi(senpiBin, scenario, prompt, pids) {
  const run = spawnSync(
    senpiBin,
    ["-e", mockProviderEntry, "-p", "--mode", "json", "--provider", "omo-mock", "--model", "mock-1", "--session-dir", scenario.sessionDir, prompt],
    {
      cwd: scenario.sandbox.cwd,
      env: { ...process.env, SENPI_CODING_AGENT_DIR: scenario.sandbox.agentDir, SENPI_CODING_AGENT_SESSION_DIR: scenario.sessionDir, OMO_SENPI_QA: "1" },
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
    },
  )
  if (typeof run.pid === "number") pids.push(run.pid)
  return { run, events: parseJsonEvents(run.stdout ?? "") }
}

function readStoreTaskId(stateDir) {
  const tasksDir = join(stateDir, "tasks")
  if (!existsSync(tasksDir)) return undefined
  const file = readdirSync(tasksDir).find((entry) => entry.endsWith(".json"))
  return file === undefined ? undefined : file.replace(/\.json$/, "")
}

function readStoreJsonl(stateDir, taskId) {
  const path = join(stateDir, "logs", `${taskId}.jsonl`)
  return existsSync(path) ? readFileSync(path, "utf8") : ""
}

function markerCount(markerLog) {
  if (markerLog === undefined || !existsSync(markerLog)) return 0
  return readFileSync(markerLog, "utf8").trim().split(/\r?\n/).filter((line) => line.length > 0).length
}

function runMainFlow(senpiBin, checks, capture, pids) {
  const scenario = seedScenario(MAIN_SCRIPT, { withMarker: true })
  const { run, events } = driveSenpi(senpiBin, scenario, "spawn a background child, keep working, then follow up and read its output", pids)
  capture.main = { exit: run.status, signal: run.signal ?? null, stateDir: scenario.stateDir }
  const taskId = readStoreTaskId(scenario.stateDir)
  const jsonl = taskId === undefined ? "" : readStoreJsonl(scenario.stateDir, taskId)
  capture.mainStdout = run.stdout ?? ""
  capture.mainStderr = run.stderr ?? ""
  capture.mainJsonl = jsonl
  capture.mainTaskId = taskId
  const wake = findWakeNotification(events, taskId)
  const signatures = jsonlSignatures(jsonl)
  checks.spawn_background = run.status === 0 && typeof taskId === "string" && existsSync(join(scenario.stateDir, "tasks", `${taskId}.json`)) ? "PASS" : "FAIL"
  checks.unconditional_wake = wake.ok ? "PASS" : "FAIL"
  checks.followup_revive = findRevived(events) && JSON.stringify(events).includes(CHILD_SECOND) ? "PASS" : "FAIL"
  checks.task_output_full = findTranscript(events, CHILD_FIRST) ? "PASS" : "FAIL"
  checks.task_output_block = findBlockingTaskOutput(events) && checks.task_output_full === "PASS" ? "PASS" : "FAIL"
  checks.jsonl_sequence = matchesOrderedSubsequence(signatures, MAIN_FLOW_EXPECTED_SEQUENCE) ? "PASS" : "FAIL"
  checks.extension_suppression = markerCount(scenario.markerLog) === 1 ? "PASS" : "FAIL"
  capture.markerCount = markerCount(scenario.markerLog)
  capture.mainSignatures = signatures
  return scenario.sandbox
}

function runSyncFlow(senpiBin, checks, capture, pids) {
  const scenario = seedScenario(SYNC_SCRIPT)
  const { run, events } = driveSenpi(senpiBin, scenario, "run a synchronous task and return its answer", pids)
  capture.syncStdout = run.stdout ?? ""
  const inline = findInlineFinal(events, SYNC_FINAL)
  const noNotification = !JSON.stringify(events).includes("<task-notification>")
  checks.sync_inline_no_notification = run.status === 0 && inline && noNotification ? "PASS" : "FAIL"
  return scenario.sandbox
}

function runNegativeFlow(senpiBin, checks, capture, pids) {
  const scenario = seedScenario(NEGATIVE_SCRIPT)
  const { run, events } = driveSenpi(senpiBin, scenario, "route a task to a category that does not exist", pids)
  capture.negativeStdout = run.stdout ?? ""
  checks.negative_category_error = findCategoryListingError(events) ? "PASS" : "FAIL"
  return scenario.sandbox
}

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function killTree(pid) {
  spawnSync("pkill", ["-9", "-P", String(pid)])
  try {
    process.kill(pid, 9)
  } catch {
    // already dead
  }
}

function main() {
  const beforeDigest = digestDirectory(realSenpiAgentDir)
  const beforeSnapshot = snapshotDir(realSenpiAgentDir)
  const providedAgentDir = process.env.SENPI_CODING_AGENT_DIR ? "IGNORED" : "unset"
  const senpiBin = findOnPath(process.env.SENPI_BIN?.trim() || "senpi")
  if (senpiBin === null) {
    console.log(JSON.stringify({ result: "SKIP", reason: "senpi-binary-unavailable", providedAgentDir }))
    return
  }

  const checks = {}
  const capture = {}
  const pids = []
  try {
    for (const runner of [runMainFlow, runSyncFlow, runNegativeFlow]) runner(senpiBin, checks, capture, pids)
  } finally {
    for (const pid of pids) if (isAlive(pid)) killTree(pid)
  }

  const leakedPids = pids.filter(isAlive).length
  const afterDigest = digestDirectory(realSenpiAgentDir)
  const changedReal = changedRealPaths(beforeSnapshot, snapshotDir(realSenpiAgentDir))
  const realSenpiUntouched = changedReal.length === 0
  checks.real_senpi_untouched = realSenpiUntouched ? "PASS" : "FAIL"
  checks.no_leaked_pids = leakedPids === 0 ? "PASS" : "FAIL"

  const values = Object.values(checks)
  const result = values.length > 0 && values.every((verdict) => verdict === "PASS") ? "PASS" : "FAIL"
  const payload = {
    result,
    checks,
    leakedPids,
    spawnedPids: pids,
    realSenpiUntouched,
    realSenpiChangedPaths: changedReal,
    realSenpiDigestUnchanged: beforeDigest === afterDigest,
    providedAgentDir,
    markerChildExtensions: capture.markerCount,
    mainTaskId: capture.mainTaskId,
    mainSignatures: capture.mainSignatures,
    mainExit: capture.main?.exit,
  }
  writeEvidenceMaybe(capture, payload)
  console.log(JSON.stringify(payload))
}

function writeEvidenceMaybe(capture, payload) {
  const outDir = process.env.TASK_E2E_OUT_DIR
  if (outDir === undefined) return
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, "verdict.json"), `${JSON.stringify(payload, null, 2)}\n`)
  writeFileSync(join(outDir, "main.stdout.json.log"), capture.mainStdout ?? "")
  writeFileSync(join(outDir, "main.stderr.log"), capture.mainStderr ?? "")
  writeFileSync(join(outDir, "main.jsonl.log"), capture.mainJsonl ?? "")
  writeFileSync(join(outDir, "sync.stdout.json.log"), capture.syncStdout ?? "")
  writeFileSync(join(outDir, "negative.stdout.json.log"), capture.negativeStdout ?? "")
}

function findBlockingTaskOutput(events) {
  return JSON.stringify(events).includes('"name":"task_output"') && JSON.stringify(events).includes('"block":true')
}

function runSelfTest() {
  const wakeEvents = parseJsonEvents(`banner\n${JSON.stringify({ type: "custom", content: "<task-notification>\n- task \"e2echild\" (st_abc) completed in 3ms\n  Use task_send({ to: \"st_abc\" }) to continue, or task_output({ task_id: \"st_abc\" }) to read the full result." })}`)
  if (!findWakeNotification(wakeEvents, "st_abc").ok) throw new Error("self-test: wake notification must be detected")
  if (findWakeNotification(wakeEvents, "st_missing").ok) throw new Error("self-test: wake must not match a foreign task id")
  if (!findRevived(parseJsonEvents(JSON.stringify({ type: "toolResult", details: { kind: "revived", task_id: "st_abc", run_epoch: 1 } })))) throw new Error("self-test: revived must be detected")
  if (!findTranscript(parseJsonEvents(JSON.stringify({ type: "toolResult", content: `st_abc [completed] transcript via jsonl:\n${CHILD_FIRST}` })), CHILD_FIRST)) throw new Error("self-test: transcript must be detected")
  if (!findBlockingTaskOutput(parseJsonEvents(JSON.stringify({ name: "task_output", arguments: { block: true } })))) throw new Error("self-test: blocking output call must be detected")
  if (!findInlineFinal(parseJsonEvents(JSON.stringify({ type: "text", text: SYNC_FINAL })), SYNC_FINAL)) throw new Error("self-test: inline final must be detected")
  if (!findCategoryListingError(parseJsonEvents(JSON.stringify({ type: "toolResult", content: "Unknown category. Available categories: quick, deep." })))) throw new Error("self-test: category listing error must be detected")
  const signatures = jsonlSignatures([
    JSON.stringify({ type: "transition_applied", payload: { type: "transition_applied", status: "running", residency_state: "resident" } }),
    JSON.stringify({ type: "assistant_message", payload: { text: CHILD_FIRST } }),
    JSON.stringify({ type: "transition_applied", payload: { type: "transition_applied", status: "completed", residency_state: "resident" } }),
    JSON.stringify({ type: "revived", payload: { run_epoch: 1 } }),
    JSON.stringify({ type: "assistant_message", payload: { text: CHILD_SECOND } }),
    JSON.stringify({ type: "transition_applied", payload: { type: "transition_applied", status: "completed", residency_state: "resident" } }),
    JSON.stringify({ type: "destroyed", payload: { cause: "shutdown" } }),
  ].join("\n"))
  if (!matchesOrderedSubsequence(signatures, MAIN_FLOW_EXPECTED_SEQUENCE)) throw new Error("self-test: expected transition sequence must match")
  if (matchesOrderedSubsequence(["running/resident"], MAIN_FLOW_EXPECTED_SEQUENCE)) throw new Error("self-test: a partial sequence must not match")
  const logOnlyDelta = changedRealPaths(new Map([[SHARED_SENPI_LOG, "a"], ["settings.json", "x"]]), new Map([[SHARED_SENPI_LOG, "b"], ["settings.json", "x"]]))
  if (logOnlyDelta.length !== 0) throw new Error("self-test: a shared-log-only delta must not count as pollution")
  const configDelta = changedRealPaths(new Map([["settings.json", "x"]]), new Map([["settings.json", "y"]]))
  if (configDelta.length !== 1 || configDelta[0] !== "settings.json") throw new Error("self-test: a real config change must be reported")
  const removalDelta = changedRealPaths(new Map([["auth.json", "x"]]), new Map())
  if (removalDelta.length !== 1 || removalDelta[0] !== "auth.json") throw new Error("self-test: a real config removal must be reported")
  console.log("SELF-TEST OK")
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) runSelfTest()
  else main()
}

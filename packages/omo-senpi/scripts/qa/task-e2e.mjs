#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createSandbox, digestDirectory, seedSandbox } from "./drive.mjs"
import {
  changedRealPaths,
  classifyRealSenpiChanges,
  findBatchFanout,
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
import {
  BATCH_FINAL,
  BATCH_SCRIPT,
  CHILD_FIRST,
  CHILD_SECOND,
  MAIN_FOLLOWUP_SCRIPT,
  MAIN_SPAWN_SCRIPT,
  NEGATIVE_SCRIPT,
  SYNC_FINAL,
  SYNC_SCRIPT,
} from "./task-e2e-scenarios.mjs"
import { isAlive, killTree } from "./task-e2e-process.mjs"
import { runTaskResumeScenarios } from "./task-resume-e2e.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const mockProviderEntry = join(scriptDir, "task-e2e-mock-provider.ts")
const realSenpiAgentDir = join(homedir(), ".senpi", "agent")
const OMO_CONFIG = { categories: { mockcat: { description: "Local mock category pinned to the mock provider.", model: "omo-mock/mock-1" } } }

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

function driveSenpi(senpiBin, scenario, prompt, pids, sessionId) {
  const run = spawnSync(
    senpiBin,
    [
      "-e", mockProviderEntry,
      "-p", "--mode", "json",
      "--provider", "omo-mock", "--model", "mock-1",
      "--session-dir", scenario.sessionDir,
      ...(sessionId === undefined ? [] : ["--session-id", sessionId]),
      prompt,
    ],
    {
      cwd: scenario.sandbox.cwd,
      env: {
        ...process.env,
        OMO_CODING_AGENT_DIR: scenario.sandbox.agentDir,
        SENPI_CODING_AGENT_DIR: scenario.sandbox.agentDir,
        PI_CODING_AGENT_DIR: scenario.sandbox.agentDir,
        SENPI_CODING_AGENT_SESSION_DIR: scenario.sessionDir,
        HOME: scenario.sandbox.homeDir,
        USERPROFILE: scenario.sandbox.homeDir,
        XDG_CONFIG_HOME: scenario.sandbox.xdgConfigHome,
        XDG_DATA_HOME: scenario.sandbox.xdgDataHome,
        XDG_CACHE_HOME: scenario.sandbox.xdgCacheHome,
        PI_OFFLINE: "1",
        OMO_SENPI_QA: "1",
      },
      encoding: "utf8",
      timeout: 120_000,
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

function readStoreJsonl(stateDir, taskId) {
  const path = join(stateDir, "logs", `${taskId}.jsonl`)
  return existsSync(path) ? readFileSync(path, "utf8") : ""
}

function markerCount(markerLog) {
  if (markerLog === undefined || !existsSync(markerLog)) return 0
  return readFileSync(markerLog, "utf8").trim().split(/\r?\n/).filter((line) => line.length > 0).length
}

function runMainFlow(senpiBin, checks, capture, pids) {
  const scenario = seedScenario(MAIN_SPAWN_SCRIPT, { withMarker: true })
  const first = driveSenpi(senpiBin, scenario, "spawn a background child and keep working", pids)
  const taskId = readStoreTaskIds(scenario.stateDir)[0]
  const sessionId = sessionIdFromEvents(first.events)
  writeFileSync(join(scenario.sandbox.cwd, "mock-script.json"), `${JSON.stringify(MAIN_FOLLOWUP_SCRIPT, null, 2)}\n`)
  const second = driveSenpi(senpiBin, scenario, "follow up with the completed child and read its output", pids, sessionId)
  const jsonl = taskId === undefined ? "" : readStoreJsonl(scenario.stateDir, taskId)
  const events = [...first.events, ...second.events]
  capture.main = {
    firstExit: first.run.status,
    followupExit: second.run.status,
    firstSignal: first.run.signal ?? null,
    followupSignal: second.run.signal ?? null,
    stateDir: scenario.stateDir,
  }
  capture.mainStdout = `${first.run.stdout ?? ""}\n${second.run.stdout ?? ""}`
  capture.mainStderr = `${first.run.stderr ?? ""}\n${second.run.stderr ?? ""}`
  capture.mainJsonl = jsonl
  capture.mainTaskId = taskId
  const wake = findWakeNotification(first.events, taskId)
  const signatures = jsonlSignatures(jsonl)
  capture.mainEventSummary = summarizeEvents(second.events)
  checks.spawn_background = first.run.status === 0 && typeof taskId === "string" && existsSync(join(scenario.stateDir, "tasks", `${taskId}.json`)) ? "PASS" : "FAIL"
  checks.unconditional_wake = wake.ok ? "PASS" : "FAIL"
  checks.task_output_polling_guard = hasSuccessfulNoProgressFollowup(second.run.status, second.events) ? "PASS" : "FAIL"
  checks.jsonl_sequence = matchesOrderedSubsequence(signatures, MAIN_FLOW_EXPECTED_SEQUENCE.slice(0, 3)) ? "PASS" : "FAIL"
  checks.extension_suppression = markerCount(scenario.markerLog) === 2 ? "PASS" : "FAIL"
  capture.markerCount = markerCount(scenario.markerLog)
  capture.mainSignatures = signatures
  return scenario.sandbox
}

function runBatchFlow(senpiBin, checks, capture, pids) {
  const scenario = seedScenario(BATCH_SCRIPT)
  const { run, events } = driveSenpi(senpiBin, scenario, "fan out two synchronous child tasks", pids)
  const taskIds = readStoreTaskIds(scenario.stateDir)
  const items = findBatchFanout(events, 2)
  capture.batchStdout = run.stdout ?? ""
  capture.batchTaskIds = taskIds
  checks.batch_fanout_two_children = run.status === 0 && taskIds.length >= 2 && batchChildrenCompleted(events, items) ? "PASS" : "FAIL"
  return scenario.sandbox
}

function runSyncFlow(senpiBin, checks, capture, pids) {
  const scenario = seedScenario(SYNC_SCRIPT)
  const { run, events } = driveSenpi(senpiBin, scenario, "run a synchronous task and return its answer", pids)
  capture.syncStdout = run.stdout ?? ""
  const inline = findInlineFinal(events, SYNC_FINAL)
  const noNotification = !JSON.stringify(events).includes("task completion")
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

async function main() {
  const configuredOutDir = process.env.TASK_E2E_OUT_DIR?.trim()
  const outDir = configuredOutDir ? resolve(configuredOutDir) : undefined
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
  const sandboxes = []
  try {
    sandboxes.push(runMainFlow(senpiBin, checks, capture, pids))
    if (process.env.TASK_E2E_SCOPE !== "task-output") {
      for (const runner of [runBatchFlow, runSyncFlow, runNegativeFlow]) {
        sandboxes.push(runner(senpiBin, checks, capture, pids))
      }
      // Plan todo 22: quit->resume revival scenarios live in their own module (this driver is oversize).
      // Their raw session streams can contain machine-local or unrelated prompt data; publish only
      // the driver's sanitized aggregate receipt.
      sandboxes.push(...await runTaskResumeScenarios({ senpiBin, checks, capture, pids, outDir: undefined }))
    }
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
  const payload = {
    result,
    checks,
    leakedPids,
    spawnedPids: pids,
    realSenpiUntouched,
    realSenpiChangedPaths: qaAttributedPaths,
    concurrentRealSenpiChangedPaths: concurrentSessionPaths,
    allRealSenpiChangedPaths: allChangedRealPaths,
    realSenpiDigestUnchanged: beforeDigest === afterDigest,
    providedAgentDir,
    sandboxAgentDirs: sandboxes.map((sandbox) => sandbox.agentDir),
    sandboxCwds: sandboxes.map((sandbox) => sandbox.cwd),
    sandboxTokens,
    markerChildExtensions: capture.markerCount,
    mainTaskId: capture.mainTaskId,
    mainSignatures: capture.mainSignatures,
    mainEventSummary: capture.mainEventSummary,
    mainExit: capture.main?.followupExit,
    batchTaskIds: capture.batchTaskIds,
  }
  const receipt = evidenceReceipt(payload)
  writeEvidenceMaybe(outDir, receipt)
  console.log(JSON.stringify(receipt))
}

function evidenceReceipt(payload) {
  return {
    result: payload.result,
    checks: payload.checks,
    leakedPids: payload.leakedPids,
    realSenpiUntouched: payload.realSenpiUntouched,
    realSenpiChangedPathCount: payload.realSenpiChangedPaths.length,
    concurrentRealSenpiChangedPathCount: payload.concurrentRealSenpiChangedPaths.length,
    allRealSenpiChangedPathCount: payload.allRealSenpiChangedPaths.length,
    realSenpiDigestUnchanged: payload.realSenpiDigestUnchanged,
    sandboxCount: payload.sandboxAgentDirs.length,
    markerChildExtensions: payload.markerChildExtensions,
    mainSignatures: payload.mainSignatures,
    mainEventSummary: payload.mainEventSummary,
    mainExit: payload.mainExit,
    batchTaskCount: payload.batchTaskIds?.length ?? 0,
  }
}

function writeEvidenceMaybe(outDir, receipt) {
  if (outDir === undefined) return
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, "verdict.json"), `${JSON.stringify(receipt, null, 2)}\n`)
}

function findPeekTaskOutput(events) {
  return events.some((event) => {
    if (event?.name !== "task_output" && event?.toolName !== "task_output") return false
    const output = JSON.stringify(event)
    return !output.includes('"block"') && !output.includes('"timeout_ms"')
  })
}

function hasNoProgressAfterStatus(events) {
  const kinds = events
    .filter((event) => event?.type === "tool_execution_end" && event?.toolName === "task_output")
    .map((event) => event.result?.details?.kind)
  return kinds.some((kind, index) => kind === "no_progress" && kinds.slice(0, index).includes("status"))
}

function hasSuccessfulNoProgressFollowup(status, events) {
  return status === 0 && hasNoProgressAfterStatus(events)
}

function sessionIdFromEvents(events) {
  const header = events.find((event) => event?.type === "session" && typeof event?.id === "string")
  return header?.id
}

function summarizeEvents(events) {
  return events
    .filter((event) => event?.type === "tool_execution_start" || event?.type === "tool_execution_end")
    .slice(0, 32)
    .map((event) => {
      const toolName = typeof event?.toolName === "string"
        ? event.toolName
        : typeof event?.name === "string"
          ? event.name
          : undefined
      const details = event?.result?.details
      const state = typeof details?.kind === "string"
        ? details.kind
        : typeof details?.status === "string"
          ? details.status
          : undefined
      return [typeof event?.type === "string" ? event.type : "unknown", toolName, state].filter(Boolean).join(":")
    })
}

function batchChildrenCompleted(events, items) {
  if (items.length !== 2 || !items.every((item) => item?.status === "completed")) return false
  const output = JSON.stringify(events)
  return output.includes(`${BATCH_FINAL} one`) && output.includes(`${BATCH_FINAL} two`)
}

function runSelfTest() {
  const wakeEvents = parseJsonEvents(`banner\n${JSON.stringify({
    type: "custom",
    content: "task completion name:e2echild id:st_abc status:completed duration:3ms\nresult:\"done\"\nnext:Use task_send({ to: \"st_abc\", message: \"...\" }) to continue.",
  })}`)
  if (!findWakeNotification(wakeEvents, "st_abc").ok) throw new Error("self-test: wake notification must be detected")
  if (findWakeNotification(wakeEvents, "st_missing").ok) throw new Error("self-test: wake must not match a foreign task id")
  if (sessionIdFromEvents([{ type: "session", id: "ses_e2e" }]) !== "ses_e2e") throw new Error("self-test: session id must be recovered for the follow-up turn")
  if (!findRevived(parseJsonEvents(JSON.stringify({ type: "toolResult", details: { kind: "revived", task_id: "st_abc", run_epoch: 1 } })))) throw new Error("self-test: revived must be detected")
  if (!findTranscript(parseJsonEvents(JSON.stringify({ type: "toolResult", content: `st_abc [completed] transcript via jsonl:\n${CHILD_FIRST}` })), CHILD_FIRST)) throw new Error("self-test: transcript must be detected")
  if (!findPeekTaskOutput(parseJsonEvents(JSON.stringify({ name: "task_output", arguments: { mode: "tail" } })))) throw new Error("self-test: non-blocking output peek must be detected")
  if (!findPeekTaskOutput(parseJsonEvents(JSON.stringify({ toolName: "task_output", arguments: { mode: "tail" } })))) throw new Error("self-test: toolName output peek must be detected")
  if (findPeekTaskOutput(parseJsonEvents(JSON.stringify({ name: "task_output", arguments: { block: true } })))) throw new Error("self-test: legacy blocking output call must not count as a peek")
  const pollingEvents = parseJsonEvents([
    JSON.stringify({ type: "tool_execution_end", toolName: "task_output", result: { details: { kind: "status" } } }),
    JSON.stringify({ type: "tool_execution_end", toolName: "task_output", result: { details: { kind: "no_progress" } } }),
  ].join("\n"))
  if (!hasNoProgressAfterStatus(pollingEvents)) throw new Error("self-test: second unchanged task-output status read must be no_progress")
  if (hasNoProgressAfterStatus(pollingEvents.slice(0, 1))) throw new Error("self-test: one status read must not pass the polling guard")
  if (!hasSuccessfulNoProgressFollowup(0, pollingEvents)) throw new Error("self-test: successful follow-up with no_progress must pass")
  if (hasSuccessfulNoProgressFollowup(1, pollingEvents)) throw new Error("self-test: failed follow-up must not pass the polling guard")
  const taskOutputIndex = MAIN_FOLLOWUP_SCRIPT.parentSteps.findIndex((step) => step.type === "tool_call" && step.name === "task_output")
  if (taskOutputIndex !== 0) {
    throw new Error("self-test: scoped follow-up must begin with task_output")
  }
  if (MAIN_FOLLOWUP_SCRIPT.parentSteps.some((step) => step.type === "tool_call" && step.name === "task_send")) {
    throw new Error("self-test: scoped output follow-up must not depend on task revival")
  }
  if (!findInlineFinal(parseJsonEvents(JSON.stringify({ type: "text", text: SYNC_FINAL })), SYNC_FINAL)) throw new Error("self-test: inline final must be detected")
  if (!findCategoryListingError(parseJsonEvents(JSON.stringify({ type: "toolResult", content: "Unknown category. Available categories: quick, deep." })))) throw new Error("self-test: category listing error must be detected")
  const batchItems = findBatchFanout(parseJsonEvents(JSON.stringify({
    type: "tool_execution_end",
    toolName: "task",
    result: { details: { items: [{ task_id: "st_1" }, { task_id: "st_2" }] } },
  })), 2)
  if (batchItems.length !== 2) throw new Error("self-test: two-child batch fanout must be detected")
  const completedBatchEvents = parseJsonEvents(JSON.stringify({
    type: "tool_execution_end",
    toolName: "task",
    result: {
      content: [{ type: "text", text: `${BATCH_FINAL} one\n${BATCH_FINAL} two` }],
      details: {
        status: "completed",
        items: [
          { task_id: "st_1", status: "completed" },
          { task_id: "st_2", status: "completed" },
        ],
      },
    },
  }))
  const completedItems = findBatchFanout(completedBatchEvents, 2)
  if (!batchChildrenCompleted(completedBatchEvents, completedItems)) {
    throw new Error("self-test: completed batch children with both outputs must pass")
  }
  const pendingBatchEvents = parseJsonEvents(JSON.stringify({
    type: "tool_execution_end",
    toolName: "task",
    result: {
      content: [{ type: "text", text: `${BATCH_FINAL} one\n${BATCH_FINAL} two` }],
      details: {
        status: "completed",
        items: [
          { task_id: "st_1", status: "completed" },
          { task_id: "st_2", status: "running" },
        ],
      },
    },
  }))
  if (batchChildrenCompleted(pendingBatchEvents, findBatchFanout(pendingBatchEvents, 2))) {
    throw new Error("self-test: a pending batch child must fail")
  }
  const incompleteOutputBatchEvents = parseJsonEvents(JSON.stringify({
    type: "tool_execution_end",
    toolName: "task",
    result: {
      content: [{ type: "text", text: `${BATCH_FINAL} one` }],
      details: {
        status: "completed",
        items: [
          { task_id: "st_1", status: "completed" },
          { task_id: "st_2", status: "completed" },
        ],
      },
    },
  }))
  if (batchChildrenCompleted(incompleteOutputBatchEvents, findBatchFanout(incompleteOutputBatchEvents, 2))) {
    throw new Error("self-test: a missing batch output must fail")
  }
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
  const receipt = evidenceReceipt({
    result: "PASS",
    checks: { task_output_peek: "PASS" },
    leakedPids: 0,
    spawnedPids: [12345],
    realSenpiUntouched: true,
    realSenpiChangedPaths: [],
    concurrentRealSenpiChangedPaths: [],
    allRealSenpiChangedPaths: [],
    realSenpiDigestUnchanged: true,
    providedAgentDir: "unset",
    sandboxAgentDirs: ["/private/var/folders/user/sandbox/agent"],
    sandboxCwds: ["/private/var/folders/user/sandbox/project"],
    sandboxTokens: ["omo-senpi-qa-secretish"],
    markerChildExtensions: 1,
    mainTaskId: "st_opaque",
    mainSignatures: ["running/resident", "completed/resident"],
    mainEventSummary: ["task_output:completed"],
    mainExit: 0,
    batchTaskIds: ["st_batch"],
  })
  if (JSON.stringify(receipt).includes("12345") || JSON.stringify(receipt).includes("/private/var") || JSON.stringify(receipt).includes("st_opaque")) {
    throw new Error("self-test: evidence receipt must exclude host identifiers")
  }
  if (
    receipt.sandboxCount !== 1
    || receipt.batchTaskCount !== 1
    || receipt.checks.task_output_peek !== "PASS"
    || receipt.mainEventSummary[0] !== "task_output:completed"
  ) {
    throw new Error("self-test: evidence receipt must retain safe QA summary fields")
  }
  const receiptWithoutBatch = evidenceReceipt({
    ...receipt,
    checks: { task_output_peek: "PASS" },
    realSenpiChangedPaths: [],
    concurrentRealSenpiChangedPaths: [],
    allRealSenpiChangedPaths: [],
    sandboxAgentDirs: [],
  })
  if (receiptWithoutBatch.batchTaskCount !== 0) {
    throw new Error("self-test: evidence receipt must tolerate an absent batch capture")
  }
  console.log("SELF-TEST OK")
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) runSelfTest()
  else await main()
}

#!/usr/bin/env node
// Live proof of the restart wake-redelivery fix (incident 2026-09-08: a desktop server restart killed
// a parent turn right after senpi-task injected a child completion wake; the record still read
// {run_epoch:n, notified_epoch:n}, so reconcileUnnotifiedNotifications never redelivered it and
// nothing nudged the parent, which stayed silent until the user typed).
//
// Crash lane: the parent spawns ONE background child, goes idle, and the driver then releases the
// child's gate so the completion wake is appended to the parent JSONL while the parent is idle. The
// wake triggers a new parent turn that stalls at the model ("hang" step), and the driver SIGKILLs the
// process group there - after the wake line exists, before any assistant answer to it. Resuming the
// same session (--session-id) must redeliver EXACTLY ONE wake plus EXACTLY ONE
// omo-senpi:restart-continuation and stamp consumed_epoch === notified_epoch once the turn settles;
// a second resume must add neither. Control lane: the same run WITHOUT the kill shows one wake in
// total and zero continuations.
//
// Every wait is a content gate on the session JSONL or on the task record (bounded pollUntil), never
// a sleep: the driver alone decides when the child may finish and when the parent is killed.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { createSandbox } from "./drive.mjs"
import { isAlive } from "./task-e2e-process.mjs"
import {
  findTaskByName,
  pollUntil,
  seedResumeProject,
  sessionIdFromEvents,
  startResumeRun,
} from "./resume-e2e-runtime.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "..", "..", "..", "..")
const mockProviderEntry = join(scriptDir, "task-restart-redelivery-mock-provider.ts")
const DEFAULT_EVIDENCE_DIR = join(repoRoot, ".omo", "evidence", "omo-senpi-adapter", "restart-redelivery")
const POLL_MS = 60_000

const WAKE_TYPE = "omo-senpi:wake"
const COMPLETION_TYPE = "senpi-task.completion"
const CONTINUATION_TYPE = "omo-senpi:restart-continuation"

const CHILD_NAME = "wakechild"
const PARENT_IDLE_TOKEN = "RESTART_REDELIVERY_PARENT_IDLE"
const CONTROL_SETTLED_TOKEN = "RESTART_REDELIVERY_CONTROL_SETTLED"
const RESUME_SETTLED_TOKEN = "RESTART_REDELIVERY_RESUME_SETTLED"
const SECOND_RESUME_SETTLED_TOKEN = "RESTART_REDELIVERY_SECOND_RESUME_SETTLED"
const FIRST_PROMPT = "spawn one background child and wait for its completion notification"
const RESUME_PROMPT = "RESTART_REDELIVERY_RESUME_ONE trivial resumed prompt"
const SECOND_RESUME_PROMPT = "RESTART_REDELIVERY_RESUME_TWO trivial resumed prompt"

const OMO_CONFIG = {
  categories: { mockcat: { description: "Local mock category pinned to the mock provider.", model: "omo-mock/mock-1" } },
}

const spawnChild = () => ({
  type: "tool_call",
  name: "task",
  arguments: { category: "mockcat", prompt: "restart redelivery child unit", run_in_background: true, name: CHILD_NAME },
})

// Turn one ends with a plain text answer, so the parent is IDLE when the driver releases the child.
// The third step only runs in the turn the wake itself triggers.
function crashScript(childGate) {
  return { childGate, parentSteps: [spawnChild(), { type: "text", text: PARENT_IDLE_TOKEN }, { type: "hang" }] }
}

function controlScript(childGate) {
  return { childGate, parentSteps: [spawnChild(), { type: "text", text: PARENT_IDLE_TOKEN }, { type: "text", text: CONTROL_SETTLED_TOKEN }] }
}

// Same crash, but the turn the wake triggers first runs one instant tool call and stalls at the model
// AFTER it, so the killed tail is a toolResult entry - a tail shape sessionTailNeedsContinuation
// already classifies as interrupted. It isolates the redelivery chain from the tail predicate: if
// this lane redelivers and the custom_message-tail lane does not, only the predicate is at fault.
function toolStallScript(childGate) {
  return {
    childGate,
    parentSteps: [
      spawnChild(),
      { type: "text", text: PARENT_IDLE_TOKEN },
      { type: "tool_call", name: "read", arguments: { path: "mock-script.json" } },
      { type: "hang" },
    ],
  }
}

function resumeScript(token) {
  return { parentSteps: [{ type: "text", text: token }] }
}

// ---------------------------------------------------------------------------------------------
// Session JSONL analysis (pure; pinned by --self-test)
// ---------------------------------------------------------------------------------------------

export function parseSessionEntries(text) {
  const entries = []
  for (const line of String(text).split(/\r?\n/)) {
    if (line.trim().length === 0) continue
    try {
      entries.push(JSON.parse(line))
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
      // A torn final line means the process died mid-write; the next poll reads the complete file.
    }
  }
  return entries
}

// Delivered injections persist as custom_message entries. The idle-injection coordinator wraps every
// payload in ONE `omo-senpi:wake` message whose details list the wrapped customTypes; without a
// coordinator a payload is delivered under its own customType, so both shapes are recognized here.
export function injectionPayloads(entry) {
  if (!isRecord(entry) || entry.type !== "custom_message" || typeof entry.customType !== "string") return []
  if (entry.customType !== WAKE_TYPE) return [{ customType: entry.customType, details: entry.details }]
  if (!Array.isArray(entry.details)) return []
  return entry.details
    .filter(isRecord)
    .filter((payload) => typeof payload.customType === "string")
    .map((payload) => ({ customType: payload.customType, details: payload.details }))
}

export function completionTaskIds(entry) {
  const ids = []
  for (const payload of injectionPayloads(entry)) {
    if (payload.customType !== COMPLETION_TYPE) continue
    for (const detail of Array.isArray(payload.details) ? payload.details : []) {
      if (isRecord(detail) && typeof detail.task_id === "string") ids.push(detail.task_id)
    }
  }
  return ids
}

export function countWakes(entries, taskId) {
  return entries.filter((entry) => completionTaskIds(entry).includes(taskId)).length
}

export function countContinuations(entries) {
  return entries.filter((entry) => injectionPayloads(entry).some((payload) => payload.customType === CONTINUATION_TYPE)).length
}

export function firstWakeIndex(entries, taskId) {
  return entries.findIndex((entry) => completionTaskIds(entry).includes(taskId))
}

export function endsWithToolResult(entries) {
  const tail = entries.at(-1)
  return isRecord(tail) && tail.type === "message" && isRecord(tail.message) && tail.message.role === "toolResult"
}

export function hasAssistantMessage(entries) {
  return entries.some((entry) => isRecord(entry) && entry.type === "message" && isRecord(entry.message) && entry.message.role === "assistant")
}

export function hasUserPrompt(entries, text) {
  return entries.some((entry) => isRecord(entry) && entry.type === "message" && isRecord(entry.message)
    && entry.message.role === "user" && JSON.stringify(entry.message.content ?? "").includes(text))
}

// Session files are named `${timestamp}_${sessionId}.jsonl` (senpi session-manager), so the id is the
// suffix after the last underscore. Used as the fallback when a killed run never printed its header.
export function sessionIdFromFileName(file) {
  const name = basename(file).replace(/\.jsonl$/, "")
  const separator = name.lastIndexOf("_")
  return separator < 0 ? undefined : name.slice(separator + 1)
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// ---------------------------------------------------------------------------------------------
// Sandbox helpers
// ---------------------------------------------------------------------------------------------

function sessionsDir(sandbox) {
  return join(sandbox.root, "sessions")
}

function parentSessionFile(sandbox) {
  const dir = sessionsDir(sandbox)
  if (!existsSync(dir)) return undefined
  // Children persist under .omo/senpi-task/children/<id>/, so this dir only ever holds the parent.
  const files = readdirSync(dir).filter((entry) => entry.endsWith(".jsonl"))
  return files.length === 1 ? join(dir, files[0]) : undefined
}

function sessionEntries(file) {
  return file === undefined || !existsSync(file) ? [] : parseSessionEntries(readFileSync(file, "utf8"))
}

function sessionLines(file) {
  if (file === undefined || !existsSync(file)) return []
  return readFileSync(file, "utf8").split(/\r?\n/).filter((line) => line.trim().length > 0)
}

function taskRecordFor(sandbox) {
  return findTaskByName(sandbox.cwd, CHILD_NAME)
}

// Sandbox-local observer extension (same seam task-e2e.mjs uses for its marker extension): it records
// the session file's LAST line as every session_start fires. A resumed session_start is the moment the
// task component decides whether the previous turn was interrupted, and other extensions append their
// own startup entries to the same file, so this log is what makes a missing redelivery diagnosable.
function installSessionTailObserver(sandbox) {
  const logPath = join(sandbox.root, "session-start-tails.log")
  const extensionDir = join(sandbox.agentDir, "extensions")
  mkdirSync(extensionDir, { recursive: true })
  writeFileSync(join(extensionDir, "session-tail-observer.js"), `
const fs = process.getBuiltinModule("fs")
const LOG = ${JSON.stringify(logPath)}
export default function register(pi) {
  pi.on("session_start", (payload, ctx) => {
    const file = ctx?.sessionManager?.getSessionFile?.()
    let tail
    if (typeof file === "string" && fs.existsSync(file)) {
      const lines = fs.readFileSync(file, "utf8").split("\\n").filter((line) => line.trim().length > 0)
      tail = lines[lines.length - 1]
    }
    fs.appendFileSync(LOG, JSON.stringify({ reason: payload?.reason, hasSessionFile: typeof file === "string", tail }) + "\\n")
  })
}
`)
  return logPath
}

// The tail each session_start observed, reduced to the entry kinds the interruption predicate reads.
function observedSessionStartTails(logPath) {
  if (!existsSync(logPath)) return []
  return parseSessionEntries(readFileSync(logPath, "utf8")).map((observation) => {
    const tail = observation.tail === undefined ? undefined : parseSessionEntries(observation.tail)[0]
    return {
      hasSessionFile: observation.hasSessionFile,
      tailType: tail?.type,
      tailCustomType: tail?.customType,
      tailRole: tail?.message?.role,
    }
  })
}


function startRun(ctx, sandbox, script, options = {}) {
  const run = startResumeRun({
    senpiBin: ctx.senpiBin,
    sandbox,
    mockProviderEntry,
    script,
    prompt: options.prompt,
    sessionId: options.sessionId,
    // The provider is fully local (file-backed mock); disabling senpi's STARTUP network operations
    // keeps a flaky gateway from wedging a run before its extensions load (drive.mjs does the same).
    extraEnv: { PI_OFFLINE: "1" },
    onPid: (pid) => ctx.pids.push(pid),
  })
  ctx.runs.push(run)
  return run
}

// ---------------------------------------------------------------------------------------------
// Lanes
// ---------------------------------------------------------------------------------------------

async function runCrashLane(ctx) {
  const sandbox = createSandbox()
  ctx.sandboxes.push(sandbox)
  seedResumeProject(sandbox, OMO_CONFIG)
  const tailLog = installSessionTailObserver(sandbox)
  const childGate = join(sandbox.root, "child-release")
  const summary = {}

  const run1 = startRun(ctx, sandbox, crashScript(childGate), { prompt: FIRST_PROMPT })
  const idle = await pollUntil(
    () => readIdleState(sandbox),
    (value) => value.file !== undefined && value.taskId !== undefined && value.parentIdle,
    POLL_MS,
  )
  summary.taskId = idle.taskId
  summary.parentWentIdleBeforeChildRelease = idle.parentIdle === true
  if (!summary.parentWentIdleBeforeChildRelease || idle.file === undefined || idle.taskId === undefined) {
    return { ...summary, failure: "parent never reached the idle marker with a spawned child" }
  }

  // Release the child ONLY now: its completion wake therefore lands on an idle parent, is appended to
  // the parent JSONL, and triggers the turn that the mock provider stalls at the model.
  writeFileSync(childGate, "release\n")
  const wake = await pollUntil(
    () => {
      const entries = sessionEntries(idle.file)
      return { entries, index: firstWakeIndex(entries, idle.taskId) }
    },
    (value) => value.index >= 0,
    POLL_MS,
  )
  summary.wakeBeforeKill = wake.index >= 0 ? countWakes(wake.entries, idle.taskId) : 0
  if (wake.index < 0) return { ...summary, failure: "the completion wake never reached the parent JSONL" }

  run1.kill()
  const killed = await run1.completion
  const preResumeEntries = sessionEntries(idle.file)
  const preResumeLines = sessionLines(idle.file)
  const wakeIndexAtKill = firstWakeIndex(preResumeEntries, idle.taskId)
  summary.killedBySignal = killed.status === null
  summary.assistantAfterWakeBeforeKill = hasAssistantMessage(preResumeEntries.slice(wakeIndexAtKill + 1))
  // The tail the resumed session_start inspects: it decides whether the parent turn was interrupted,
  // so it is the single most diagnostic field when redelivery does not happen.
  summary.tailEntryTypeAtKill = preResumeEntries.at(-1)?.type
  summary.tailCustomTypeAtKill = preResumeEntries.at(-1)?.customType
  summary.recordAtKill = notificationOf(taskRecordFor(sandbox))

  const sessionId = sessionIdFromEvents(killed.events) ?? sessionIdFromFileName(idle.file)
  summary.sessionId = sessionId
  if (typeof sessionId !== "string") return { ...summary, failure: "could not resolve the parent session id to resume" }

  const run2 = startRun(ctx, sandbox, resumeScript(RESUME_SETTLED_TOKEN), { sessionId, prompt: RESUME_PROMPT })
  const resumed = await run2.completion
  summary.resumeExit = resumed.status
  // markConsumed runs on agent_settled; the record write that follows is what "the turn settled" means
  // durably, so gate on the record content instead of on the process exit alone.
  const consumed = await pollUntil(
    () => notificationOf(taskRecordFor(sandbox)),
    (value) => value !== undefined && value.consumed_epoch === value.notified_epoch,
    POLL_MS,
  )
  summary.recordAfterResume = consumed
  const afterResumeEntries = sessionEntries(idle.file)
  const resumedEntries = afterResumeEntries.slice(preResumeEntries.length)
  summary.resumeMarkerFound = hasUserPrompt(resumedEntries, "RESTART_REDELIVERY_RESUME_ONE")
  summary.resumeWakes = countWakes(resumedEntries, idle.taskId)
  summary.resumeContinuations = countContinuations(resumedEntries)
  summary.resumeSettled = JSON.stringify(resumedEntries).includes(RESUME_SETTLED_TOKEN)
  summary.sessionStartTails = observedSessionStartTails(tailLog)
  ctx.excerpt = sessionLines(idle.file).slice(preResumeLines.length)

  const run3 = startRun(ctx, sandbox, resumeScript(SECOND_RESUME_SETTLED_TOKEN), { sessionId, prompt: SECOND_RESUME_PROMPT })
  const second = await run3.completion
  summary.secondResumeExit = second.status
  summary.secondResumeStderrTail = tailOf(second.stderr)
  const secondEntries = sessionEntries(idle.file).slice(afterResumeEntries.length)
  summary.secondResumeMarkerFound = hasUserPrompt(secondEntries, "RESTART_REDELIVERY_RESUME_TWO")
  summary.secondResumeWakes = countWakes(secondEntries, idle.taskId)
  summary.secondResumeContinuations = countContinuations(secondEntries)
  summary.recordAfterSecondResume = notificationOf(taskRecordFor(sandbox))
  return summary
}

// Diagnostic twin of the crash lane: identical up to the kill, but the parent is killed while the
// wake-triggered turn sits in a tool call (assistant toolCall tail) instead of at the model.
async function runInterruptedToolTailLane(ctx) {
  const sandbox = createSandbox()
  ctx.sandboxes.push(sandbox)
  seedResumeProject(sandbox, OMO_CONFIG)
  const childGate = join(sandbox.root, "child-release")
  const summary = {}

  const run1 = startRun(ctx, sandbox, toolStallScript(childGate), { prompt: FIRST_PROMPT })
  const idle = await pollUntil(
    () => readIdleState(sandbox),
    (value) => value.file !== undefined && value.taskId !== undefined && value.parentIdle,
    POLL_MS,
  )
  summary.taskId = idle.taskId
  if (idle.file === undefined || idle.taskId === undefined) {
    return { ...summary, failure: "tool-tail parent never reached the idle marker with a spawned child" }
  }

  writeFileSync(childGate, "release\n")
  const stalled = await pollUntil(
    () => {
      const entries = sessionEntries(idle.file)
      return { entries, wakeIndex: firstWakeIndex(entries, idle.taskId), toolTail: endsWithToolResult(entries) }
    },
    (value) => value.wakeIndex >= 0 && value.toolTail,
    POLL_MS,
  )
  summary.wakeBeforeKill = countWakes(stalled.entries, idle.taskId)
  if (!stalled.toolTail) return { ...summary, failure: "the wake-triggered turn never stalled on a toolResult tail" }

  run1.kill()
  const killed = await run1.completion
  const preResumeEntries = sessionEntries(idle.file)
  summary.killedBySignal = killed.status === null
  summary.tailEntryTypeAtKill = preResumeEntries.at(-1)?.type
  summary.tailRoleAtKill = preResumeEntries.at(-1)?.message?.role
  const sessionId = sessionIdFromEvents(killed.events) ?? sessionIdFromFileName(idle.file)
  summary.sessionId = sessionId
  if (typeof sessionId !== "string") return { ...summary, failure: "could not resolve the tool-tail session id to resume" }

  const run2 = startRun(ctx, sandbox, resumeScript(RESUME_SETTLED_TOKEN), { sessionId, prompt: RESUME_PROMPT })
  const resumed = await run2.completion
  summary.resumeExit = resumed.status
  summary.resumeStderrTail = tailOf(resumed.stderr)
  const resumedEntries = sessionEntries(idle.file).slice(preResumeEntries.length)
  summary.resumeWakes = countWakes(resumedEntries, idle.taskId)
  summary.resumeContinuations = countContinuations(resumedEntries)
  summary.recordAfterResume = notificationOf(taskRecordFor(sandbox))
  return summary
}

// The last few stderr lines of a resumed run, kept small for the summary payload.
function tailOf(text) {
  const lines = String(text ?? "").split(/\r?\n/).filter((line) => line.trim().length > 0)
  return lines.length === 0 ? undefined : lines.slice(-4).join(" | ").slice(0, 400)
}

async function runControlLane(ctx) {
  const sandbox = createSandbox()
  ctx.sandboxes.push(sandbox)
  seedResumeProject(sandbox, OMO_CONFIG)
  const childGate = join(sandbox.root, "child-release")
  const summary = {}

  const run = startRun(ctx, sandbox, controlScript(childGate), { prompt: FIRST_PROMPT })
  const idle = await pollUntil(
    () => readIdleState(sandbox),
    (value) => value.file !== undefined && value.taskId !== undefined && value.parentIdle,
    POLL_MS,
  )
  summary.taskId = idle.taskId
  if (idle.file === undefined || idle.taskId === undefined) {
    return { ...summary, failure: "control parent never reached the idle marker with a spawned child" }
  }

  writeFileSync(childGate, "release\n")
  const result = await run.completion
  summary.exit = result.status
  const entries = sessionEntries(idle.file)
  summary.wakes = countWakes(entries, idle.taskId)
  summary.continuations = countContinuations(entries)
  summary.settled = JSON.stringify(entries).includes(CONTROL_SETTLED_TOKEN)
  summary.record = notificationOf(taskRecordFor(sandbox))
  return summary
}

function notificationOf(record) {
  return record?.notification === undefined ? undefined : { ...record.notification }
}

// The parent is idle for this lane's purposes once its first turn's assistant answer is persisted.
function readIdleState(sandbox) {
  const file = parentSessionFile(sandbox)
  const record = taskRecordFor(sandbox)
  const text = file === undefined ? "" : readFileSync(file, "utf8")
  return { file, taskId: record?.task_id, parentIdle: text.includes(PARENT_IDLE_TOKEN) }
}

// ---------------------------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------------------------

function buildChecks(crash, toolTail, control, leakedPids = []) {
  return {
    tool_tail_redelivers_one_wake: verdict(toolTail.resumeExit === 0 && toolTail.resumeWakes === 1),
    tool_tail_emits_one_continuation: verdict(toolTail.resumeContinuations === 1),
    crash_child_spawned: verdict(typeof crash.taskId === "string"),
    crash_wake_landed_before_kill: verdict(crash.wakeBeforeKill === 1),
    crash_killed_before_next_assistant: verdict(crash.killedBySignal === true && crash.assistantAfterWakeBeforeKill === false),
    resume_ran_same_session: verdict(crash.resumeExit === 0 && crash.resumeMarkerFound === true && crash.resumeSettled === true),
    resume_redelivers_exactly_one_wake: verdict(crash.resumeWakes === 1),
    resume_emits_exactly_one_continuation: verdict(crash.resumeContinuations === 1),
    resume_stamps_consumed_epoch: verdict(
      crash.recordAfterResume !== undefined
      && crash.recordAfterResume.consumed_epoch === crash.recordAfterResume.notified_epoch
      && crash.recordAfterResume.notified_epoch >= 0,
    ),
    second_resume_adds_no_wake: verdict(crash.secondResumeExit === 0 && crash.secondResumeMarkerFound === true && crash.secondResumeWakes === 0),
    second_resume_adds_no_continuation: verdict(crash.secondResumeContinuations === 0),
    control_single_wake_no_kill: verdict(control.exit === 0 && control.settled === true && control.wakes === 1),
    control_no_continuation: verdict(control.continuations === 0),
    no_leaked_pids: verdict(leakedPids.length === 0),
  }
}

function verdict(ok) {
  return ok === true ? "PASS" : "FAIL"
}

function parseArgs(argv) {
  const options = { selfTest: argv.includes("--self-test"), keepSandbox: argv.includes("--keep-sandbox"), evidenceDir: DEFAULT_EVIDENCE_DIR }
  const index = argv.indexOf("--evidence-dir")
  if (index >= 0 && argv[index + 1] !== undefined) options.evidenceDir = resolve(argv[index + 1])
  return options
}

async function main(options) {
  const senpiBin = process.env.SENPI_BIN?.trim() || "senpi"
  const ctx = { senpiBin, pids: [], runs: [], sandboxes: [], excerpt: [] }
  let crash = {}
  let toolTail = {}
  let control = {}
  let failure
  try {
    crash = await runCrashLane(ctx)
    toolTail = await runInterruptedToolTailLane(ctx)
    control = await runControlLane(ctx)
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  } finally {
    for (const run of ctx.runs) run.kill()
    await Promise.all(ctx.runs.map((run) => run.completion))
    if (!options.keepSandbox) for (const sandbox of ctx.sandboxes) rmSync(sandbox.root, { recursive: true, force: true })
  }

  const leakedPids = ctx.pids.filter(isAlive)
  const checks = buildChecks(crash, toolTail, control, leakedPids)
  const values = Object.values(checks)
  const result = failure === undefined && values.length > 0 && values.every((value) => value === "PASS") ? "PASS" : "FAIL"
  const payload = {
    result,
    ...(failure === undefined ? {} : { failure }),
    ...(crash.failure === undefined ? {} : { crashFailure: crash.failure }),
    ...(toolTail.failure === undefined ? {} : { toolTailFailure: toolTail.failure }),
    ...(control.failure === undefined ? {} : { controlFailure: control.failure }),
    checks,
    crash,
    toolTail,
    control,
    leakedPids,
    spawnedPids: ctx.pids,
    sandboxesRemoved: options.keepSandbox ? false : ctx.sandboxes.every((sandbox) => !existsSync(sandbox.root)),
    sandboxRoots: ctx.sandboxes.map((sandbox) => sandbox.root),
    senpiBin,
  }
  writeEvidence(options.evidenceDir, payload, ctx.excerpt)
  console.log(JSON.stringify(payload))
  return result === "PASS" ? 0 : 1
}

function writeEvidence(outDir, payload, excerpt) {
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, "a3-e2e.json"), `${JSON.stringify(payload, null, 2)}\n`)
  if (excerpt.length > 0) writeFileSync(join(outDir, "a3-resumed-session-excerpt.jsonl"), `${excerpt.join("\n")}\n`)
}

function runSelfTest() {
  const wakeEntry = {
    type: "custom_message",
    customType: WAKE_TYPE,
    details: [{ customType: COMPLETION_TYPE, details: [{ task_id: "st_abc", status: "completed" }] }],
  }
  const continuationEntry = {
    type: "custom_message",
    customType: WAKE_TYPE,
    details: [{ customType: CONTINUATION_TYPE, details: {} }],
  }
  const bareCompletionEntry = { type: "custom_message", customType: COMPLETION_TYPE, details: [{ task_id: "st_abc" }] }
  const entries = [wakeEntry, continuationEntry, bareCompletionEntry]
  if (countWakes(entries, "st_abc") !== 2) throw new Error("self-test: wrapped and bare completion wakes must both count")
  if (countWakes(entries, "st_other") !== 0) throw new Error("self-test: a foreign task id must not match a wake")
  if (countContinuations(entries) !== 1) throw new Error("self-test: exactly one continuation must be counted")
  if (firstWakeIndex(entries, "st_abc") !== 0) throw new Error("self-test: the first wake index must point at the wake entry")
  const assistantTail = [{ type: "message", message: { role: "assistant", content: [] } }]
  if (!hasAssistantMessage(assistantTail)) throw new Error("self-test: an assistant entry must be detected")
  if (hasAssistantMessage(entries)) throw new Error("self-test: custom messages must not count as assistant answers")
  if (!hasUserPrompt([{ type: "message", message: { role: "user", content: [{ type: "text", text: RESUME_PROMPT }] } }], "RESTART_REDELIVERY_RESUME_ONE")) {
    throw new Error("self-test: the resume marker prompt must be detected")
  }
  if (hasUserPrompt(assistantTail, "RESTART_REDELIVERY_RESUME_ONE")) throw new Error("self-test: an assistant entry must not satisfy the resume marker")
  if (parseSessionEntries(`${JSON.stringify(wakeEntry)}\n{"type":"messa`).length !== 1) {
    throw new Error("self-test: a torn final line must be skipped, not thrown")
  }
  if (sessionIdFromFileName("/tmp/sessions/2026-09-10T15-11-00_abc123.jsonl") !== "abc123") {
    throw new Error("self-test: session id must be parsed from the session file name")
  }
  const crashPass = {
    taskId: "st_abc", wakeBeforeKill: 1, killedBySignal: true, assistantAfterWakeBeforeKill: false,
    resumeExit: 0, resumeMarkerFound: true, resumeSettled: true, resumeWakes: 1, resumeContinuations: 1,
    recordAfterResume: { run_epoch: 0, notified_epoch: 0, consumed_epoch: 0 },
    secondResumeExit: 0, secondResumeMarkerFound: true, secondResumeWakes: 0, secondResumeContinuations: 0,
  }
  const toolTailPass = { resumeExit: 0, resumeWakes: 1, resumeContinuations: 1 }
  const controlPass = { exit: 0, settled: true, wakes: 1, continuations: 0 }
  if (Object.values(buildChecks(crashPass, toolTailPass, controlPass)).some((value) => value !== "PASS")) {
    throw new Error("self-test: a fully satisfied scenario must pass every check")
  }
  const missedRedelivery = buildChecks({ ...crashPass, resumeWakes: 0, resumeContinuations: 0 }, toolTailPass, controlPass)
  if (missedRedelivery.resume_redelivers_exactly_one_wake !== "FAIL" || missedRedelivery.resume_emits_exactly_one_continuation !== "FAIL") {
    throw new Error("self-test: the incident shape (no redelivery, no nudge) must fail")
  }
  const doubleDelivery = buildChecks({ ...crashPass, secondResumeWakes: 1, secondResumeContinuations: 1 }, toolTailPass, controlPass)
  if (doubleDelivery.second_resume_adds_no_wake !== "FAIL" || doubleDelivery.second_resume_adds_no_continuation !== "FAIL") {
    throw new Error("self-test: a repeated resume delivery must fail")
  }
  const staleConsumption = buildChecks({ ...crashPass, recordAfterResume: { run_epoch: 0, notified_epoch: 0, consumed_epoch: -1 } }, toolTailPass, controlPass)
  if (staleConsumption.resume_stamps_consumed_epoch !== "FAIL") throw new Error("self-test: an unconsumed epoch must fail")
  const noisyControl = buildChecks(crashPass, toolTailPass, { ...controlPass, continuations: 1 })
  if (noisyControl.control_no_continuation !== "FAIL") throw new Error("self-test: a continuation on the normal path must fail")
  if (buildChecks(crashPass, toolTailPass, controlPass, [4242]).no_leaked_pids !== "FAIL") {
    throw new Error("self-test: a surviving spawned pid must fail")
  }
  const brokenToolTail = buildChecks(crashPass, { ...toolTailPass, resumeWakes: 0, resumeContinuations: 0 }, controlPass)
  if (brokenToolTail.tool_tail_redelivers_one_wake !== "FAIL" || brokenToolTail.tool_tail_emits_one_continuation !== "FAIL") {
    throw new Error("self-test: a missing redelivery on the already-interrupted tail must fail")
  }
  if (!endsWithToolResult([{ type: "message", message: { role: "toolResult", content: [] } }])) {
    throw new Error("self-test: a toolResult tail must be detected")
  }
  if (endsWithToolResult(assistantTail)) throw new Error("self-test: an assistant tail must not count as a tool stall")
  console.log("SELF-TEST OK")
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseArgs(process.argv.slice(2))
  if (options.selfTest) runSelfTest()
  else process.exit(await main(options))
}

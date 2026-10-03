import { spawn } from "node:child_process"
import { mkdirSync, rmSync, watch, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { isolatedChildEnv, sandboxStateDir } from "./sandbox-child-env.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const { createSandbox, seedSandbox } = await import(pathToFileURL(join(scriptDir, "drive.mjs")).href)
const { readRecords, readTaskEventTypes, pidAlive } = await import(pathToFileURL(join(scriptDir, "task-rpc-e2e-helpers.mjs")).href)
const { killProcessGroup } = await import(pathToFileURL(join(scriptDir, "team-e2e-process.mjs")).href)

const mockProviderEntry = join(scriptDir, "task-rpc-e2e-mock-provider.ts")
const CHILD_FINAL_TEXT = "omo rpc child mock work complete"
const PROJECT_OMO_CONFIG = {
  task: { default_execution_mode: "process" },
  categories: { proc: { description: "Process-mode mock category.", model: "omo-mock/mock-1" } },
}
const RECONCILE_PROJECT_OMO_CONFIG = {
  ...PROJECT_OMO_CONFIG,
  task: { ...PROJECT_OMO_CONFIG.task, reattach_on_reconcile: false },
}
const CHILD_STEPS_COMPLETE = [{ type: "text", text: CHILD_FINAL_TEXT }]
const CHILD_STEPS_HANG = [{ type: "hang" }]

export const SCENARIO_A_STEPS = [
  { type: "tool_call", name: "task", arguments: { category: "proc", run_in_background: true, name: "p1", prompt: "Do the rpc child work and stop." } },
  { type: "tool_call", name: "task_send", arguments: { to: "p1", message: "steer: keep going" } },
  { type: "tool_call", name: "task_output", arguments: { name: "p1", mode: "status" } },
  { type: "tool_call", name: "task_output", arguments: { name: "p1", mode: "status" } },
  { type: "text", text: "rpc-process scenario A complete" },
]

const RECONCILE_RELAUNCH_STEPS = [
  { type: "text", text: "reconcile relaunch complete" },
]

const hangingChildSteps = (name) => [
  { type: "tool_call", name: "task", arguments: { category: "proc", run_in_background: true, name, prompt: "hang until signalled" } },
  { type: "tool_call", name: "task_output", arguments: { name, mode: "status" } },
  { type: "hang" },
]

const runningRpcChild = (r) => r.execution_mode === "process" && r.status === "running" && typeof r.pid === "number"

function childArgv(sessionDir, prompt) {
  return ["-e", mockProviderEntry, "-p", "--mode", "json", "--provider", "omo-mock", "--model", "mock-1", "--session-dir", sessionDir, prompt]
}

function childEnv(sandbox, sessionDir, senpiBin) {
  return { ...isolatedChildEnv(process.env, sandbox.agentDir), SENPI_BIN: senpiBin, SENPI_CODING_AGENT_DIR: sandbox.agentDir, XDG_CONFIG_HOME: sandbox.xdgConfigHome, SENPI_CODING_AGENT_SESSION_DIR: sessionDir, OMO_SENPI_QA: "1" }
}

function writeScript(sandbox, parentSteps, childSteps) {
  writeFileSync(join(sandbox.cwd, "mock-script.json"), `${JSON.stringify({ parentSteps, childSteps }, null, 2)}\n`)
}

// Every scenario gets a brand-new agent dir, and SENPI_CODING_AGENT_DIR is what omo resolves its
// omo-native state dir from, so onboarding wins its once-per-install claim on EVERY run and fires a
// triggerTurn message from session_start. That turn starts before print mode issues the harness
// prompt, so print mode's bare prompt hits an already-streaming session, senpi rejects it with
// "Agent is already processing", and the host exits 1 having persisted no task record. Pre-claiming
// the marker keeps the scripted scenario in control of the first turn, as it is for a real user who
// already onboarded.
function claimOnboardingMarker(agentDir) {
  const stateDir = join(agentDir, "omo-senpi", "omo-native")
  mkdirSync(stateDir, { recursive: true })
  writeFileSync(
    join(stateDir, "onboarding-completed"),
    `${JSON.stringify({ completedAt: new Date().toISOString(), version: 1 })}\n`,
  )
}

export function prepareScenarioSandbox(projectConfig = PROJECT_OMO_CONFIG) {
  const sandbox = createSandbox()
  seedSandbox(sandbox)
  claimOnboardingMarker(sandbox.agentDir)
  const sessionDir = join(sandbox.root, "sessions")
  mkdirSync(sessionDir, { recursive: true })
  mkdirSync(join(sandbox.cwd, ".omo"), { recursive: true })
  writeFileSync(join(sandbox.cwd, ".omo", "omo.json"), `${JSON.stringify(projectConfig, null, 2)}\n`)
  const stateDir = sandboxStateDir(sandbox)
  mkdirSync(join(stateDir, "tasks"), { recursive: true })
  mkdirSync(join(stateDir, "logs"), { recursive: true })
  return { sandbox, sessionDir, stateDir }
}

export async function driveSenpi(senpiBin, sandbox, sessionDir, parentSteps, childSteps = CHILD_STEPS_COMPLETE, prompt = "run the rpc-process task e2e") {
  writeScript(sandbox, parentSteps, childSteps)
  const child = spawn(senpiBin, childArgv(sessionDir, prompt), {
    cwd: sandbox.cwd,
    env: childEnv(sandbox, sessionDir, senpiBin),
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    windowsHide: true,
  })
  let stdout = ""
  let stderr = ""
  child.stdout?.setEncoding("utf8")
  child.stderr?.setEncoding("utf8")
  child.stdout?.on("data", (chunk) => { stdout += chunk })
  child.stderr?.on("data", (chunk) => { stderr += chunk })
  const [status, signal] = await new Promise((resolve) => {
    child.once("close", (code, closeSignal) => resolve([code, closeSignal]))
    child.once("error", () => resolve([null, null]))
  })
  return { status, signal, stdout, stderr }
}

function driveSenpiAsync(senpiBin, sandbox, sessionDir, parentSteps, childSteps, prompt) {
  writeScript(sandbox, parentSteps, childSteps)
  return spawn(senpiBin, childArgv(sessionDir, prompt), {
    cwd: sandbox.cwd,
    env: childEnv(sandbox, sessionDir, senpiBin),
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
  })
}

export async function killSenpiHost(child, terminate = killProcessGroup) {
  if (typeof child.pid !== "number" || child.exitCode !== null || child.signalCode !== null) return true
  return terminate(child.pid)
}

function waitForChildClose(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.off("close", onClose)
      reject(new Error(`timed out waiting ${timeoutMs}ms for pid=${child.pid ?? "unknown"} to close`))
    }, timeoutMs)
    const onClose = () => {
      clearTimeout(timeout)
      resolve()
    }
    child.once("close", onClose)
  })
}

// The task state may not exist yet, or a record may be mid-write: neither is a harness failure.
function readRecordsLenient(stateDir) {
  try {
    return readRecords(stateDir)
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return []
    throw error
  }
}

const RECORD_RECHECK_MS = 250

function waitForRecord(stateDir, predicate, timeoutMs) {
  const tasksDir = join(stateDir, "tasks")
  const logsDir = join(stateDir, "logs")
  const find = () => readRecordsLenient(stateDir).find(predicate)
  const existing = find()
  if (existing !== undefined) return Promise.resolve(existing)
  return new Promise((resolve, reject) => {
    let settled = false
    const watchers = [tasksDir, logsDir].map((dir) => watch(dir, { persistent: false }, () => {
      const match = find()
      if (match !== undefined) finish(match)
    }))
    // File watchers drop events under load (macOS FSEvents, Windows runners), and a dropped create
    // event would read as a missing child. A short re-read backs the watchers up until the wait ends.
    const recheck = setInterval(() => {
      const match = find()
      if (match !== undefined) finish(match)
    }, RECORD_RECHECK_MS)
    recheck.unref?.()
    const closeWatchers = () => {
      clearInterval(recheck)
      watchers.forEach((watcher) => watcher.close())
    }
    const finish = (match) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      closeWatchers()
      resolve(match)
    }
    const timeout = setTimeout(() => finish(undefined), timeoutMs)
    for (const watcher of watchers) {
      watcher.on("error", (error) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        closeWatchers()
        reject(error)
      })
    }
    // The producer may have completed an atomic write between the initial read and watch setup.
    const match = find()
    if (match !== undefined) finish(match)
  })
}

// The parent Senpi host starts cold on every scenario: on a loaded Windows runner its startup alone
// can take most of a minute before it even creates the task. Give that phase its own budget, then
// time the child spawn separately, so a slow parent start is not misread as a missing child.
const PARENT_TASK_CREATE_MS = 120_000
const CHILD_SPAWN_MS = 40_000

export async function waitForRunningRpcChild(stateDir, name, budgets = {}) {
  const { parentTaskCreateMs = PARENT_TASK_CREATE_MS, childSpawnMs = CHILD_SPAWN_MS } = budgets
  const created = await waitForRecord(stateDir, (r) => r.name === name, parentTaskCreateMs)
  if (created === undefined) return undefined
  return waitForRecord(stateDir, (r) => r.name === name && runningRpcChild(r), childSpawnMs)
}

async function cleanupSenpiHost(child) {
  const terminated = await killSenpiHost(child)
  if (!terminated) throw new Error(`could not terminate Senpi host pid=${child.pid ?? "unknown"}`)
  await waitForChildClose(child, 15_000)
}

/** The external-kill check proves a different, honest outcome per platform (#9471). */
export const KILL_CHECK = process.platform === "win32" ? "external_termination_reports_unexpected_exit" : "kill_marks_error_killed_true"

export async function runKillCheck(senpiBin) {
  const { sandbox, sessionDir, stateDir } = prepareScenarioSandbox()
  const parent = driveSenpiAsync(senpiBin, sandbox, sessionDir, hangingChildSteps("pk"), CHILD_STEPS_HANG, "drive the kill scenario")
  try {
    const running = await waitForRunningRpcChild(stateDir, "pk")
    if (running === undefined) {
      const seen = readRecordsLenient(stateDir).find((r) => r.name === "pk")
      const seenMessage = typeof seen?.error_message === "string" ? seen.error_message : ""
      return {
        check: KILL_CHECK,
        verdict: "FAIL",
        reason: "no running rpc child appeared to kill",
        facts: {
          recordSeen: seen !== undefined,
          status: seen?.status,
          pid: seen?.pid,
          execution_mode: seen?.execution_mode,
          runner_kind: seen?.runner_kind,
          host_session: seen?.host_session !== undefined,
          residency_state: seen?.residency_state,
          created_at: seen?.created_at,
          updated_at: seen?.updated_at,
          checked_at: new Date().toISOString(),
          error_message: seenMessage,
          error_message_lines: seenMessage.split("\n"),
        },
      }
    }
    try {
      process.kill(running.pid, "SIGKILL")
    } catch {
      // already gone counts as killed
    }
    // POSIX: an external SIGKILL carries its signal, so the task records killed=true. Windows: an
    // external TerminateProcess is a plain exit code 1, indistinguishable from a crash, and the runner
    // never reads stderr to guess (#9471), so the task records an unexpected exit, killed=false.
    const expectKilled = process.platform !== "win32"
    const settled = await waitForRecord(stateDir, (r) => r.task_id === running.task_id && r.status === "error", 15_000)
    const latest = readRecords(stateDir).find((r) => r.task_id === running.task_id)
    const errorMessage = typeof latest?.error_message === "string" ? latest.error_message : ""
    const pass = settled !== undefined
      && (expectKilled ? settled.killed === true : settled.killed !== true && errorMessage.startsWith("RPC child exited unexpectedly (exit code"))
    return {
      check: KILL_CHECK,
      verdict: pass ? "PASS" : "FAIL",
      ...(pass ? {} : { reason: expectKilled ? "kill did not yield status=error killed:true" : "external termination did not yield status=error killed:false with an unexpected-exit message" }),
      facts: { pid: running.pid, status: latest?.status, recordedKilled: latest?.killed, error_message: errorMessage, error_message_lines: errorMessage.split("\n") },
    }
  } finally {
    await cleanupSenpiHost(parent)
    rmSync(sandbox.root, { recursive: true, force: true })
  }
}

export async function runReconcileCheck(senpiBin) {
  const { sandbox, sessionDir, stateDir } = prepareScenarioSandbox(RECONCILE_PROJECT_OMO_CONFIG)
  const parent = driveSenpiAsync(senpiBin, sandbox, sessionDir, hangingChildSteps("pr"), CHILD_STEPS_HANG, "drive the reconcile scenario")
  let orphanPid
  try {
    const running = await waitForRunningRpcChild(stateDir, "pr")
    if (running === undefined) {
      return { check: "reconcile_lost_terminates_orphan", verdict: "FAIL", reason: "no running rpc child appeared to reconcile" }
    }
    orphanPid = running.pid
    if (parent.exitCode !== null || parent.signalCode !== null) {
      return {
        check: "reconcile_lost_terminates_orphan",
        verdict: "FAIL",
        reason: "parent exited before crash injection",
      }
    }
    await cleanupSenpiHost(parent)
    const relaunch = await driveSenpi(senpiBin, sandbox, sessionDir, RECONCILE_RELAUNCH_STEPS, CHILD_STEPS_COMPLETE, "relaunch for reconcile")
    const lost = readRecords(stateDir).find((r) => r.task_id === running.task_id && r.status === "lost")
    const eventTypes = readTaskEventTypes(stateDir, running.task_id)
    const lostEvent = eventTypes.includes("reconcile_lost")
    const orphanDead = pidAlive(orphanPid) === false
    const pass = relaunch.status === 0 && lost !== undefined && lostEvent && orphanDead
    return {
      check: "reconcile_lost_terminates_orphan",
      verdict: pass ? "PASS" : "FAIL",
      ...(pass ? {} : {
        reason: `relaunchOk=${relaunch.status === 0} lostRecord=${lost !== undefined} lostEvent=${lostEvent} orphanDead=${orphanDead}`,
      }),
      facts: {
        orphanPid,
        orphanDead,
        status: lost?.status,
        eventTypes,
        breadcrumb: (lost?.error_message ?? "").slice(0, 120),
      },
    }
  } finally {
    await cleanupSenpiHost(parent)
    if (typeof orphanPid === "number" && pidAlive(orphanPid)) {
      try {
        process.kill(orphanPid, "SIGKILL")
      } catch {
        // already dead
      }
    }
    rmSync(sandbox.root, { recursive: true, force: true })
  }
}

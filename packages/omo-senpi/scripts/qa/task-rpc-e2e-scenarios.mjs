import { spawn, spawnSync } from "node:child_process"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const { createSandbox, seedSandbox } = await import(pathToFileURL(join(scriptDir, "drive.mjs")).href)
const { readRecords, readTaskEventTypes, pidAlive, pollRecord, sleep } = await import(pathToFileURL(join(scriptDir, "task-rpc-e2e-helpers.mjs")).href)
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
  return { ...process.env, SENPI_BIN: senpiBin, SENPI_CODING_AGENT_DIR: sandbox.agentDir, XDG_CONFIG_HOME: sandbox.xdgConfigHome, SENPI_CODING_AGENT_SESSION_DIR: sessionDir, OMO_SENPI_QA: "1" }
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
  return { sandbox, sessionDir, stateDir: join(sandbox.cwd, ".omo", "senpi-task") }
}

export function driveSenpi(senpiBin, sandbox, sessionDir, parentSteps, childSteps = CHILD_STEPS_COMPLETE, prompt = "run the rpc-process task e2e") {
  writeScript(sandbox, parentSteps, childSteps)
  const run = spawnSync(senpiBin, childArgv(sessionDir, prompt), {
    cwd: sandbox.cwd,
    env: childEnv(sandbox, sessionDir, senpiBin),
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  })
  return { status: run.status, signal: run.signal ?? null, stdout: run.stdout ?? "", stderr: run.stderr ?? "" }
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

async function cleanupSenpiHost(child) {
  const terminated = await killSenpiHost(child)
  if (!terminated) throw new Error(`could not terminate Senpi host pid=${child.pid ?? "unknown"}`)
  await waitForChildClose(child, 15_000)
}

export async function runKillCheck(senpiBin) {
  const { sandbox, sessionDir, stateDir } = prepareScenarioSandbox()
  const parent = driveSenpiAsync(senpiBin, sandbox, sessionDir, hangingChildSteps("pk"), CHILD_STEPS_HANG, "drive the kill scenario")
  try {
    const running = await pollRecord(stateDir, (r) => r.name === "pk" && runningRpcChild(r), 40_000)
    if (running === undefined) {
      return { check: "kill_marks_error_killed_true", verdict: "FAIL", reason: "no running rpc child appeared to kill" }
    }
    try {
      process.kill(running.pid, "SIGKILL")
    } catch {
      // already gone counts as killed
    }
    const errored = await pollRecord(stateDir, (r) => r.task_id === running.task_id && r.status === "error" && r.killed === true, 15_000)
    return {
      check: "kill_marks_error_killed_true",
      verdict: errored ? "PASS" : "FAIL",
      ...(errored ? {} : { reason: "kill did not yield status=error killed:true" }),
      facts: { pid: running.pid, killed: errored?.killed ?? false, error_excerpt: (errored?.error_message ?? "").slice(0, 120) },
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
    const running = await pollRecord(stateDir, (r) => r.name === "pr" && runningRpcChild(r), 40_000)
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
    const relaunch = driveSenpi(senpiBin, sandbox, sessionDir, RECONCILE_RELAUNCH_STEPS, CHILD_STEPS_COMPLETE, "relaunch for reconcile")
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

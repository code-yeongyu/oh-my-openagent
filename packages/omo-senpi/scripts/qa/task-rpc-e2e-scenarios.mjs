import { spawn } from "node:child_process"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { isolatedChildEnv, sandboxStateDir } from "./sandbox-child-env.mjs"

import { readRecordsLenient, waitForRecord, waitForRunningRpcChild } from "./task-rpc-record-wait.mjs"
export { waitForProcessCompletion, waitForRunningRpcChild } from "./task-rpc-record-wait.mjs"
export { runReconcileCheck } from "./task-rpc-reconcile.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const { createSandbox, seedSandbox } = await import(pathToFileURL(join(scriptDir, "drive.mjs")).href)
const { readRecords } = await import(pathToFileURL(join(scriptDir, "task-rpc-e2e-helpers.mjs")).href)
const { killProcessGroup } = await import(pathToFileURL(join(scriptDir, "team-e2e-process.mjs")).href)

const mockProviderEntry = join(scriptDir, "task-rpc-e2e-mock-provider.ts")
const CHILD_FINAL_TEXT = "omo rpc child mock work complete"
const PROJECT_OMO_CONFIG = {
  task: { default_execution_mode: "process", process_runner: "child-process" },
  categories: { proc: { description: "Process-mode mock category.", model: "omo-mock/mock-1" } },
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

export const hangingChildSteps = (name) => [
  { type: "tool_call", name: "task", arguments: { category: "proc", run_in_background: true, name, prompt: "hang until signalled" } },
  { type: "tool_call", name: "task_output", arguments: { name, mode: "status" } },
  { type: "hang" },
]

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
  return { status, signal, stdout, stderr, pid: child.pid }
}

export function driveSenpiAsync(senpiBin, sandbox, sessionDir, parentSteps, childSteps, prompt, capture = false) {
  writeScript(sandbox, parentSteps, childSteps)
  const pinnedBun = process.env.OMO_QA_BUN_BIN
  return spawn(pinnedBun ?? senpiBin, [...(pinnedBun ? [senpiBin] : []), ...childArgv(sessionDir, prompt)], {
    cwd: sandbox.cwd,
    env: childEnv(sandbox, sessionDir, senpiBin),
    detached: true,
    stdio: ["ignore", capture ? "pipe" : "ignore", capture ? "pipe" : "ignore"],
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

export async function cleanupSenpiHost(child) {
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

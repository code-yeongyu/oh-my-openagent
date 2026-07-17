import { spawn, spawnSync } from "node:child_process"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const { createSandbox, seedSandbox } = await import(pathToFileURL(join(scriptDir, "drive.mjs")).href)
const { readRecords, pidAlive, pollRecord, sleep } = await import(pathToFileURL(join(scriptDir, "task-rpc-e2e-helpers.mjs")).href)

const mockProviderEntry = join(scriptDir, "task-rpc-e2e-mock-provider.ts")
const CHILD_FINAL_TEXT = "omo rpc child mock work complete"
const PROJECT_OMO_CONFIG = {
  task: { default_execution_mode: "process" },
  categories: { proc: { description: "Process-mode mock category.", model: "omo-mock/mock-1" } },
}
const CHILD_STEPS_COMPLETE = [{ type: "text", text: CHILD_FINAL_TEXT }]
const CHILD_STEPS_HANG = [{ type: "hang" }]

export const SCENARIO_A_STEPS = [
  { type: "tool_call", name: "task", arguments: { category: "proc", run_in_background: true, name: "p1", prompt: "Do the rpc child work and stop." } },
  { type: "tool_call", name: "task_send", arguments: { to: "p1", message: "steer: keep going", deliver_as: "steer" } },
  { type: "tool_call", name: "task_output", arguments: { name: "p1", mode: "status", block: true, timeout_ms: 20_000 } },
  { type: "tool_call", name: "task_output", arguments: { name: "p1", mode: "status" } },
  { type: "text", text: "rpc-process scenario A complete" },
]

const RECONCILE_RELAUNCH_STEPS = [
  { type: "text", text: "reconcile relaunch complete" },
]

const hangingChildSteps = (name) => [
  { type: "tool_call", name: "task", arguments: { category: "proc", run_in_background: true, name, prompt: "hang until signalled" } },
  { type: "tool_call", name: "task_output", arguments: { name, mode: "status", block: true, timeout_ms: 60_000 } },
  { type: "text", text: `${name} parent done` },
]

const runningRpcChild = (r) => r.execution_mode === "process" && r.status === "running" && typeof r.pid === "number"

function childArgv(sessionDir, prompt) {
  return ["-e", mockProviderEntry, "-p", "--mode", "json", "--provider", "omo-mock", "--model", "mock-1", "--session-dir", sessionDir, prompt]
}

function childEnv(sandbox, sessionDir, senpiBin) {
  return { ...process.env, SENPI_BIN: senpiBin, SENPI_CODING_AGENT_DIR: sandbox.agentDir, SENPI_CODING_AGENT_SESSION_DIR: sessionDir, OMO_SENPI_QA: "1" }
}

function writeScript(sandbox, parentSteps, childSteps) {
  writeFileSync(join(sandbox.cwd, "mock-script.json"), `${JSON.stringify({ parentSteps, childSteps }, null, 2)}\n`)
}

export function prepareScenarioSandbox() {
  const sandbox = createSandbox()
  seedSandbox(sandbox)
  const sessionDir = join(sandbox.root, "sessions")
  mkdirSync(sessionDir, { recursive: true })
  mkdirSync(join(sandbox.cwd, ".omo"), { recursive: true })
  writeFileSync(join(sandbox.cwd, ".omo", "omo.json"), `${JSON.stringify(PROJECT_OMO_CONFIG, null, 2)}\n`)
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
    stdio: ["ignore", "ignore", "ignore"],
  })
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
    try {
      parent.kill("SIGKILL")
    } catch {
      // parent already exited when its blocking output read observed the child failure
    }
    rmSync(sandbox.root, { recursive: true, force: true })
  }
}

export async function runReconcileCheck(senpiBin) {
  const { sandbox, sessionDir, stateDir } = prepareScenarioSandbox()
  const parent = driveSenpiAsync(senpiBin, sandbox, sessionDir, hangingChildSteps("pr"), CHILD_STEPS_HANG, "drive the reconcile scenario")
  let orphanPid
  try {
    const running = await pollRecord(stateDir, (r) => r.name === "pr" && runningRpcChild(r), 40_000)
    if (running === undefined) {
      return { check: "reconcile_lost_terminates_orphan", verdict: "FAIL", reason: "no running rpc child appeared to reconcile" }
    }
    orphanPid = running.pid
    parent.kill("SIGKILL")
    await sleep(1_500)
    const relaunch = driveSenpi(senpiBin, sandbox, sessionDir, RECONCILE_RELAUNCH_STEPS, CHILD_STEPS_COMPLETE, "relaunch for reconcile")
    const lost = readRecords(stateDir).find((r) => r.task_id === running.task_id && r.status === "lost" && typeof r.pid === "number")
    const orphanDead = pidAlive(orphanPid) === false
    const pass = relaunch.status === 0 && lost !== undefined && orphanDead
    return {
      check: "reconcile_lost_terminates_orphan",
      verdict: pass ? "PASS" : "FAIL",
      ...(pass ? {} : { reason: `relaunchOk=${relaunch.status === 0} lostWithPid=${lost !== undefined} orphanDead=${orphanDead}` }),
      facts: { orphanPid, lostPid: lost?.pid, orphanDead, breadcrumb: (lost?.error_message ?? "").slice(0, 120) },
    }
  } finally {
    try {
      parent.kill("SIGKILL")
    } catch {
      // already exited
    }
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

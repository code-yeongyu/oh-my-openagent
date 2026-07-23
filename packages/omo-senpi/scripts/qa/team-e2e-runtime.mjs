import { spawn, spawnSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export function startSenpiRun(input) {
  writeFileSync(join(input.sandbox.cwd, "mock-script.json"), `${JSON.stringify(input.script, null, 2)}\n`)
  const sessionDir = join(input.sandbox.root, "sessions")
  mkdirSync(sessionDir, { recursive: true })
  const args = [
    "-e",
    input.mockProviderEntry,
    "-p",
    "--mode",
    "json",
    "--provider",
    "omo-mock",
    "--model",
    "mock-1",
    "--session-dir",
    sessionDir,
    ...(input.sessionId === undefined ? [] : ["--session", input.sessionId]),
    input.prompt,
  ]
  const child = spawn(input.senpiBin, args, {
    cwd: input.sandbox.cwd,
    env: {
      ...process.env,
      SENPI_CODING_AGENT_DIR: input.sandbox.agentDir,
      SENPI_CODING_AGENT_SESSION_DIR: sessionDir,
      OMO_SENPI_QA: "1",
      ...(input.obsDir === undefined ? {} : { OMO_TEAM_E2E_OBS: input.obsDir }),
      ...(input.extraEnv ?? {}),
    },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  })
  if (typeof child.pid === "number") input.onPid?.(child.pid)

  let stdout = ""
  let stderr = ""
  let settled = false
  let finishRun = () => undefined
  const completion = new Promise((resolveRun) => { finishRun = resolveRun })
  const finish = (status, extraStderr) => {
    if (settled) return
    settled = true
    clearTimeout(hardTimer)
    finishRun({
      status,
      stdout,
      stderr: extraStderr === undefined ? stderr : `${stderr}\n${extraStderr}`,
      events: input.parseEvents(stdout),
    })
  }
  const hardTimer = setTimeout(() => {
    if (typeof child.pid === "number") killProcessGroup(child.pid)
    finish(null, "team e2e run exceeded 120000ms")
  }, 120_000)
  child.stdout.on("data", (chunk) => { stdout += chunk })
  child.stderr.on("data", (chunk) => { stderr += chunk })
  child.on("close", (status) => finish(status))
  child.on("error", (error) => finish(null, error.message))

  return {
    pid: child.pid,
    completion,
    kill: () => {
      if (typeof child.pid === "number") killProcessGroup(child.pid)
    },
  }
}

export async function pollUntil(readValue, accepted, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let value = await readValue()
  while (!accepted(value) && Date.now() < deadline) {
    await delay(Math.min(50, Math.max(1, deadline - Date.now())))
    value = await readValue()
  }
  return value
}

export function killProcess(pid) {
  try {
    process.kill(pid, "SIGKILL")
    return true
  } catch (error) {
    if (isMissingProcess(error)) return false
    throw error
  }
}

export function killProcessGroup(pid) {
  try {
    process.kill(-pid, "SIGKILL")
    return true
  } catch (error) {
    if (isMissingProcess(error)) return false
    throw error
  }
}

export function cleanupProcessGroups(groupIds, operations = {}) {
  const listGroupPids = operations.listGroupPids ?? readProcessGroupPids
  const kill = operations.killProcess ?? killProcess
  let leaked = 0
  for (const groupId of groupIds) {
    const members = listGroupPids(groupId).filter((pid) => pid !== process.pid)
    for (const pid of members) kill(pid)
    leaked += listGroupPids(groupId).filter((pid) => pid !== process.pid).length
  }
  return leaked
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isMissingProcess(error) {
  return error instanceof Error && "code" in error && error.code === "ESRCH"
}

function readProcessGroupPids(groupId) {
  const probe = spawnSync("pgrep", ["-g", String(groupId)], { encoding: "utf8" })
  return (probe.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0)
}

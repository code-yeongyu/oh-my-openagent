import { spawn } from "node:child_process"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join, win32 } from "node:path"

import { killProcessGroup } from "./team-e2e-process.mjs"

export {
  cleanupProcessGroups,
  createOwnedProcessRegistry,
  isProcessAlive,
  killProcess,
  killProcessGroup,
  terminateProcessTree,
} from "./team-e2e-process.mjs"

export function resolveSenpiInvocation(senpiBin, operations = {}) {
  const platform = operations.platform ?? process.platform
  if (platform === "win32") {
    const launcherName = win32.basename(senpiBin).toLowerCase()
    if (launcherName.endsWith(".exe") || (launcherName !== "senpi" && launcherName !== "senpi.cmd")) {
      return { command: senpiBin, prefixArgs: [] }
    }
    const shimDir = win32.dirname(senpiBin)
    const cliCandidates = [
      win32.join(shimDir, "node_modules", "@code-yeongyu", "senpi", "dist", "cli.js"),
      win32.join(shimDir, "..", "@code-yeongyu", "senpi", "dist", "cli.js"),
    ]
    const fileExists = operations.existsSync ?? existsSync
    const cliPath = cliCandidates.find((candidate) => fileExists(candidate))
    if (cliPath === undefined) {
      throw new Error(`Windows Senpi shim cannot be mapped to the package CLI: ${senpiBin}`)
    }
    return {
      command: operations.execPath ?? process.execPath,
      prefixArgs: [cliPath],
    }
  }
  return { command: senpiBin, prefixArgs: [] }
}

export function startSenpiRun(input) {
  writeFileSync(join(input.sandbox.cwd, "mock-script.json"), `${JSON.stringify(input.script, null, 2)}\n`)
  const sessionDir = input.sessionDir ?? join(input.sandbox.root, "sessions")
  mkdirSync(sessionDir, { recursive: true })
  const args = [
    ...(input.noExtensions === true ? ["--no-extensions"] : []),
    "-e",
    input.mockProviderEntry,
    ...(input.extensionEntries ?? []).flatMap((entry) => ["-e", entry]),
    "-p",
    "--mode",
    "json",
    "--provider",
    "omo-mock",
    "--model",
    "mock-1",
    "--session-dir",
    sessionDir,
    ...(input.sessionId === undefined ? [] : ["--session-id", input.sessionId]),
    input.prompt,
  ]
  const invocation = resolveSenpiInvocation(input.senpiBin)
  const child = spawn(invocation.command, [...invocation.prefixArgs, ...args], {
    cwd: input.sandbox.cwd,
    env: {
      ...process.env,
      SENPI_CODING_AGENT_DIR: input.sandbox.agentDir,
      XDG_CONFIG_HOME: input.sandbox.xdgConfigHome,
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
  let childClosed = false
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
    void (async () => {
      if (ownsLiveChild(child, childClosed)) await killProcessGroup(child.pid)
      finish(null, "team e2e run exceeded 120000ms")
    })()
  }, 120_000)
  child.stdout.on("data", (chunk) => { stdout += chunk })
  child.stderr.on("data", (chunk) => { stderr += chunk })
  child.on("close", (status) => {
    childClosed = true
    if (typeof child.pid === "number") input.onClose?.(child.pid)
    finish(status)
  })
  child.on("error", (error) => finish(null, error.message))

  return {
    pid: child.pid,
    completion,
    kill: async () => ownsLiveChild(child, childClosed) && killProcessGroup(child.pid),
  }
}

function ownsLiveChild(child, childClosed) {
  return !childClosed
    && typeof child.pid === "number"
    && child.exitCode === null
    && child.signalCode === null
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

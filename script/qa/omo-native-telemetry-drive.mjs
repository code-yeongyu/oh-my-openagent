import { spawn } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { mockProviderSource, pluginRoot, prompts } from "./omo-native-telemetry-provider.mjs"

export function createSandbox(label, configEnabled) {
  const root = mkdtempSync(join(tmpdir(), `omo-native-telemetry-${label}-`))
  const cwd = join(root, "project")
  const agentDir = join(root, "agent")
  const sessionDir = join(root, "sessions")
  const xdgConfigHome = join(root, "xdg")
  const home = join(root, "home")
  mkdirSync(home, { recursive: true })
  const onboardingState = join(agentDir, "omo-senpi", "omo-native")
  mkdirSync(onboardingState, { recursive: true })
  writeFileSync(join(onboardingState, "onboarding-completed"), JSON.stringify({ version: 1 }))
  mkdirSync(cwd, { recursive: true })
  mkdirSync(agentDir, { recursive: true })
  mkdirSync(sessionDir, { recursive: true })
  mkdirSync(xdgConfigHome, { recursive: true })
  const canonicalCwd = realpathSync(cwd)
  const settings = {
    defaultProjectTrust: "ask",
    defaultProvider: "openai",
    defaultModel: "gpt-5.6-sol",
    packages: [pluginRoot],
  }
  const models = {
    providers: {
      openai: {
        models: [{ id: "gpt-5.6-sol", name: "GPT 5.6 Sol", contextWindow: 200000, maxTokens: 4096 }],
      },
    },
  }
  writeFileSync(join(agentDir, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`)
  writeFileSync(join(agentDir, "models.json"), `${JSON.stringify(models, null, 2)}\n`)
  writeFileSync(join(agentDir, "trust.json"), `${JSON.stringify({ [canonicalCwd]: true }, null, 2)}\n`)
  const omoDir = join(cwd, ".omo")
  mkdirSync(omoDir, { recursive: true })
  writeFileSync(join(omoDir, "omo.json"), `${JSON.stringify({
    telemetry: { enabled: configEnabled },
    categories: { quick: { description: "QA quick category", model: "openai/gpt-5.6-sol" } },
  }, null, 2)}\n`)
  const providerPath = join(root, "telemetry-mock-provider.ts")
  writeFileSync(providerPath, mockProviderSource())
  chmodSync(providerPath, 0o700)
  return { root, cwd, home, agentDir, sessionDir, xdgConfigHome, providerPath }
}

function cleanEnvironment(sandbox, port, extraEnv) {
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (/TOKEN|SECRET|PASSWORD|COOKIE|CREDENTIAL|API_KEY/i.test(key)) continue
    if (key === "SENPI_CODING_AGENT_DIR" || key === "SENPI_CODING_AGENT_SESSION_DIR" || key === "XDG_CONFIG_HOME") continue
    if (key === "DO_NOT_TRACK" || key.startsWith("OMO_") || key === "POSTHOG_HOST") continue
    env[key] = value
  }
  return {
    ...env,
    ...extraEnv,
    HOME: sandbox.home,
    SENPI_CODING_AGENT_DIR: sandbox.agentDir,
    SENPI_CODING_AGENT_SESSION_DIR: sandbox.sessionDir,
    XDG_CONFIG_HOME: sandbox.xdgConfigHome,
    POSTHOG_HOST: `http://127.0.0.1:${port}`,
    POSTHOG_API_KEY: "phc_test",
    OMO_SENPI_QA: "1",
    PI_OFFLINE: "1",
    PI_TELEMETRY: "0",
  }
}

export async function driveCli({ senpiBin, port, label, evidenceDir, configEnabled = true, extraEnv = {} }) {
  const sandbox = createSandbox(label, configEnabled)
  const commandArgs = [
    "--mode", "rpc", "--offline", "--approve", "--no-context-files", "--session-dir", sandbox.sessionDir,
    "-e", sandbox.providerPath, "--provider", "openai", "--model", "gpt-5.6-sol",
  ]
  const child = spawn(senpiBin, commandArgs, {
    cwd: sandbox.cwd,
    env: cleanEnvironment(sandbox, port, extraEnv),
    stdio: ["pipe", "pipe", "pipe"],
  })
  let succeeded = false
  try {
    const result = await driveRpc(child, label)
    succeeded = true
    return { sandbox, commandArgs, ...result }
  } finally {
    try {
      if (evidenceDir) {
        const sessions = readdirSync(sandbox.sessionDir).filter((name) => name.endsWith(".jsonl"))
        writeFileSync(join(evidenceDir, `${label}-session.jsonl`), sessions.map((name) => readFileSync(join(sandbox.sessionDir, name), "utf8")).join(""))
      }
    } finally {
      if (!succeeded) rmSync(sandbox.root, { recursive: true, force: true })
    }
  }
}

export async function driveRpc(child, label) {
  const shutdownGraceMs = 1_000
  const deadlineAt = performance.now() + 120_000
  const transcript = []
  const closed = new Promise((resolveClose) => child.once("close", resolveClose))
  let stdoutBuffer = ""
  let stderr = ""
  let settledCount = 0
  let settled = false
  let timeoutHandle
  let shutdownHandle
  const completed = new Promise((resolveRun, rejectRun) => {
    // Reserve termination time inside the overall budget, not after it.
    timeoutHandle = setTimeout(() => rejectRun(new Error(`${label} Senpi RPC drive timed out within its 120000ms total budget`)), 120_000 - shutdownGraceMs)
    child.on("error", rejectRun)
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8") })
    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString("utf8")
      let newline = stdoutBuffer.indexOf("\n")
      while (newline !== -1) {
        const line = stdoutBuffer.slice(0, newline)
        stdoutBuffer = stdoutBuffer.slice(newline + 1)
        if (line.trim() !== "") {
          let event
          try { event = JSON.parse(line) } catch (error) {
            if (!(error instanceof SyntaxError) || line.trimStart().startsWith("{")) { rejectRun(error); return }
            stderr += `${line}\n`
          }
          if (event) transcript.push(line)
          if (event?.type === "response" && event.success === false) {
            rejectRun(new Error(`${label} RPC ${event.command} rejected: ${event.error}`))
            return
          }
          if (event?.type === "agent_settled") {
            settledCount += 1
            if (settledCount < prompts.length) {
              child.stdin.write(`${JSON.stringify({ type: "prompt", message: prompts[settledCount] })}\n`)
            } else {
              child.stdin.end()
            }
          }
        }
        newline = stdoutBuffer.indexOf("\n")
      }
    })
    child.on("close", (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutHandle)
      if (code === 0 && settledCount === prompts.length) resolveRun({ code, signal })
      else rejectRun(new Error(`${label} Senpi RPC exited code=${code} signal=${signal} agent_settled=${settledCount}\n${stderr.slice(-4000)}`))
    })
    child.stdin.write(`${JSON.stringify({ type: "prompt", message: prompts[0] })}\n`)
  })
  try {
    const result = await completed
    return { transcript, stderr, settledCount, pid: child.pid, result }
  } catch (error) {
    if (child.exitCode === null) child.kill("SIGTERM")
    const forced = new Promise((resolveForce) => {
      shutdownHandle = setTimeout(() => {
        child.kill("SIGKILL")
        child.stdin.destroy()
        child.stdout.destroy()
        child.stderr.destroy()
        resolveForce()
      }, Math.max(0, Math.min(shutdownGraceMs, deadlineAt - performance.now())))
    })
    await Promise.race([closed, forced])
    throw error
  } finally {
    clearTimeout(shutdownHandle)
    clearTimeout(timeoutHandle)
  }
}

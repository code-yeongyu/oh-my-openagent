#!/usr/bin/env node
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createSandbox, digestDirectory, seedSandbox } from "./drive.mjs"
import { changedRealPaths, snapshotDir } from "./task-e2e-analysis.mjs"
import { OMO_CONFIG, SCENARIOS, scenarioUsage } from "./task-tui-scenarios.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const mockProviderEntry = join(scriptDir, "task-e2e-mock-provider.ts")
const realSenpiAgentDir = join(homedir(), ".senpi", "agent")

function parseArgs(argv) {
  const args = { scenario: "full" }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--help" || arg === "-h") return { ...args, help: true }
    if (arg === "--self-test") return { ...args, selfTest: true }
    if (arg !== "--scenario") throw new Error(`unknown argument: ${arg}`)
    const value = argv[++i]
    if (!value) throw new Error("--scenario requires a value")
    if (!Object.hasOwn(SCENARIOS, value)) throw new Error(`unknown scenario: ${value}`)
    args.scenario = value
  }
  return args
}

function findOnPath(bin) {
  if (bin.includes("/")) return existsSync(bin) ? bin : null
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = resolve(dir || ".", bin)
    if (existsSync(candidate)) return candidate
  }
  return null
}

function prepareScenario(name) {
  const sandbox = createSandbox()
  seedSandbox(sandbox)
  const sessionDir = join(sandbox.root, "sessions")
  mkdirSync(sessionDir, { recursive: true })
  mkdirSync(join(sandbox.cwd, ".omo"), { recursive: true })
  writeFileSync(join(sandbox.cwd, ".omo", "omo.json"), `${JSON.stringify(OMO_CONFIG, null, 2)}\n`)
  writeFileSync(join(sandbox.cwd, "mock-script.json"), `${JSON.stringify(SCENARIOS[name], null, 2)}\n`)
  return { sandbox, sessionDir }
}

function composeCommand(senpiBin, sessionDir, scenario) {
  return {
    command: senpiBin,
    args: [
      "-e",
      mockProviderEntry,
      "--provider",
      "omo-mock",
      "--model",
      "mock-1",
      "--session-dir",
      sessionDir,
      "--offline",
      "--approve",
      "--no-context-files",
      SCENARIOS[scenario].prompt,
    ],
  }
}

function childEnv(baseEnv, sandbox, sessionDir, senpiBin) {
  const env = {}
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined) continue
    if (/TOKEN|SECRET|PASSWORD|COOKIE|CREDENTIAL|API_KEY/i.test(key)) continue
    if (key === "SENPI_CODING_AGENT_DIR" || key === "SENPI_CODING_AGENT_SESSION_DIR") continue
    env[key] = value
  }
  return {
    ...env,
    SENPI_BIN: senpiBin,
    SENPI_CODING_AGENT_DIR: sandbox.agentDir,
    SENPI_CODING_AGENT_SESSION_DIR: sessionDir,
    OMO_SENPI_QA: "1",
    OMO_SENPI_DISABLE_POSTHOG: "1",
    PI_OFFLINE: "1",
    PI_TELEMETRY: "0",
  }
}

function writeReceipt(payload) {
  const outDir = process.env.TASK_TUI_E2E_OUT_DIR
  if (outDir === undefined) return undefined
  mkdirSync(outDir, { recursive: true })
  const path = join(outDir, "cleanup-receipt.json")
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`)
  return path
}

function runChild(command, args, options) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, options)
    child.on("error", (error) => resolveRun({ status: 1, signal: null, error: String(error.message ?? error) }))
    child.on("close", (status, signal) => resolveRun({ status: status ?? 1, signal, error: null }))
  })
}

async function runScenario(name) {
  const providedAgentDir = process.env.SENPI_CODING_AGENT_DIR ? "IGNORED" : "unset"
  const beforeDigest = digestDirectory(realSenpiAgentDir)
  const beforeSnapshot = snapshotDir(realSenpiAgentDir)
  const resolvedSenpi = findOnPath(process.env.SENPI_BIN?.trim() || "senpi")
  const prepared = prepareScenario(name)
  let run = { status: 2, signal: null, error: null }
  try {
    if (resolvedSenpi === null) {
      run = { status: 2, signal: null, error: "senpi-binary-unavailable" }
    } else {
      const { command, args } = composeCommand(resolvedSenpi, prepared.sessionDir, name)
      run = await runChild(command, args, {
        cwd: prepared.sandbox.cwd,
        env: childEnv(process.env, prepared.sandbox, prepared.sessionDir, resolvedSenpi),
        stdio: "inherit",
      })
    }
  } finally {
    rmSync(prepared.sandbox.root, { recursive: true, force: true })
  }
  const changedReal = changedRealPaths(beforeSnapshot, snapshotDir(realSenpiAgentDir))
  const payload = {
    result: run.status === 0 && changedReal.length === 0 ? "PASS" : "FAIL",
    scenario: name,
    exitStatus: run.status,
    signal: run.signal,
    reason: run.error ?? undefined,
    providedAgentDir,
    sandboxCleaned: !existsSync(prepared.sandbox.root),
    sandboxAgentDir: prepared.sandbox.agentDir,
    realSenpiDigestUnchanged: beforeDigest === digestDirectory(realSenpiAgentDir),
    realSenpiChangedPaths: changedReal,
    cleanup: `removed ${prepared.sandbox.root}`,
  }
  const receipt = writeReceipt(payload)
  console.log(JSON.stringify({ ...payload, cleanupReceipt: receipt }))
  if (payload.result !== "PASS") process.exitCode = run.status || 1
}

function runSelfTest() {
  if (parseArgs(["--scenario", "edge"]).scenario !== "edge") throw new Error("self-test: scenario parser failed")
  if (parseArgs(["--scenario", "active"]).scenario !== "active") throw new Error("self-test: active scenario parser failed")
  if (parseArgs(["--scenario", "team"]).scenario !== "team") throw new Error("self-test: team scenario parser failed")
  try {
    parseArgs(["--scenario", "bogus"])
    throw new Error("self-test: bad scenario accepted")
  } catch (error) {
    if (!String(error).includes("unknown scenario")) throw error
  }
  const prepared = prepareScenario("full")
  const receiptDir = join(prepared.sandbox.root, "receipt")
  const command = composeCommand("/tmp/senpi", prepared.sessionDir, "full")
  const activeCommand = composeCommand("/tmp/senpi", prepared.sessionDir, "active")
  const teamCommand = composeCommand("/tmp/senpi", prepared.sessionDir, "team")
  const env = childEnv({ ...process.env, SENPI_CODING_AGENT_DIR: "/real/agent", OPENAI_API_KEY: "secret" }, prepared.sandbox, prepared.sessionDir, "/tmp/senpi")
  if (command.args.includes("-p") || command.args.includes("--mode")) throw new Error("self-test: TUI command must not force print/json mode")
  if (!command.args.includes(mockProviderEntry) || !command.args.includes("omo-mock") || !command.args.includes("mock-1")) throw new Error("self-test: mock provider command is incomplete")
  if (!activeCommand.args.includes(SCENARIOS.active.prompt)) throw new Error("self-test: active command prompt is incomplete")
  if (!teamCommand.args.includes(SCENARIOS.team.prompt)) throw new Error("self-test: team command prompt is incomplete")
  if (SCENARIOS.team.customMessages?.[0]?.customType !== "senpi-task.team-message") throw new Error("self-test: team custom message is incomplete")
  if (env.SENPI_CODING_AGENT_DIR !== prepared.sandbox.agentDir || env.OPENAI_API_KEY !== undefined) throw new Error("self-test: env isolation failed")
  const oldOutDir = process.env.TASK_TUI_E2E_OUT_DIR
  process.env.TASK_TUI_E2E_OUT_DIR = receiptDir
  const receipt = writeReceipt({ sandboxCleaned: true, cleanup: "self-test" })
  if (receipt === undefined || !existsSync(receipt)) throw new Error("self-test: cleanup receipt was not written")
  if (oldOutDir === undefined) delete process.env.TASK_TUI_E2E_OUT_DIR
  else process.env.TASK_TUI_E2E_OUT_DIR = oldOutDir
  rmSync(prepared.sandbox.root, { recursive: true, force: true })
  if (existsSync(prepared.sandbox.root)) throw new Error("self-test: sandbox cleanup failed")
  console.log("SELF-TEST OK")
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(`Usage: node packages/omo-senpi/scripts/qa/task-tui-e2e.mjs [--scenario ${scenarioUsage()}] [--self-test]`)
    return
  }
  if (args.selfTest) runSelfTest()
  else await runScenario(args.scenario)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}

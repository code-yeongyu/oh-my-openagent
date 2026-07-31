#!/usr/bin/env node
import { spawn } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { createSandbox, seedSandbox } from "./drive.mjs"
import { changedRealPaths, classifyRealSenpiChanges, snapshotDir } from "./task-e2e-analysis.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const mockProviderEntry = join(scriptDir, "mock-provider", "index.ts")
const realSenpiAgentDir = join(homedir(), ".senpi", "agent")
const defaultReceiptDir = resolve(".omo/evidence/20260730-ulw-goal-footer/tui")
const activeUlwStatus = JSON.stringify({
  ok: true,
  plan: {
    activeGoalId: "G001",
    goals: [
      {
        id: "G001",
        status: "in_progress",
        title: "Render the combined footer",
        successCriteria: [{ id: "C001", status: "pending" }],
      },
    ],
  },
})

function parseArgs(argv) {
  if (argv.length === 0) return { help: false, selfTest: false }
  if (argv.length === 1 && argv[0] === "--self-test") return { help: false, selfTest: true }
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) return { help: true, selfTest: false }
  throw new Error(`unknown argument: ${argv.join(" ")}`)
}

function findOnPath(bin) {
  if (bin.includes("/")) return existsSync(bin) ? bin : null
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = resolve(dir || ".", bin)
    if (existsSync(candidate)) return candidate
  }
  return null
}

function prepareScenario() {
  const sandbox = createSandbox()
  seedSandbox(sandbox)
  const sessionDir = join(sandbox.root, "sessions")
  const fakeBinDir = join(sandbox.root, "bin")
  mkdirSync(sessionDir, { recursive: true })
  mkdirSync(fakeBinDir, { recursive: true })
  const omoBin = join(fakeBinDir, "omo")
  writeFileSync(
    omoBin,
    `#!/bin/sh\nif [ "$1 $2 $3" = "ulw-loop status --json" ]; then\n  printf '%s\\n' '${activeUlwStatus}'\n  exit 0\nfi\nexit 2\n`,
  )
  chmodSync(omoBin, 0o755)
  writeFileSync(
    join(sandbox.cwd, "mock-script.json"),
    `${JSON.stringify(
      {
        steps: [
          {
            type: "tool_call",
            name: "create_goal",
            arguments: { objective: "Keep the real TUI open while the active ulw-loop footer animates." },
          },
          { type: "text", text: "The goal and ulw-loop are active. Observe the footer animation." },
        ],
      },
      null,
      2,
    )}\n`,
  )
  return { sandbox, sessionDir, omoBin }
}

function composeCommand(senpiBin, sessionDir) {
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
      "Create the requested goal, then keep working under the active ulw-loop.",
    ],
  }
}

function childEnv(baseEnv, prepared, senpiBin) {
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
    SENPI_CODING_AGENT_DIR: prepared.sandbox.agentDir,
    SENPI_CODING_AGENT_SESSION_DIR: prepared.sessionDir,
    XDG_CONFIG_HOME: prepared.sandbox.xdgConfigHome,
    OMO_BIN: prepared.omoBin,
    OMO_SENPI_QA: "1",
    OMO_SENPI_DISABLE_POSTHOG: "1",
    PI_OFFLINE: "1",
    PI_TELEMETRY: "0",
  }
}

function receiptPath(name) {
  const outDir = process.env.ULW_GOAL_FOOTER_QA_OUT_DIR
  return join(outDir === undefined ? defaultReceiptDir : resolve(outDir), name)
}

function writeReceipt(name, payload) {
  const path = receiptPath(name)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`)
  return path
}

function runChild(command, args, options) {
  const child = spawn(command, args, options)
  const result = new Promise((resolveRun) => {
    child.on("error", (error) => resolveRun({ status: 1, signal: null, error: String(error.message ?? error) }))
    child.on("close", (status, signal) => resolveRun({ status: status ?? 1, signal, error: null }))
  })
  return { child, result }
}

async function runScenario() {
  const beforeSnapshot = snapshotDir(realSenpiAgentDir)
  const senpiBin = findOnPath(process.env.SENPI_BIN?.trim() || "senpi")
  const prepared = prepareScenario()
  let child
  let cleaned = false
  writeReceipt("driver-start.json", {
    result: "STARTED",
    sandbox: prepared.sandbox.root,
    realAgentDir: realSenpiAgentDir,
    isolatedAgentDir: prepared.sandbox.agentDir,
  })

  const cleanup = (reason) => {
    if (cleaned) return
    cleaned = true
    child?.kill("SIGTERM")
    rmSync(prepared.sandbox.root, { recursive: true, force: true })
    const changedReal = changedRealPaths(beforeSnapshot, snapshotDir(realSenpiAgentDir))
    const classified = classifyRealSenpiChanges(changedReal, [basename(prepared.sandbox.root)])
    const payload = {
      result: senpiBin !== null && classified.qaAttributedPaths.length === 0 ? "PASS" : "FAIL",
      reason,
      sandboxCleaned: !existsSync(prepared.sandbox.root),
      realAgentWriteIsolation: classified.qaAttributedPaths.length === 0,
      qaAttributedRealPaths: classified.qaAttributedPaths,
      concurrentSessionPaths: classified.concurrentSessionPaths,
      cleanup: `removed ${prepared.sandbox.root}`,
    }
    const receipt = writeReceipt("driver-cleanup.json", payload)
    process.stdout.write(`\n${JSON.stringify({ ...payload, cleanupReceipt: receipt })}\n`)
  }

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.once(signal, () => {
      cleanup(signal)
      process.exit(0)
    })
  }

  try {
    if (senpiBin === null) throw new Error("senpi-binary-unavailable")
    const command = composeCommand(senpiBin, prepared.sessionDir)
    const run = runChild(command.command, command.args, {
      cwd: prepared.sandbox.cwd,
      env: childEnv(process.env, prepared, senpiBin),
      stdio: "inherit",
    })
    child = run.child
    const result = await run.result
    cleanup(result.error ?? result.signal ?? `exit-${result.status}`)
    if (result.status !== 0) process.exitCode = result.status
  } catch (error) {
    cleanup(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

function runSelfTest() {
  if (!parseArgs(["--self-test"]).selfTest) throw new Error("self-test: argument parser failed")
  const prepared = prepareScenario()
  const command = composeCommand("/tmp/senpi", prepared.sessionDir)
  const env = childEnv({ ...process.env, SENPI_CODING_AGENT_DIR: "/real", OPENAI_API_KEY: "secret" }, prepared, "/tmp/senpi")
  if (command.args.includes("-p") || command.args.includes("--mode")) throw new Error("self-test: command must stay TUI-native")
  if (!command.args.includes("create_goal") && !existsSync(join(prepared.sandbox.cwd, "mock-script.json"))) {
    throw new Error("self-test: goal script missing")
  }
  if (env.SENPI_CODING_AGENT_DIR !== prepared.sandbox.agentDir || env.OPENAI_API_KEY !== undefined) {
    throw new Error("self-test: environment isolation failed")
  }
  if (env.OMO_BIN !== prepared.omoBin || !existsSync(prepared.omoBin)) throw new Error("self-test: fake omo missing")
  rmSync(prepared.sandbox.root, { recursive: true, force: true })
  if (existsSync(prepared.sandbox.root)) throw new Error("self-test: sandbox cleanup failed")
  console.log("SELF-TEST OK")
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log("Usage: node packages/omo-senpi/scripts/qa/ulw-goal-footer-tui.mjs [--self-test]")
    return
  }
  if (args.selfTest) runSelfTest()
  else await runScenario()
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}

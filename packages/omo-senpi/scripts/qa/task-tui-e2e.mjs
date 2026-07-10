#!/usr/bin/env node
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createSandbox, digestDirectory, seedSandbox } from "./drive.mjs"
import { changedRealPaths, snapshotDir } from "./task-e2e-analysis.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const mockProviderEntry = join(scriptDir, "task-e2e-mock-provider.ts")
const realSenpiAgentDir = join(homedir(), ".senpi", "agent")
const OMO_CONFIG = { categories: { mockcat: { description: "Local mock category for TUI QA.", model: "omo-mock/mock-1" } } }

const SCENARIOS = {
  full: {
    prompt: "Use the omo task tools to spawn a background child, interrupt it, continue it, read its output, and cancel it.",
    parentSteps: [
      { type: "tool_call", name: "task", arguments: { category: "mockcat", prompt: "Inspect the isolated Senpi task lifecycle, report the initial result clearly, and remain ready for a continuation that verifies resident-session revival.", run_in_background: true, name: "tui-child" } },
      { type: "text", text: "tui parent observed the initial child completion" },
      { type: "tool_call", name: "task_send", arguments: { to: "tui-child", deliver_as: "interrupt" } },
      { type: "tool_call", name: "task_send", arguments: { to: "tui-child", deliver_as: "followUp", message: "Continue in the same resident child session, verify that revival preserved the initial task context, and produce a concise second-stage report describing what changed after the follow-up instruction." } },
      { type: "text", text: "tui parent observed the continuation completion" },
      { type: "tool_call", name: "task_output", arguments: { name: "tui-child", mode: "full", block: true } },
      { type: "tool_call", name: "task_cancel", arguments: { name: "tui-child", reason: "TUI QA cleanup after the complete transcript was captured" } },
      { type: "text", text: "tui full scenario complete" },
    ],
    childSteps: [
      { type: "text", text: "Initial child report: the isolated task lifecycle completed its first meaningful unit." },
      { type: "text", text: "Continuation child report: the resident session revived with its prior context and completed the follow-up unit." },
    ],
  },
  edge: {
    prompt: "Exercise the task-family renderer edge path at 72 columns, then remain interactive.",
    parentSteps: [
      { type: "tool_call", name: "task", arguments: { category: "missing-cat", prompt: "한국어로 긴 작업 지시를 작성하고 여러 줄의 혼합 폭 텍스트가 72열 터미널에서 안전하게 줄임표 처리되는지 확인하세요.\nThen inspect the missing-category routing error and summarize the English continuation without overflowing the interactive xterm row.", run_in_background: true, name: "edge-missing-child" } },
      { type: "tool_call", name: "task_send", arguments: { to: "edge-missing-child", message: " \n\t " } },
      { type: "tool_call", name: "task_send", arguments: { to: "edge-missing-child", deliver_as: "interrupt" } },
      { type: "tool_call", name: "task_send", arguments: { team_run_id: "edge-team-72", to: "edge-member", message: { type: "shutdown_request", reason: "Renderer QA request after the mixed Korean and English edge pass" } } },
      { type: "tool_call", name: "task_send", arguments: { team_run_id: "edge-team-72", to: "edge-member", message: { type: "shutdown_response", request_id: "edge-request-72", approve: false, reason: "Keep the member active until the compact renderer rows are verified" } } },
      { type: "tool_call", name: "task_output", arguments: { name: "edge-missing-child", mode: "status", block: false } },
      { type: "tool_call", name: "task_cancel", arguments: { name: "edge-missing-child", reason: " \n\t " } },
      { type: "text", text: "tui edge scenario complete" },
    ],
    childSteps: [{ type: "text", text: "edge child should not run" }],
  },
}

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

function assertScenarioCoverage() {
  const toolCalls = (scenario) => scenario.parentSteps.filter((step) => step.type === "tool_call")
  const full = toolCalls(SCENARIOS.full)
  const edge = toolCalls(SCENARIOS.edge)
  const failures = []
  const toolNames = (calls) => calls.map((step) => step.name).join(",")
  if (toolNames(full) !== "task,task_send,task_send,task_output,task_cancel") failures.push("full tool sequence")
  if (toolNames(edge) !== "task,task_send,task_send,task_send,task_send,task_output,task_cancel") failures.push("edge tool sequence")
  const fullTask = full[0]?.arguments
  if (fullTask?.category !== "mockcat" || fullTask.run_in_background !== true || String(fullTask.prompt ?? "").trim().length < 60) failures.push("meaningful background task")
  const fullInterrupt = full[1]?.arguments
  if (fullInterrupt?.deliver_as !== "interrupt" || Object.hasOwn(fullInterrupt, "message")) failures.push("full pure interrupt")
  const fullFollowUp = full[2]?.arguments
  if (fullFollowUp?.deliver_as !== "followUp" || String(fullFollowUp.message ?? "").trim().length < 80) failures.push("long full follow-up")
  if (full[3]?.arguments?.block !== true) failures.push("blocking task_output")
  if (SCENARIOS.full.childSteps.filter((step) => step.type === "text").length < 2) failures.push("completion and revival child steps")
  const edgePrompt = String(edge[0]?.arguments?.prompt ?? "")
  if (edge[0]?.arguments?.category !== "missing-cat" || !edgePrompt.includes("\n") || !/[가-힣]/u.test(edgePrompt) || !/[A-Za-z]/u.test(edgePrompt) || edgePrompt.length < 120) failures.push("long multiline Korean/English task")
  const edgeWhitespaceSend = edge[1]?.arguments?.message
  const edgeInterrupt = edge[2]?.arguments
  if (typeof edgeWhitespaceSend !== "string" || edgeWhitespaceSend.length === 0 || edgeWhitespaceSend.trim().length !== 0) failures.push("whitespace-only task_send message")
  if (edgeInterrupt?.deliver_as !== "interrupt" || Object.hasOwn(edgeInterrupt, "message")) failures.push("edge pure interrupt")
  const shutdownRequest = edge[3]?.arguments
  const shutdownResponse = edge[4]?.arguments
  if (shutdownRequest?.message?.type !== "shutdown_request" || !shutdownRequest.team_run_id || !String(shutdownRequest.message.reason ?? "").trim()) failures.push("structured shutdown request")
  if (shutdownResponse?.message?.type !== "shutdown_response" || !shutdownResponse.team_run_id || !shutdownResponse.message.request_id || !String(shutdownResponse.message.reason ?? "").trim()) failures.push("structured shutdown response")
  const edgeCancelReason = edge[6]?.arguments?.reason
  if (typeof edgeCancelReason !== "string" || edgeCancelReason.length === 0 || edgeCancelReason.trim().length !== 0) failures.push("whitespace-only task_cancel reason")
  const edgeFinal = SCENARIOS.edge.parentSteps.at(-1)
  if (edgeFinal?.type !== "text" || edgeFinal.text !== "tui edge scenario complete") failures.push("stable edge text step")
  if (failures.length > 0) throw new Error(`self-test: scenario coverage missing: ${failures.join("; ")}`)
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
  assertScenarioCoverage()
  if (parseArgs(["--scenario", "edge"]).scenario !== "edge") throw new Error("self-test: scenario parser failed")
  try {
    parseArgs(["--scenario", "bogus"])
    throw new Error("self-test: bad scenario accepted")
  } catch (error) {
    if (!String(error).includes("unknown scenario")) throw error
  }
  const prepared = prepareScenario("full")
  const receiptDir = join(prepared.sandbox.root, "receipt")
  const command = composeCommand("/tmp/senpi", prepared.sessionDir, "full")
  const env = childEnv({ ...process.env, SENPI_CODING_AGENT_DIR: "/real/agent", OPENAI_API_KEY: "secret" }, prepared.sandbox, prepared.sessionDir, "/tmp/senpi")
  if (command.args.includes("-p") || command.args.includes("--mode")) throw new Error("self-test: TUI command must not force print/json mode")
  if (!command.args.includes(mockProviderEntry) || !command.args.includes("omo-mock") || !command.args.includes("mock-1")) throw new Error("self-test: mock provider command is incomplete")
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
    console.log("Usage: node packages/omo-senpi/scripts/qa/task-tui-e2e.mjs [--scenario edge|full] [--self-test]")
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

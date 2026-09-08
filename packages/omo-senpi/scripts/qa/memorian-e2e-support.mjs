#!/usr/bin/env bun
// Shared sandbox / RPC / mock-router harness for memorian live drivers.
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { createInterface } from "node:readline"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { createSandbox, seedSandbox } from "./drive.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(scriptDir, "..", "..")
const repoRoot = resolve(packageRoot, "..", "..")
export const DEFAULT_PLUGIN_ROOT = join(packageRoot, "plugin")
export const DEFAULT_SENPI_CLI = join(repoRoot, "node_modules", "@code-yeongyu", "senpi", "dist", "cli.js")
export const PERSONA_TITLE = "Memorian"
export const NUDGE_TOOL = "nudge"
export const SEED_PATH = "reference/kubernetes-rollouts.md"
export const SEED_DESCRIPTION = "Rollout policy"
export const SEED_BODY = "Drain nodes before a rollout; never roll during an incident."
export const TURN_1_PROMPT = "How do we handle a rollout here?"
export const TURN_2_PROMPT = "thanks"
export const TURN_TIMEOUT_MS = 60_000
export const JUDGE_TIMEOUT_MS = 60_000
export const EXIT_TIMEOUT_MS = 10_000
export const POLL_INTERVAL_MS = 200

export function parseArgs(argv, allowedScenarios = ["s1", "s2"]) {
  const options = { pluginRoot: DEFAULT_PLUGIN_ROOT, senpiCli: DEFAULT_SENPI_CLI, evidenceDir: undefined, scenario: "all", keepSandbox: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const take = () => {
      const value = argv[index + 1]
      if (value === undefined) throw new Error(`missing value for ${arg}`)
      index += 1
      return value
    }
    if (arg === "--plugin-root") options.pluginRoot = resolve(take())
    else if (arg === "--senpi-cli") options.senpiCli = resolve(take())
    else if (arg === "--evidence-dir") options.evidenceDir = resolve(take())
    else if (arg === "--scenario") options.scenario = take()
    else if (arg === "--keep-sandbox") options.keepSandbox = true
    else throw new Error(`unknown argument ${arg}`)
  }
  const allowed = ["all", ...allowedScenarios]
  if (!allowed.includes(options.scenario)) throw new Error(`--scenario must be ${allowed.join("|")}, got ${options.scenario}`)
  return options
}

export function prepareSandbox(pluginRoot, baseUrl) {
  const sandbox = createSandbox()
  seedSandbox(sandbox)
  writeFileSync(join(sandbox.agentDir, "settings.json"), `${JSON.stringify({ defaultProjectTrust: "ask", packages: [pluginRoot] }, null, 2)}\n`)
  mkdirSync(join(sandbox.agentDir, "sessions"), { recursive: true })
  mkdirSync(join(sandbox.cwd, ".omo"), { recursive: true })
  const nativeState = join(sandbox.agentDir, "omo-senpi", "omo-native")
  mkdirSync(nativeState, { recursive: true })
  writeFileSync(join(nativeState, "onboarding-completed"), `${JSON.stringify({ completedAt: new Date().toISOString(), version: 1 })}\n`)
  writeFileSync(join(sandbox.agentDir, "auth.json"), `${JSON.stringify({ "omo-mock": { type: "api_key", key: "mock" } }, null, 2)}\n`)
  const model = { id: "mock-1", name: "Mock 1", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 8192 }
  writeFileSync(join(sandbox.agentDir, "models.json"), `${JSON.stringify({ providers: { "omo-mock": { name: "omo mock http provider", api: "openai-completions", baseUrl, apiKey: "mock", models: [model] } } }, null, 2)}\n`)
  return { ...sandbox, memoryHome: join(sandbox.root, "memory") }
}

export function writeOmoConfig(sandbox, recallEnabled) {
  writeFileSync(join(sandbox.cwd, ".omo", "omo.json"), `${JSON.stringify({
    categories: { quick: { description: "QA mock quick category", model: "omo-mock/mock-1" } },
    memory: { enabled: true, recall: { enabled: recallEnabled, max_items: 2 }, reflection: { trigger: { step_count: 0, on_compaction: false } }, facts: { enabled: false } },
  }, null, 2)}\n`)
}

export function sandboxEnv(sandbox) {
  const env = { ...process.env }
  delete env.OMO_CODING_AGENT_DIR
  delete env.PI_CODING_AGENT_DIR
  delete env.SENPI_CODING_AGENT_DIR
  delete env.SENPI_BIN
  delete env.RPC_CLIENT_CAPABILITIES
  delete env.SENPI_RPC_CLIENT_CAPABILITIES
  delete env.OMO_RPC_CLIENT_CAPABILITIES
  return { ...env, SENPI_CODING_AGENT_DIR: sandbox.agentDir, OMO_MEMORY_HOME: sandbox.memoryHome, HOME: sandbox.homeDir, USERPROFILE: sandbox.homeDir, XDG_CONFIG_HOME: sandbox.xdgConfigHome, XDG_DATA_HOME: sandbox.xdgDataHome, XDG_CACHE_HOME: sandbox.xdgCacheHome }
}

export function assertSandboxEnv(sandbox, env) {
  for (const [name, expected] of [["SENPI_CODING_AGENT_DIR", sandbox.agentDir], ["OMO_MEMORY_HOME", sandbox.memoryHome], ["HOME", sandbox.homeDir]]) {
    if (env[name] !== expected) throw new Error(`env ${name} is ${env[name]}, expected the sandbox path ${expected}`)
    if (!env[name].startsWith(sandbox.root)) throw new Error(`env ${name} escapes the sandbox root ${sandbox.root}`)
  }
  for (const name of ["OMO_CODING_AGENT_DIR", "PI_CODING_AGENT_DIR", "SENPI_BIN"]) {
    if (env[name] !== undefined) throw new Error(`env ${name} must be scrubbed before spawning`)
  }
}

export function isJudgeRequest(body) {
  const tools = Array.isArray(body?.tools) ? body.tools : []
  const hasNudgeTool = tools.some((tool) => tool?.function?.name === NUDGE_TOOL || tool?.name === NUDGE_TOOL)
  const messages = Array.isArray(body?.messages) ? body.messages : []
  const system = messages.filter((message) => message?.role === "system").map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? ""))).join("\n")
  return hasNudgeTool && system.includes(PERSONA_TITLE)
}

export function createRouter({ judgeSteps }) {
  const state = { requests: 0, parent: 0, judge: 0, judgeBodies: [] }
  let parentSteps = []
  const steps = (body) => {
    const cursor = state.requests
    state.requests += 1
    const judge = isJudgeRequest(body)
    let step
    if (judge) {
      state.judgeBodies.push(body)
      step = judgeSteps[state.judge] ?? judgeSteps[judgeSteps.length - 1] ?? { type: "text", text: "" }
      state.judge += 1
    } else {
      step = parentSteps[state.parent] ?? { type: "text", text: "parent script exhausted" }
      state.parent += 1
    }
    const script = new Array(cursor).fill(undefined)
    script.push(step)
    return script
  }
  const setParentSteps = (next) => { parentSteps = next; state.parent = 0 }
  return { steps, state, setParentSteps, classify: (body) => (isJudgeRequest(body) ? "judge" : "parent") }
}

export function launchRpc(senpiCli, sandbox, env) {
  const child = spawn("bun", [senpiCli, "--mode", "rpc", "--provider", "omo-mock", "--model", "mock-1", "--session-dir", join(sandbox.agentDir, "sessions")], { cwd: sandbox.cwd, env, stdio: ["pipe", "pipe", "pipe"] })
  const events = []
  const waiters = []
  let stderr = ""
  child.stderr.on("data", (chunk) => { stderr += chunk.toString() })
  createInterface({ input: child.stdout }).on("line", (line) => {
    let event
    try { event = JSON.parse(line) } catch { return }
    events.push(event)
    for (const waiter of [...waiters]) {
      if (!waiter.predicate(event)) continue
      clearTimeout(waiter.timer)
      waiters.splice(waiters.indexOf(waiter), 1)
      waiter.resolve(event)
    }
  })
  const waitFrom = (from, predicate, timeoutMs, label) => {
    const seen = events.slice(from).find(predicate)
    if (seen !== undefined) return Promise.resolve(seen)
    return new Promise((resolvePromise, reject) => {
      const waiter = { predicate, resolve: resolvePromise, timer: undefined }
      waiter.timer = setTimeout(() => {
        waiters.splice(waiters.indexOf(waiter), 1)
        reject(new Error(`${label} timed out after ${timeoutMs}ms; events=${events.map((e) => e.type).join(",")}; stderr=${stderr.slice(-800)}`))
      }, timeoutMs)
      waiters.push(waiter)
    })
  }
  return { child, mark: () => events.length, waitFrom, stderr: () => stderr, send: (command) => { child.stdin.write(`${JSON.stringify(command)}\n`) } }
}

export async function getState(session) {
  const from = session.mark()
  session.send({ id: `state-${from}`, type: "get_state" })
  const response = await session.waitFrom(from, (event) => event.type === "response" && event.command === "get_state", TURN_TIMEOUT_MS, "get_state response")
  if (response.success !== true) throw new Error(`get_state failed: ${response.error}`)
  return response.data
}

export async function prompt(session, message, timeoutMs = TURN_TIMEOUT_MS) {
  const from = session.mark()
  session.send({ id: `prompt-${from}`, type: "prompt", message })
  await session.waitFrom(from, (event) => event.type === "agent_start", timeoutMs, "agent_start")
  await session.waitFrom(session.mark() - 1, (event) => event.type === "agent_end", timeoutMs, "agent_end")
}

export async function teardown(session) {
  const { child } = session
  if (child.exitCode !== null || child.signalCode !== null) return `pid ${child.pid} already exited`
  try { session.send({ type: "abort" }) } catch { /* stdin already closed */ }
  child.stdin.end()
  if (await waitForExit(child, EXIT_TIMEOUT_MS)) return `pid ${child.pid} exited`
  child.kill("SIGTERM")
  if (await waitForExit(child, EXIT_TIMEOUT_MS)) return `pid ${child.pid} exited after SIGTERM`
  child.kill("SIGKILL")
  await waitForExit(child, EXIT_TIMEOUT_MS)
  return `pid ${child.pid} killed`
}

export function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise((resolvePromise) => {
    const timer = setTimeout(() => { child.removeListener("exit", onExit); resolvePromise(false) }, timeoutMs)
    const onExit = () => { clearTimeout(timer); resolvePromise(true) }
    child.once("exit", onExit)
  })
}

export function readEntries(sessionFile) {
  if (!existsSync(sessionFile)) return []
  return readFileSync(sessionFile, "utf8").split("\n").filter((line) => line.trim().length > 0).flatMap((line) => { try { return [JSON.parse(line)] } catch { return [] } })
}

export function identityDirs(memoryHome) {
  const agents = join(memoryHome, "agents")
  return existsSync(agents) ? readdirSync(agents).map((name) => join(agents, name)) : []
}

export function recallRuns(memoryHome) {
  const runs = []
  for (const identity of identityDirs(memoryHome)) {
    const dir = join(identity, "runtime", "recall", "runs")
    if (!existsSync(dir)) continue
    for (const runId of readdirSync(dir)) runs.push({ runId, dir: join(dir, runId) })
  }
  return runs
}

export function pendingFiles(memoryHome, sessionId) {
  return identityDirs(memoryHome).map((identity) => join(identity, "runtime", "recall", "pending", `${sessionId}.json`)).filter(existsSync)
}

export function childTranscript(runDir) {
  if (!existsSync(runDir)) return undefined
  const file = readdirSync(runDir).find((name) => name.endsWith(".jsonl"))
  if (file === undefined) return undefined
  return { path: join(runDir, file), messages: readEntries(join(runDir, file)).filter((entry) => entry.type === "message") }
}

export function lastAssistant(messages) {
  return [...messages].reverse().find((entry) => entry.message?.role === "assistant")?.message
}

export function waitUntil(predicate, { timeoutMs, description }) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolvePromise, reject) => {
    const poll = () => {
      let value
      try { value = predicate() } catch (error) { reject(error); return }
      if (value) { resolvePromise(value); return }
      if (Date.now() >= deadline) { reject(new Error(`timed out after ${timeoutMs}ms waiting for ${description}`)); return }
      setTimeout(poll, POLL_INTERVAL_MS)
    }
    poll()
  })
}

export function assertUnchangedFor(sample, { durationMs, intervalMs, description }) {
  const first = sample()
  const deadline = Date.now() + durationMs
  return new Promise((resolvePromise, reject) => {
    const poll = () => {
      let current
      try { current = sample() } catch (error) { reject(error); return }
      if (JSON.stringify(current) !== JSON.stringify(first)) {
        reject(new Error(`${description} changed: ${JSON.stringify(first)} -> ${JSON.stringify(current)}`))
        return
      }
      if (Date.now() >= deadline) { resolvePromise(first); return }
      setTimeout(poll, intervalMs)
    }
    setTimeout(poll, intervalMs)
  })
}

export async function seedMemoryRepo(options, sandbox, env, router) {
  writeOmoConfig(sandbox, false)
  router.setParentSteps([
    { type: "tool_call", name: "memory", arguments: { command: "create", file_path: SEED_PATH, description: SEED_DESCRIPTION, file_text: SEED_BODY, reason: "seed the recall corpus for the memorian gate proof" } },
    { type: "text", text: "memory seeded" },
  ])
  const seed = spawn("bun", [options.senpiCli, "-p", "--mode", "json", "--provider", "omo-mock", "--model", "mock-1", "--session-dir", join(sandbox.agentDir, "sessions"), `Write down this operational rule: ${SEED_BODY}`], { cwd: sandbox.cwd, env, stdio: ["ignore", "pipe", "pipe"] })
  let stderr = ""
  seed.stderr.on("data", (chunk) => { stderr += chunk.toString() })
  const status = await new Promise((resolvePromise) => seed.once("exit", (code) => resolvePromise(code)))
  return { status, stderr }
}

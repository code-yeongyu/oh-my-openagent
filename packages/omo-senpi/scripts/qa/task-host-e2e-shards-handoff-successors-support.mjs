import { spawn } from "node:child_process"
import { dirname, join } from "node:path"
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs"

import { lastJsonLine, runBin } from "./task-host-e2e-process.mjs"
import { sandboxEnv } from "./task-host-e2e-sandbox.mjs"
import {
  mainProject,
  newSandbox,
  processTable,
  statusAll,
  taskConfig,
} from "./task-host-e2e-shard-cost-support.mjs"
import { pass } from "./task-host-e2e-shards-support.mjs"
import { startRoutedCompletionsServer } from "./task-host-e2e-shards-handoff-successors-http.mjs"

export const MOCK_ENTRY = new URL("./task-host-e2e-shard-cost-mock-provider.mjs", import.meta.url).pathname

export function scenarioConfig() {
  const config = taskConfig({
    default_execution_mode: "process",
    process_runner: "host",
    max_depth: 4,
  })
  config.categories.proc.model = "omo-http/mock-1"
  return config
}

export function requestView(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : []
  const userText = messages
    .filter((message) => message?.role === "user")
    .map((message) => typeof message.content === "string"
      ? message.content
      : (message.content ?? []).map((part) => part?.text ?? "").join(""))
    .join("\n")
  const markers = userText.match(/T14_[A-Z0-9_]+/g)
  const calls = messages.flatMap((message) => [
    ...(Array.isArray(message?.tool_calls) ? message.tool_calls : []),
    ...(Array.isArray(message?.content)
      ? message.content.filter((part) => part?.type === "toolCall" || part?.type === "tool_call")
      : []),
  ])
  return {
    user: markers?.at(-1) ?? userText,
    count: (name) => calls.filter((call) =>
      call?.function?.name === name || call?.name === name).length,
  }
}

export const textStep = (text, releasePath) => ({
  type: "text",
  text,
  releasePath,
})

export const taskStep = (name, prompt, extra = {}) => ({
  type: "tool_call",
  name: "task",
  arguments: { category: "proc", run_in_background: true, name, prompt, ...extra },
})

export const batchTaskStep = (items) => ({
  type: "tool_call",
  name: "task",
  arguments: {
    tasks: items.map(({ name, prompt }) => ({
      category: "proc",
      run_in_background: true,
      name,
      prompt,
    })),
    run_in_background: true,
  },
})

export const heldTaskStep = (text, releasePath, name, prompt, extra = {}) => ({
  type: "stream_tool",
  text,
  releasePath,
  tool: taskStep(name, prompt, extra),
})

export function writeParentScript(sandbox, parentSteps) {
  writeFileSync(join(sandbox.cwd, "mock-script.json"), `${JSON.stringify({
    parentSteps,
    childSteps: [{ type: "text", text: "unused" }],
  }, null, 2)}\n`)
}

export function startHttpParent(sandbox, prompt, { session } = {}) {
  const args = [
    "-p",
    "--mode",
    "json",
    "--provider",
    "omo-http",
    "--model",
    "mock-1",
    "--session-dir",
    sandbox.sessionDir,
    prompt,
  ]
  if (session !== undefined) args.unshift("--session", session)
  const child = spawn(sandbox.bin, args, {
    cwd: sandbox.cwd,
    env: sandboxEnv(sandbox),
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  })
  const chunks = { stdout: "", stderr: "" }
  child.stdout?.setEncoding("utf8")
  child.stderr?.setEncoding("utf8")
  child.stdout?.on("data", (chunk) => { chunks.stdout += chunk })
  child.stderr?.on("data", (chunk) => { chunks.stderr += chunk })
  const closed = new Promise((resolve) => {
    child.once("close", (status, signal) => resolve({ status, signal }))
    child.once("error", () => resolve({ status: null, signal: null }))
  })
  return { child, chunks, closed }
}

export function startCommand(sandbox, args) {
  const child = spawn(sandbox.bin, args, {
    cwd: sandbox.cwd,
    env: sandboxEnv(sandbox),
    stdio: ["ignore", "pipe", "pipe"],
  })
  const chunks = { stdout: "", stderr: "" }
  child.stdout?.setEncoding("utf8")
  child.stderr?.setEncoding("utf8")
  child.stdout?.on("data", (chunk) => { chunks.stdout += chunk })
  child.stderr?.on("data", (chunk) => { chunks.stderr += chunk })
  const closed = new Promise((resolve) => {
    child.once("close", (status, signal) => resolve({ status, signal }))
    child.once("error", (error) => resolve({ status: null, signal: null, error }))
  })
  return { child, chunks, closed }
}

export async function createHttpScenario(current, name, route, long = false) {
  const scenarioName = long ? `${name}-${"x".repeat(72)}` : name
  const sandbox = newSandbox(current, scenarioName, {
    omoConfig: scenarioConfig(),
    script: { parentSteps: [{ type: "text", text: "unused" }], childSteps: [{ type: "text", text: "unused" }] },
  })
  const requestLog = join(sandbox.root, "http-requests.jsonl")
  const server = startRoutedCompletionsServer({
    route: (body) => route(requestView(body)),
    requestLogPath: requestLog,
    classify: (body) => {
      const user = requestView(body).user
      return user.slice(-120)
    },
  })
  const baseUrl = await server.ready
  writeFileSync(join(sandbox.agentDir, "models.json"), `${JSON.stringify({
    providers: {
      "omo-http": {
        name: "todo 14 local http mock",
        api: "openai-completions",
        baseUrl,
        apiKey: "local-qa-only",
        models: [{
          id: "mock-1",
          name: "Todo 14 HTTP mock",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 200000,
          maxTokens: 4096,
        }],
      },
    },
  }, null, 2)}\n`)
  return { sandbox, project: mainProject(sandbox), requestLog, close: server.close }
}

export function requestSeen(requestLog, marker) {
  return existsSync(requestLog) && readFileSync(requestLog, "utf8").includes(marker)
}

export function runtimeBin(current) {
  return join(dirname(current.pluginRoot), "omo")
}

export function swapBinary(source, destination) {
  const staged = `${destination}.swap-${process.pid}`
  copyFileSync(source, staged)
  chmodSync(staged, 0o755)
  renameSync(staged, destination)
}

export const endpoint = (sandbox, kind) =>
  statusAll(sandbox).endpoints.find((row) => row.shard?.kind === kind)

export function handoff(sandbox) {
  const result = runBin(sandbox, ["daemon", "handoff", "--json"], { timeoutMs: 240_000 })
  if (result.status !== 0) throw new Error(`handoff failed: ${result.stderr || result.stdout}`)
  return lastJsonLine(result.stdout)
}

export function sessionRow(report, sessionPath) {
  return report?.session_rows?.find((row) => row.session_path === sessionPath)
}

export function privateHostSocket(endpointFact) {
  const args = processTable().get(endpointFact?.host)?.args ?? ""
  const match = /--listen(?:=|\s+)(?:unix:\/\/)?([^\s]+)/.exec(args)
  if (match?.[1] === undefined) throw new Error(`private host socket missing from: ${args}`)
  return match[1].replace(/^['"]|['"]$/g, "")
}

export function supervisorCount(socket) {
  return [...processTable().values()].filter((row) =>
    row.args.includes("--internal-rpc-host-supervisor") && row.args.includes(socket)).length
}

export function nextSockets(socket) {
  const prefix = `${socket.split("/").at(-1)}.next-`
  return readdirSync(dirname(socket)).filter((name) => name.startsWith(prefix)).sort()
}

export function sessionFile(sandbox, sessionId) {
  const name = readdirSync(sandbox.sessionDir)
    .find((entry) => entry.includes(sessionId) && entry.endsWith(".jsonl"))
  if (name === undefined) throw new Error(`session transcript missing for ${sessionId}`)
  return join(sandbox.sessionDir, name)
}

export function scenarioResult(ok, path, facts, reason) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(facts, null, 2)}\n`)
  return ok ? pass([path], facts) : { status: "fail", evidence: [path], reason, facts }
}

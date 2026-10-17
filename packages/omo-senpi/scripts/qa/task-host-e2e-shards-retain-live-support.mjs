import { spawn } from "node:child_process"
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"

import { startMockCompletionsServer } from "./mock-completions-server.mjs"
import { stopParent } from "./task-host-e2e-events.mjs"
import { sandboxEnv } from "./task-host-e2e-sandbox.mjs"
import {
  mainProject,
  newSandbox,
  stopEndpoint,
  taskConfig,
  taskRecords,
  teardownSandbox,
} from "./task-host-e2e-shard-cost-support.mjs"
import { scenarioResult } from "./task-host-e2e-shards-handoff-successors-support.mjs"
import { fail } from "./task-host-e2e-shards-support.mjs"
import { childSessionFiles, jsonlLines } from "./task-host-e2e-support.mjs"

export const IDLE_MS = 5_000
export const terminal = (record) =>
  ["completed", "error", "lost", "cancelled"].includes(record?.status)
export const taskStep = (name, prompt) => ({
  type: "tool_call",
  name: "task",
  arguments: { category: "proc", run_in_background: true, name, prompt },
})
export const taskOutputStep = (taskId) => ({
  type: "tool_call",
  name: "task_output",
  arguments: { task_id: taskId, mode: "status" },
})
export const heldText = (text, releasePath) => ({
  type: "text",
  text,
  releaseWhen: () => existsSync(releasePath),
  releaseTimeoutMs: 600_000,
})
export const textStep = (text) => ({ type: "text", text })
export const readStep = (path) => ({
  type: "tool_call",
  name: "read",
  arguments: { path },
})

function config(task = {}) {
  const value = taskConfig({
    default_execution_mode: "process",
    process_runner: "host",
    max_depth: 4,
    ...task,
  })
  value.categories.proc.model = "omo-child/mock-1"
  return value
}

function provider(baseUrl, name) {
  return {
    name,
    api: "openai-completions",
    baseUrl,
    apiKey: "local-qa-only",
    models: [{
      id: "mock-1",
      name,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: 4096,
    }],
  }
}

export async function createRetainScenario(
  current,
  name,
  { parentSteps, childSteps, task = {} },
) {
  const sandbox = newSandbox(current, name, {
    omoConfig: config(task),
    script: { parentSteps: [], childSteps: [] },
  })
  const parentLog = join(sandbox.root, "parent-http.jsonl")
  const childLog = join(sandbox.root, "child-http.jsonl")
  const parentServer = startMockCompletionsServer({
    steps: parentSteps,
    requestLogPath: parentLog,
    classifyRequest: () => "parent",
  })
  const childServer = startMockCompletionsServer({
    steps: childSteps,
    requestLogPath: childLog,
    classifyRequest: () => "child",
  })
  const [parentUrl, childUrl] = await Promise.all([parentServer.ready, childServer.ready])
  writeFileSync(join(sandbox.agentDir, "models.json"), `${JSON.stringify({
    providers: {
      "omo-http": provider(parentUrl, "Todo 14 parent HTTP mock"),
      "omo-child": provider(childUrl, "Todo 14 child HTTP mock"),
    },
  }, null, 2)}\n`)
  return {
    sandbox,
    project: mainProject(sandbox),
    parentLog,
    childLog,
    parentServer,
    childServer,
  }
}

export function parentSessionPath(sandbox, parentId) {
  const name = readdirSync(sandbox.sessionDir)
    .find((entry) => entry.endsWith(".jsonl") && entry.includes(parentId))
  if (name === undefined) throw new Error(`parent transcript missing for ${parentId}`)
  return join(sandbox.sessionDir, name)
}

export function startParent(scenario, prompt, session, env = {}) {
  const args = [
    "-p",
    "--mode", "json",
    "--provider", "omo-http",
    "--model", "mock-1",
    "--session-dir", scenario.sandbox.sessionDir,
    prompt,
  ]
  if (session !== undefined) args.unshift("--session", session)
  const child = spawn(scenario.sandbox.bin, args, {
    cwd: scenario.sandbox.cwd,
    env: sandboxEnv(scenario.sandbox, env),
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
    child.once("error", (error) => resolve({ status: null, signal: null, error }))
  })
  return { child, chunks, closed }
}

export async function replaceParentServer(scenario, steps) {
  scenario.parentServer.abortConnections()
  scenario.parentServer.close()
  scenario.parentServer = startMockCompletionsServer({
    steps,
    requestLogPath: scenario.parentLog,
    classifyRequest: () => "parent-resume",
  })
  const baseUrl = await scenario.parentServer.ready
  const modelsPath = join(scenario.sandbox.agentDir, "models.json")
  const models = JSON.parse(readFileSync(modelsPath, "utf8"))
  models.providers["omo-http"].baseUrl = baseUrl
  writeFileSync(modelsPath, `${JSON.stringify(models, null, 2)}\n`)
}

export function requestCount(path) {
  return existsSync(path)
    ? readFileSync(path, "utf8").split("\n").filter(Boolean).length
    : 0
}

export function childTurnFacts(sandbox, taskId, prompt) {
  const files = childSessionFiles(sandbox, taskId)
  const rows = files.flatMap(jsonlLines).flatMap((line) => {
    try {
      return [JSON.parse(line)]
    } catch {
      return []
    }
  })
  const users = rows.filter((row) => row.message?.role === "user")
  return {
    child_session_files: files,
    machine_user_turns: users.length,
    prompt_count: users.filter((row) =>
      JSON.stringify(row.message.content).includes(prompt)).length,
  }
}

// A parent resuming a retained child reopens it through the manager's respawn path, whose nudge is
// senpi-task's CONTINUATION_MESSAGE (manager-respawn.ts); a live parent re-joining after a host
// crash sends the `[host-session-reattach]` prompt instead. Either one is a lifecycle continuation.
const CONTINUATION_MARKERS = ["[host-session-reattach]", "interrupted by a host process restart"]

export function lifecycleContinuations(sandbox, taskId) {
  return childSessionFiles(sandbox, taskId).flatMap(jsonlLines).filter((line) =>
    line.includes('"role":"user"') && CONTINUATION_MARKERS.some((marker) => line.includes(marker))).length
}

// A retained child whose parent has quit finishes its turn inside the host, but nobody writes its
// task record until a parent reconciles it; the transcript is the only witness of that turn ending.
export function transcriptSettled(sandbox, taskId, pattern) {
  return childSessionFiles(sandbox, taskId).flatMap(jsonlLines).some((line) =>
    line.includes('"role":"assistant"') && pattern.test(line))
}

export function recordPath(project, taskId) {
  return join(project.stateDir, "tasks", `${taskId}.json`)
}

export function rewriteRecordedSocket(project, taskId, socket, instanceId) {
  const path = recordPath(project, taskId)
  const record = JSON.parse(readFileSync(path, "utf8"))
  writeFileSync(path, `${JSON.stringify({
    ...record,
    host_session: { ...record.host_session, socket, instance_id: instanceId },
    updated_at: new Date().toISOString(),
  }, null, 2)}\n`)
}

export function noticeCount(path, token) {
  return jsonlLines(path).filter((line) => line.includes(token)).length
}

export async function cleanupScenario(scenario, parents, artifact) {
  for (const parent of parents.filter(Boolean)) {
    try {
      await stopParent(parent)
    } catch (error) {
      if (error?.code !== "EPERM" && error?.code !== "ESRCH") throw error
    }
  }
  scenario.parentServer.abortConnections()
  scenario.childServer.abortConnections()
  scenario.parentServer.close()
  scenario.childServer.close()
  // A long scenario name pushes the p-* candidate past sun_path, so the shard binds under an alt
  // root (/tmp/omo-rpc-<8hex>/) that the sandbox-local endpoint listing never sees: stop those
  // endpoints through the recorded sockets and remove their roots, or they outlive the run.
  const altSockets = [...new Set(taskRecords(scenario.project)
    .map((record) => record.host_session?.socket)
    .filter((socket) => typeof socket === "string" && !socket.startsWith(scenario.sandbox.root)))]
  const altEndpoints = []
  for (const socket of altSockets) altEndpoints.push(await stopEndpoint(scenario.sandbox, socket))
  const cleanup = await teardownSandbox(scenario.sandbox, parents.filter(Boolean))
  const altRoots = [...new Set(altSockets.map((socket) => dirname(socket)))]
    .filter((root) => /\/omo-rpc-[0-9a-f]{8}$/.test(root))
  for (const root of altRoots) rmSync(root, { recursive: true, force: true })
  const receipt = {
    ...cleanup,
    altEndpoints,
    altRootsRemoved: altRoots.filter((root) => !existsSync(root)),
    altRootsLeft: altRoots.filter((root) => existsSync(root)),
  }
  writeFileSync(artifact, `${JSON.stringify(receipt, null, 2)}\n`)
  return receipt
}

export async function capture(id, artifacts, run) {
  const errorPath = join(artifacts, `${id}-error.json`)
  try {
    return await run()
  } catch (error) {
    writeFileSync(errorPath, `${JSON.stringify({
      error: String(error?.stack ?? error),
    }, null, 2)}\n`)
    return fail(String(error?.message ?? error), [errorPath])
  }
}

export function result(ok, path, facts, reason, extraEvidence = []) {
  return scenarioResult(ok, path, facts, reason).status === "pass"
    ? { status: "pass", evidence: [path, ...extraEvidence], facts }
    : fail(reason, [path, ...extraEvidence], facts)
}


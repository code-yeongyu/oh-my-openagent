import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { stopParent } from "./task-host-e2e-events.mjs"
import { pidAlive, spawnParent } from "./task-host-e2e-process.mjs"
import { binaryDigest, createScenarioSandbox, injectDaemonMockProvider, provisionRuntime, scenarioStateDir } from "./task-host-e2e-sandbox.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
export const MOCK_ENTRY = join(scriptDir, "task-host-e2e-shard-cost-mock-provider.mjs")
export const CHILD_TEXT = [{ type: "text", text: "shard cost child turn complete" }]
export const heldChild = (ms) => [{ type: "text", text: "held shard cost child", delayMs: ms }]

export function provisionConfig(kind, bin, runRoot) {
  const root = join(runRoot, kind === "sharded" ? "S" : "C")
  mkdirSync(root, { recursive: true })
  const runtime = provisionRuntime(bin, root)
  const injected = injectDaemonMockProvider(runtime.pluginRoot, MOCK_ENTRY)
  copyFileSync(join(scriptDir, "task-host-e2e-mock-provider.mjs"), join(runtime.pluginRoot, "task-host-e2e-mock-provider.mjs"))
  if (!injected.launchSpecPresent) throw new Error(`${kind} binary ships no daemon launch spec: ${bin}`)
  return { kind, bin, root, home: runtime.home, pluginRoot: runtime.pluginRoot, specPath: injected.specPath, version: runtime.version, digest: binaryDigest(bin) }
}

export function taskConfig(task = {}) {
  return {
    task: { default_execution_mode: "process", process_runner: "host", global_concurrency: 16, residency_max_children: 16, ...task },
    categories: { proc: { description: "Shard cost mock category.", model: "omo-mock/mock-1" } },
  }
}

export function newSandbox(config, name, { omoConfig = taskConfig(), script }) {
  return createScenarioSandbox({ runRoot: config.root, home: config.home, bin: config.bin }, name, { omoConfig, script })
}

export function addProject(sandbox, name, { omoConfig = taskConfig(), script }) {
  const cwd = join(sandbox.root, name)
  mkdirSync(join(cwd, ".omo"), { recursive: true })
  writeFileSync(join(cwd, ".omo", "omo.json"), `${JSON.stringify(omoConfig, null, 2)}\n`)
  writeFileSync(join(cwd, "mock-script.json"), `${JSON.stringify(script, null, 2)}\n`)
  const trustPath = join(sandbox.agentDir, "trust.json")
  const trust = JSON.parse(readFileSync(trustPath, "utf8"))
  writeFileSync(trustPath, `${JSON.stringify({ ...trust, [cwd]: true }, null, 2)}\n`)
  return { name, cwd, stateDir: scenarioStateDir(cwd, sandbox.agentDir), script }
}

export const mainProject = (sandbox, script) => ({ name: "proj", cwd: sandbox.cwd, stateDir: sandbox.stateDir, script })

export function holdStep(file, seconds) {
  return {
    type: "tool_call",
    name: "eval",
    arguments: {
      language: "js",
      summary: `park the QA parent until ${file}`,
      timeout: seconds,
      code: `var fs = await import("node:fs"); await new Promise((resolve, reject) => {
        var finish = () => { if (!fs.existsSync(".omo/${file}")) return; clearTimeout(timer); watcher.close(); resolve(); };
        var watcher = fs.watch(".omo", finish);
        var timer = setTimeout(() => { watcher.close(); reject(new Error("${file} missing")); }, ${seconds * 1000});
        finish();
      });`,
    },
  }
}

export const taskStep = (args) => ({ type: "tool_call", name: "task", arguments: args })
export const childTask = (prompt, extra = {}) => ({ category: "proc", prompt, ...extra })
export const release = (project, file) => writeFileSync(join(project.cwd, ".omo", file), "go\n")

export function startParent(sandbox, project, prompt, env = {}) {
  const parent = spawnParent({ ...sandbox, cwd: project.cwd }, MOCK_ENTRY, prompt, { capture: true, env })
  parent.events = []
  let buffer = ""
  parent.child.stdout?.on("data", (chunk) => {
    buffer += chunk
    for (let index = buffer.indexOf("\n"); index >= 0; index = buffer.indexOf("\n")) {
      const line = buffer.slice(0, index)
      buffer = buffer.slice(index + 1)
      try {
        parent.events.push({ at: Date.now(), event: JSON.parse(line) })
      } catch {
        // banner line
      }
    }
  })
  parent.taskCallAt = () => parent.events.find((entry) => entry.event.type === "tool_execution_start" && entry.event.toolName === "task")?.at
  parent.sessionId = () => parent.events.find((entry) => entry.event.type === "session")?.event.id
  return parent
}

export async function awaitParent(parent, timeoutMs) {
  let timer
  const outcome = await Promise.race([parent.closed, new Promise((resolve) => { timer = setTimeout(() => resolve("timeout"), timeoutMs) })])
  clearTimeout(timer)
  if (outcome === "timeout") await stopParent(parent)
  return outcome === "timeout" ? { status: null, timedOut: true } : { ...outcome, timedOut: false }
}

export function stepsKey(steps) {
  return createHash("sha256").update(JSON.stringify(steps)).digest("hex").slice(0, 16)
}

export function mockEvents(project) {
  const path = join(project.cwd, ".omo", "task-host-mock-events.jsonl")
  if (!existsSync(path)) return []
  return readFileSync(path, "utf8").split("\n").filter(Boolean).flatMap((line) => {
    try {
      return [JSON.parse(line)]
    } catch {
      return []
    }
  })
}

export function childRequests(project) {
  const prefix = `omo-host-${stepsKey(project.script.childSteps)}-`
  return mockEvents(project)
    .filter((event) => event.type === "model_request" && event.callId?.startsWith(prefix))
    .map((event) => ({ ...event, atMs: Date.parse(event.at) }))
}

export function taskRecords(project) {
  const dir = join(project.stateDir, "tasks")
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((file) => file.endsWith(".json")).flatMap((file) => {
    try {
      return [JSON.parse(readFileSync(join(dir, file), "utf8"))]
    } catch {
      return []
    }
  })
}

export {
  STATUS_ALL_FIELDS,
  endpointSockets,
  footprintMb,
  hostStatus,
  processTable,
  sampleEndpoint,
  settle,
  shardOwners,
  statusAll,
  stopEndpoint,
  supervisorPid,
  teardownSandbox,
  totalOf,
  treePids,
} from "./task-host-e2e-shard-cost-process.mjs"
export { pidAlive }

#!/usr/bin/env bun
// Shared harness of the resident Kibitzer QA lane (kibitzer-sidecar-e2e.mjs and
// kibitzer-sidecar-recovery-probe.mjs): an isolated sandbox, the mock openai-completions router
// that tells the sidecar's requests from the parent's, the RPC driver over the real senpi CLI, the
// file-signal waiter, and the readers of everything the resident sidecar leaves behind - the parent
// session JSONL, the child transcripts under `recall/sidecars/<encoded-session>/`, the pending
// nudge file and the machine-wide `recall-wake` lease files.
//
// Every wait here is an explicit signal (an RPC event, a filesystem change, a process exit) with a
// bounded timeout; nothing sleeps for a fixed interval and nothing polls the clock.
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs"
import { createInterface } from "node:readline"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { createSandbox, seedSandbox } from "./drive.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
export const PACKAGE_ROOT = resolve(scriptDir, "..", "..")
export const REPO_ROOT = resolve(PACKAGE_ROOT, "..", "..")
export const DEFAULT_PLUGIN_ROOT = join(PACKAGE_ROOT, "plugin")
export const DEFAULT_SENPI_CLI = join(REPO_ROOT, "node_modules", "@code-yeongyu", "senpi", "dist", "cli.js")

export const PERSONA_TITLE = "Kibitzer"
/** The normative model-visible registry of the resident sidecar: exactly these names, no aliases. */
export const SIDECAR_TOOL_NAMES = ["read", "grep", "session_entries", "memory", "nudge"]
export const NUDGE_TOOL = "nudge"
export const NUDGED_ENTRY_TYPE = "omo-kibitzer:nudged"
export const RECALL_ENTRY_TYPE = "omo-kibitzer:recall"
export const GATE_ENTRY_TYPE = "omo-kibitzer:gate"

export const TURN_TIMEOUT_MS = 60_000
export const WAKE_TIMEOUT_MS = 60_000
export const EXIT_TIMEOUT_MS = 10_000

/**
 * Two memories with disjoint vocabularies: each prompt names exactly one of them, so every wake
 * carries exactly one fresh candidate and a repeated prompt carries none.
 */
export const MEMORIES = {
  rollout: {
    path: "reference/kubernetes-rollouts.md",
    description: "Rollout policy",
    body: "Drain nodes before a rollout; never roll during an incident.",
    prompt: "How do we handle a rollout here?",
  },
  helm: {
    path: "reference/helm-pinning.md",
    description: "Helm pinning rule",
    body: "Pin every helm chart version; never deploy a floating chart tag.",
    prompt: "Which helm chart version do we pin?",
  },
}

// ---- arguments -----------------------------------------------------------------------------------

export function parseArgs(argv, { scenarios = [], extra = {} } = {}) {
  const options = {
    pluginRoot: DEFAULT_PLUGIN_ROOT,
    senpiCli: DEFAULT_SENPI_CLI,
    commandFile: undefined,
    manifest: undefined,
    evidenceDir: undefined,
    scenario: "all",
    keepSandbox: false,
    selfTest: false,
    ...extra,
  }
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
    else if (arg === "--command-file") options.commandFile = resolve(take())
    else if (arg === "--manifest") options.manifest = resolve(take())
    else if (arg === "--evidence-dir") options.evidenceDir = resolve(take())
    else if (arg === "--scenario") options.scenario = take()
    else if (arg === "--keep-sandbox") options.keepSandbox = true
    else if (arg === "--self-test") options.selfTest = true
    else throw new Error(`unknown argument ${arg}`)
  }
  if (scenarios.length > 0) {
    const allowed = ["all", ...scenarios]
    if (!allowed.includes(options.scenario)) throw new Error(`--scenario must be ${allowed.join("|")}, got ${options.scenario}`)
  }
  return options
}

/**
 * The executable under test. A `--command-file` holds exactly one absolute path (the packaged
 * executable a package probe recorded); a `.js`/`.mjs` path runs under this very bun, anything else
 * is executed directly. Without it the repository's pinned senpi CLI is the binary.
 */
export function resolveCommand({ commandFile, senpiCli }) {
  if (commandFile !== undefined) {
    if (!existsSync(commandFile)) throw new Error(`command file not found: ${commandFile}`)
    const lines = readFileSync(commandFile, "utf8").split(/\r?\n/).filter((line) => line.trim().length > 0)
    if (lines.length !== 1) throw new Error(`command file must hold exactly one executable path, found ${lines.length} lines: ${commandFile}`)
    const executable = lines[0].trim()
    if (!existsSync(executable)) throw new Error(`packaged executable not found: ${executable}`)
    return /\.(?:m?js|cjs)$/u.test(executable)
      ? { file: process.execPath, prefix: [executable], display: `${process.execPath} ${executable}`, source: "command-file" }
      : { file: executable, prefix: [], display: executable, source: "command-file" }
  }
  if (!existsSync(senpiCli)) throw new Error(`senpi cli not found at ${senpiCli}`)
  return { file: process.execPath, prefix: [senpiCli], display: `${process.execPath} ${senpiCli}`, source: "senpi-cli" }
}

// ---- sandbox ---------------------------------------------------------------------------------------

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
  return { ...sandbox, memoryHome: join(sandbox.root, "memory"), sessionsDir: join(sandbox.agentDir, "sessions") }
}

/** `recall` merges over the lane's defaults; `max_items: 1` makes the nudge closure end a wake on its first accept. */
export function writeOmoConfig(sandbox, { recallEnabled, recall = {} }) {
  writeFileSync(join(sandbox.cwd, ".omo", "omo.json"), `${JSON.stringify({
    categories: { quick: { description: "QA mock quick category", model: "omo-mock/mock-1" } },
    memory: {
      enabled: true,
      recall: { enabled: recallEnabled, max_items: 1, ...recall },
      reflection: { trigger: { step_count: 0, on_compaction: false } },
      facts: { enabled: false },
    },
  }, null, 2)}\n`)
}

const SCRUBBED_ENV = [
  "OMO_CODING_AGENT_DIR", "PI_CODING_AGENT_DIR", "SENPI_CODING_AGENT_DIR",
  "SENPI_PACKAGE_DIR", "OMO_PACKAGE_DIR", "PI_PACKAGE_DIR", "SENPI_BIN",
  "RPC_CLIENT_CAPABILITIES", "SENPI_RPC_CLIENT_CAPABILITIES", "OMO_RPC_CLIENT_CAPABILITIES",
  "PI_SESSION_FILE", "SENPI_SESSION_FILE",
]

export function sandboxEnv(sandbox) {
  const env = { ...process.env }
  for (const name of SCRUBBED_ENV) delete env[name]
  return {
    ...env,
    SENPI_CODING_AGENT_DIR: sandbox.agentDir,
    OMO_MEMORY_HOME: sandbox.memoryHome,
    HOME: sandbox.homeDir,
    USERPROFILE: sandbox.homeDir,
    XDG_CONFIG_HOME: sandbox.xdgConfigHome,
    XDG_DATA_HOME: sandbox.xdgDataHome,
    XDG_CACHE_HOME: sandbox.xdgCacheHome,
    // No network beyond the mock provider on 127.0.0.1.
    PI_OFFLINE: "1",
  }
}

export function assertSandboxEnv(sandbox, env) {
  for (const [name, expected] of [["SENPI_CODING_AGENT_DIR", sandbox.agentDir], ["OMO_MEMORY_HOME", sandbox.memoryHome], ["HOME", sandbox.homeDir]]) {
    if (env[name] !== expected) throw new Error(`env ${name} is ${env[name]}, expected the sandbox path ${expected}`)
    if (!env[name].startsWith(sandbox.root)) throw new Error(`env ${name} escapes the sandbox root ${sandbox.root}`)
  }
  for (const name of ["OMO_CODING_AGENT_DIR", "PI_CODING_AGENT_DIR", "SENPI_BIN", "SENPI_PACKAGE_DIR", "OMO_PACKAGE_DIR", "PI_PACKAGE_DIR"]) {
    if (env[name] !== undefined) throw new Error(`env ${name} must be scrubbed before spawning`)
  }
  if (env.PI_OFFLINE !== "1") throw new Error("env PI_OFFLINE must be 1: the lane allows no network beyond the mock provider")
}

// ---- the mock router ---------------------------------------------------------------------------------

export function requestToolNames(body) {
  const tools = Array.isArray(body?.tools) ? body.tools : []
  return tools.map((tool) => tool?.function?.name ?? tool?.name).filter((name) => typeof name === "string")
}

export function requestSystemText(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : []
  return messages
    .filter((message) => message?.role === "system")
    .map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? "")))
    .join("\n")
}

/** A sidecar request carries the nudge tool and the Kibitzer persona; the parent never has both. */
export function isSidecarRequest(body) {
  return requestToolNames(body).includes(NUDGE_TOOL) && requestSystemText(body).includes(PERSONA_TITLE)
}

export function sameNames(actual, expected) {
  return actual.length === expected.length && [...actual].sort().every((name, index) => name === [...expected].sort()[index])
}

/**
 * Routes each request to its lane's script. Both lanes advance independently; an exhausted script
 * answers with a closing text so a turn always ends instead of looping on a repeated tool call.
 * The step is placed at the server's global cursor because the mock consumes one step per request.
 *
 * `lanes` are consulted first: a surface that makes provider calls of its own beside the parent
 * turn (the interactive TUI's session-title generation) names them by `matches(body)` and answers
 * them with `step(body)`, so they neither consume the parent's script nor count as parent turns;
 * each such lane is counted under `state[name]`.
 */
export function createRouter({ lanes = [] } = {}) {
  const state = { requests: 0, parent: 0, sidecar: 0, sidecarRequests: [] }
  let parentSteps = []
  let sidecarSteps = []
  let parentCursor = 0
  let sidecarCursor = 0
  const laneFor = (body) => lanes.find((lane) => lane.matches(body))
  const steps = (body) => {
    const index = state.requests
    state.requests += 1
    let step
    const lane = laneFor(body)
    if (lane !== undefined) {
      state[lane.name] = (state[lane.name] ?? 0) + 1
      step = lane.step(body)
    } else if (isSidecarRequest(body)) {
      state.sidecarRequests.push({ index, toolNames: requestToolNames(body), messageCount: Array.isArray(body?.messages) ? body.messages.length : 0 })
      step = sidecarSteps[sidecarCursor] ?? { type: "text", text: "sidecar script exhausted" }
      sidecarCursor += 1
      state.sidecar += 1
    } else {
      step = parentSteps[parentCursor] ?? { type: "text", text: "parent script exhausted" }
      parentCursor += 1
      state.parent += 1
    }
    const script = new Array(index).fill(undefined)
    script.push(step)
    return script
  }
  return {
    steps,
    state,
    classify: (body) => laneFor(body)?.name ?? (isSidecarRequest(body) ? "sidecar" : "parent"),
    setParentSteps(next) { parentSteps = next; parentCursor = 0 },
    setSidecarSteps(next) { sidecarSteps = next; sidecarCursor = 0 },
  }
}

export function nudgeStep(memory, extra = {}) {
  return { type: "tool_call", name: NUDGE_TOOL, arguments: { path: memory.path, hint: memory.body }, ...extra }
}

/** A 429 whose body names an hour-plus wait: senpi's tier-3 policy fails the turn in ONE request. */
export const RATE_LIMIT_STEP = {
  type: "error",
  status: 429,
  body: { error: { type: "rate_limit_error", message: "rate limit exceeded; retry after 7200 seconds" } },
}

// ---- the RPC driver ----------------------------------------------------------------------------------

export function launchRpc(command, sandbox, env) {
  const child = spawn(command.file, [...command.prefix, "--mode", "rpc", "--provider", "omo-mock", "--model", "mock-1", "--session-dir", sandbox.sessionsDir], { cwd: sandbox.cwd, env, stdio: ["pipe", "pipe", "pipe"] })
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
  const exited = new Promise((resolvePromise) => child.once("exit", (code, signal) => resolvePromise({ code, signal })))
  const waitFrom = (from, predicate, timeoutMs, label) => {
    const seen = events.slice(from).find(predicate)
    if (seen !== undefined) return Promise.resolve(seen)
    return new Promise((resolvePromise, reject) => {
      const waiter = { predicate, resolve: resolvePromise, timer: undefined }
      waiter.timer = setTimeout(() => {
        waiters.splice(waiters.indexOf(waiter), 1)
        reject(new Error(`${label} timed out after ${timeoutMs}ms; events=${events.map((event) => event.type).join(",")}; stderr=${stderr.slice(-800)}`))
      }, timeoutMs)
      waiters.push(waiter)
    })
  }
  return {
    child,
    pid: child.pid,
    exited,
    mark: () => events.length,
    waitFrom,
    stderr: () => stderr,
    send: (message) => { child.stdin.write(`${JSON.stringify(message)}\n`) },
  }
}

export async function getState(session) {
  const from = session.mark()
  session.send({ id: `state-${from}`, type: "get_state" })
  const response = await session.waitFrom(from, (event) => event.type === "response" && event.command === "get_state", TURN_TIMEOUT_MS, "get_state response")
  if (response.success !== true) throw new Error(`get_state failed: ${response.error}`)
  return response.data
}

/** One parent turn: the prompt is sent, then agent_start and agent_end are awaited in order. */
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
  try { child.stdin.end() } catch { /* stdin already closed */ }
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

export function isAlive(pid) {
  if (typeof pid !== "number") return false
  try { process.kill(pid, 0); return true } catch (error) { return error?.code === "EPERM" }
}

// ---- file signals ------------------------------------------------------------------------------------

/**
 * Resolves with the first non-undefined, non-false value of `predicate`, re-evaluated on every
 * change under the given directory or directories (recursive). The predicate runs once before the
 * watchers are armed so a state that already holds never waits, and once after arming so nothing
 * racing the arming is lost.
 */
export function watchUntil(directories, predicate, { timeoutMs, description }) {
  const roots = Array.isArray(directories) ? directories : [directories]
  for (const root of roots) mkdirSync(root, { recursive: true })
  return new Promise((resolvePromise, reject) => {
    const watchers = []
    let timer
    let done = false
    const finish = (settle, value) => {
      if (done) return
      done = true
      clearTimeout(timer)
      for (const watcher of watchers) watcher.close()
      settle(value)
    }
    const inspect = () => {
      let value
      try { value = predicate() } catch (error) { finish(reject, error); return }
      if (value !== undefined && value !== false) finish(resolvePromise, value)
    }
    inspect()
    if (done) return
    try {
      for (const root of roots) {
        const watcher = watch(root, { recursive: true }, inspect)
        watcher.on("error", (error) => finish(reject, error))
        watchers.push(watcher)
      }
    } catch (error) {
      finish(reject, error)
      return
    }
    timer = setTimeout(() => finish(reject, new Error(`${description} timed out after ${timeoutMs}ms`)), timeoutMs)
    inspect()
  })
}

/**
 * A wake has accepted `memory` once delivery holds it: the pending file (parent already settled) or
 * an `omo-kibitzer:nudged` entry (steered into a running parent turn). Either signal ends the wait.
 */
export function waitForAccepted(identity, state, memory, { timeoutMs = WAKE_TIMEOUT_MS, description }) {
  return watchUntil([join(identity, "runtime", "recall"), dirname(state.sessionFile)], () => {
    const held = readPending(identity, state.sessionId)
    if (held?.nudges?.some((nudge) => nudge.path === memory.path)) return { via: "pending", nudges: held.nudges }
    const nudged = readEntries(state.sessionFile).filter(isNudged).find((entry) => entry.data?.nudges?.some((nudge) => nudge.path === memory.path))
    return nudged === undefined ? undefined : { via: nudged.data.via, nudges: nudged.data.nudges }
  }, { timeoutMs, description })
}

// ---- readers -------------------------------------------------------------------------------------------

export function readEntries(file) {
  if (!existsSync(file)) return []
  return readFileSync(file, "utf8").split("\n").filter((line) => line.trim().length > 0).flatMap((line) => { try { return [JSON.parse(line)] } catch { return [] } })
}

export const isNudged = (entry) => entry.type === "custom" && entry.customType === NUDGED_ENTRY_TYPE
export const isRecall = (entry) => entry.type === "custom_message" && entry.customType === RECALL_ENTRY_TYPE
export const isGate = (entry) => entry.type === "custom" && entry.customType === GATE_ENTRY_TYPE
export const isUserMessage = (entry) => entry.type === "message" && entry.message?.role === "user"
export const isAssistantMessage = (entry) => entry.type === "message" && entry.message?.role === "assistant"

export function messageText(message) {
  const content = message?.content
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content.map((block) => (block?.type === "text" && typeof block.text === "string" ? block.text : "")).join("")
}

export function toolCallsOf(message) {
  return Array.isArray(message?.content) ? message.content.filter((block) => block?.type === "toolCall") : []
}

export function nudgedPaths(entries) {
  return entries.filter(isNudged).flatMap((entry) => (Array.isArray(entry.data?.nudges) ? entry.data.nudges.map((nudge) => nudge.path) : []))
}

/** Durable identities of the sandbox: `<memory>/agents/<id>` (a transient one-shot run never lands here). */
export function identityDirs(memoryHome) {
  const agents = join(memoryHome, "agents")
  return existsSync(agents) ? readdirSync(agents).sort().map((name) => join(agents, name)) : []
}

export function decodeSidecarDirName(name) {
  return Buffer.from(name, "base64url").toString("utf8")
}

export function encodeSidecarDirName(sessionId) {
  return Buffer.from(sessionId, "utf8").toString("base64url")
}

/** `recall/sidecars/<encoded-session>/`: one directory per resident lineage, one JSONL per child generation. */
export function sidecarDirs(identityDir) {
  const root = join(identityDir, "runtime", "recall", "sidecars")
  if (!existsSync(root)) return []
  return readdirSync(root).sort().map((name) => ({ name, dir: join(root, name), sessionId: decodeSidecarDirName(name) }))
}

export function childTranscripts(sidecarDir) {
  if (!existsSync(sidecarDir)) return []
  return readdirSync(sidecarDir).filter((name) => name.endsWith(".jsonl")).sort().map((name) => {
    const file = join(sidecarDir, name)
    const entries = readEntries(file)
    return {
      file,
      entries,
      users: entries.filter(isUserMessage).map((entry) => entry.message),
      assistants: entries.filter(isAssistantMessage).map((entry) => entry.message),
    }
  })
}

export function leaseFiles(identityDir) {
  const locks = join(identityDir, "runtime", "locks")
  if (!existsSync(locks)) return []
  return readdirSync(locks).filter((name) => /^recall-wake\.slot-\d+\.lock$/u.test(name)).sort()
}

export function pendingFile(identityDir, sessionId) {
  return join(identityDir, "runtime", "recall", "pending", `${sessionId}.json`)
}

export function readPending(identityDir, sessionId) {
  const file = pendingFile(identityDir, sessionId)
  if (!existsSync(file)) return undefined
  try { return JSON.parse(readFileSync(file, "utf8")) } catch { return undefined }
}

// ---- seeding -------------------------------------------------------------------------------------------

/**
 * Seeds the recall corpus through the parent's real `memory` tool in an RPC session of its own
 * (a `-p` one-shot run is routed to `transient-runs/` and never becomes the durable identity the
 * sidecar reads). Recall is off for the seed run so no sidecar exists yet.
 */
export async function seedMemories(command, sandbox, env, router, memories) {
  writeOmoConfig(sandbox, { recallEnabled: false })
  router.setParentSteps([
    ...memories.map((memory) => ({
      type: "tool_call",
      name: "memory",
      arguments: { command: "create", file_path: memory.path, description: memory.description, file_text: memory.body, reason: "seed the recall corpus for the resident Kibitzer QA lane" },
    })),
    { type: "text", text: "memory seeded" },
  ])
  const session = launchRpc(command, sandbox, env)
  let receipt
  let exit
  try {
    const state = await getState(session)
    await prompt(session, "Write down these operational rules for later.")
    const entries = readEntries(state.sessionFile)
    const results = entries
      .filter((entry) => entry.type === "message" && entry.message?.role === "toolResult" && entry.message?.toolName === "memory")
      .map((entry) => ({ isError: entry.message.isError === true, text: messageText(entry.message).slice(0, 160) }))
    const identities = identityDirs(sandbox.memoryHome)
    const seeded = memories.map((memory) => identities.map((dir) => join(dir, "repo", memory.path)).filter(existsSync))
    receipt = {
      sessionId: state.sessionId,
      results,
      identities,
      seeded,
      ok: identities.length === 1 && seeded.every((hits) => hits.length === 1) && results.length === memories.length && results.every((result) => !result.isError),
    }
  } finally {
    // The seed process is torn down whether or not the turn succeeded; the caller reads `stderr` on failure.
    exit = await teardown(session)
  }
  return { ...receipt, teardown: exit, stderr: session.stderr().slice(-1200) }
}

// ---- cleanup -------------------------------------------------------------------------------------------

/**
 * One registry for everything a driver must undo, run in reverse order of registration. `run` is
 * idempotent and shared: a second caller (the driver's own finish racing an interrupt handler)
 * awaits the SAME in-flight run instead of getting an empty receipt list back and exiting while
 * processes are still being torn down. The driver wires it to SIGINT / SIGTERM once (see
 * `installInterruptCleanup`) so an interrupted lane still kills its processes and removes its sandbox.
 */
export function createCleanup() {
  const steps = []
  const receipts = []
  let running
  return {
    add(label, action) { steps.push({ label, action }) },
    receipts,
    run() {
      if (running !== undefined) return running
      running = (async () => {
        for (const step of steps.reverse()) {
          try {
            const detail = await step.action()
            receipts.push(`${step.label}: ${detail ?? "done"}`)
          } catch (error) {
            receipts.push(`${step.label}: FAILED ${error instanceof Error ? error.message : String(error)}`)
          }
        }
        return receipts
      })()
      return running
    },
  }
}

/** Installs ONE interrupt handler pair that runs every registry `registries()` returns, then exits 130. */
export function installInterruptCleanup(registries) {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      void Promise.all(registries().map((registry) => registry.run())).then((receipts) => {
        console.error(`interrupted by ${signal}; cleanup: ${receipts.flat().join(", ")}`)
        process.exit(130)
      })
    })
  }
}

export function removeSandbox(sandbox, keep) {
  if (keep) return `sandbox KEPT: ${sandbox.root}`
  rmSync(sandbox.root, { recursive: true, force: true })
  return existsSync(sandbox.root) ? `sandbox NOT removed: ${sandbox.root}` : "sandbox removed"
}

export function writeEvidence(dir, name, body) {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, name)
  writeFileSync(file, typeof body === "string" ? body : `${JSON.stringify(body, null, 2)}\n`)
  return file
}

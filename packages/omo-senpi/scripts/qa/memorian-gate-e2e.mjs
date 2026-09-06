#!/usr/bin/env bun
// allow: SIZE_OK - one auditable offline proof of the memorian recall gate: sandbox, mock provider,
// RPC session, judge routing and the parent-session assertions belong to one indivisible lifecycle.
//
// Offline end-to-end proof of the memorian recall gate (plan .omo/plans/memorian-judge-completion-policy.md todo 7).
//
// The unit suites can only prove the runner's contract against a fake child session. This driver
// proves the SHIPPED bundle: a real senpi process, a real in-process judge child, a real HTTP
// provider (127.0.0.1, no network), and the parent session's own JSONL as the verdict surface.
//
//   S1 the judge calls `nudge` and then ends its turn SILENTLY (the real persona's shape: its only
//      output channel is the tool). Expected: `omo-memorian:nudged` on the next turn, the recall
//      custom_message injected, and NO failed `omo-memorian:gate` entry. On the pre-fix bundle the
//      silent turn is classified `child-turn-failed`, so this scenario is the RED proof.
//   S2 the judge's provider request returns HTTP 500. Expected: a gate entry with cause
//      `child_failed`, a sanitized single-line reason within the 160-char cap and a uuid runId -
//      the failure is NAMED, not swallowed, and nothing is nudged or left pending.
//
// Routing: the mock server sees BOTH the parent's and the judge's requests. A judge request is the
// one carrying the `nudge` function tool and the Memorian persona; everything else is the parent.
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { createInterface } from "node:readline"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { createSandbox, seedSandbox } from "./drive.mjs"
import { startMockCompletionsServer } from "./mock-completions-server.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(scriptDir, "..", "..")
const repoRoot = resolve(packageRoot, "..", "..")
const DEFAULT_PLUGIN_ROOT = join(packageRoot, "plugin")
const DEFAULT_SENPI_CLI = join(repoRoot, "node_modules", "@code-yeongyu", "senpi", "dist", "cli.js")
const PERSONA_TITLE = "Memorian"
const NUDGE_TOOL = "nudge"
const SEED_PATH = "reference/kubernetes-rollouts.md"
const SEED_DESCRIPTION = "Rollout policy"
const SEED_BODY = "Drain nodes before a rollout; never roll during an incident."
// Recall is LEXICAL: `planRecallQueries` keeps only terms present in the note's description or body,
// and `selectRecallCandidates` requires every term of a query to match. "kubernetes rollouts" appears
// in the note's PATH only, which the matcher never reads, so the turn-1 prompt is worded from the
// note's own words ("rollout") - otherwise the gate is skipped for want of candidates and this
// driver would prove nothing.
const TURN_1_PROMPT = "How do we handle a rollout here?"
const TURN_2_PROMPT = "thanks"
const TURN_TIMEOUT_MS = 60_000
const JUDGE_TIMEOUT_MS = 60_000
const EXIT_TIMEOUT_MS = 10_000
const POLL_INTERVAL_MS = 200

function parseArgs(argv) {
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
    // Debug affordance (precedent: memory-write-visual-qa.mjs): a failing run's sandbox is the only
    // place the judge's child transcript survives.
    else if (arg === "--keep-sandbox") options.keepSandbox = true
    else throw new Error(`unknown argument ${arg}`)
  }
  if (!["s1", "s2", "all"].includes(options.scenario)) throw new Error(`--scenario must be s1|s2|all, got ${options.scenario}`)
  return options
}

const checks = []

function record(name, ok, detail) {
  checks.push({ name, ok, detail })
  console.log(`${ok ? "PASS" : "FAIL"} ${name} :: ${detail}`)
}

// ---------------------------------------------------------------------------
// Sandbox
// ---------------------------------------------------------------------------

function prepareSandbox(pluginRoot, baseUrl) {
  const sandbox = createSandbox()
  seedSandbox(sandbox)
  // seedSandbox writes settings.json pointing at ITS OWN package root; the caller's --plugin-root is
  // what decides which bundle (pre-fix or fixed) is under test, so it is rewritten explicitly.
  writeFileSync(join(sandbox.agentDir, "settings.json"), `${JSON.stringify({ defaultProjectTrust: "ask", packages: [pluginRoot] }, null, 2)}\n`)
  mkdirSync(join(sandbox.agentDir, "sessions"), { recursive: true })
  mkdirSync(join(sandbox.cwd, ".omo"), { recursive: true })
  // Onboarding claims the FIRST turn of a fresh agent dir with its own bootstrap prompt, which would
  // consume a scripted parent step and desynchronize the whole scenario.
  const nativeState = join(sandbox.agentDir, "omo-senpi", "omo-native")
  mkdirSync(nativeState, { recursive: true })
  writeFileSync(join(nativeState, "onboarding-completed"), `${JSON.stringify({ completedAt: new Date().toISOString(), version: 1 })}\n`)
  // The category resolver drops providers without configured auth, so the mock needs an auth entry.
  writeFileSync(join(sandbox.agentDir, "auth.json"), `${JSON.stringify({ "omo-mock": { type: "api_key", key: "mock" } }, null, 2)}\n`)
  writeFileSync(join(sandbox.agentDir, "models.json"), `${JSON.stringify({
    providers: {
      "omo-mock": {
        name: "omo mock http provider",
        api: "openai-completions",
        baseUrl,
        apiKey: "mock",
        models: [{
          id: "mock-1",
          name: "Mock 1",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 200000,
          maxTokens: 8192,
        }],
      },
    },
  }, null, 2)}\n`)
  return { ...sandbox, memoryHome: join(sandbox.root, "memory") }
}

/**
 * Recall is written OFF for the seeding turn and ON for the scenario. The seed turn's own settle
 * already matches the note it just wrote, and its gate run would consume the judge script and write
 * the verdict against the SEED session - leaving the RPC session waiting on a judge that already
 * happened. The scenario must own the only gate run.
 */
function writeOmoConfig(sandbox, recallEnabled) {
  writeFileSync(join(sandbox.cwd, ".omo", "omo.json"), `${JSON.stringify({
    categories: { quick: { description: "QA mock quick category", model: "omo-mock/mock-1" } },
    memory: {
      enabled: true,
      recall: { enabled: recallEnabled, max_items: 2 },
      reflection: { trigger: { step_count: 0, on_compaction: false } },
      facts: { enabled: false },
    },
  }, null, 2)}\n`)
}

function sandboxEnv(sandbox) {
  const env = { ...process.env }
  // resolveAgentHome checks OMO_CODING_AGENT_DIR FIRST: a caller-provided one would silently point
  // the child at the developer's real agent dir. SENPI_BIN would likewise hijack the child spawn.
  delete env.OMO_CODING_AGENT_DIR
  delete env.PI_CODING_AGENT_DIR
  delete env.SENPI_CODING_AGENT_DIR
  delete env.SENPI_BIN
  return {
    ...env,
    SENPI_CODING_AGENT_DIR: sandbox.agentDir,
    OMO_MEMORY_HOME: sandbox.memoryHome,
    HOME: sandbox.homeDir,
    USERPROFILE: sandbox.homeDir,
    XDG_CONFIG_HOME: sandbox.xdgConfigHome,
    XDG_DATA_HOME: sandbox.xdgDataHome,
    XDG_CACHE_HOME: sandbox.xdgCacheHome,
  }
}

function assertSandboxEnv(sandbox, env) {
  // Hard gate before ANY spawn: a driver that writes into the developer's real memory or agent home
  // is worse than a driver that fails.
  for (const [name, expected] of [["SENPI_CODING_AGENT_DIR", sandbox.agentDir], ["OMO_MEMORY_HOME", sandbox.memoryHome], ["HOME", sandbox.homeDir]]) {
    if (env[name] !== expected) throw new Error(`env ${name} is ${env[name]}, expected the sandbox path ${expected}`)
    if (!env[name].startsWith(sandbox.root)) throw new Error(`env ${name} escapes the sandbox root ${sandbox.root}`)
  }
  for (const name of ["OMO_CODING_AGENT_DIR", "PI_CODING_AGENT_DIR", "SENPI_BIN"]) {
    if (env[name] !== undefined) throw new Error(`env ${name} must be scrubbed before spawning`)
  }
}

// ---------------------------------------------------------------------------
// Mock provider script routing
// ---------------------------------------------------------------------------

function isJudgeRequest(body) {
  const tools = Array.isArray(body?.tools) ? body.tools : []
  const hasNudgeTool = tools.some((tool) => tool?.function?.name === NUDGE_TOOL || tool?.name === NUDGE_TOOL)
  const messages = Array.isArray(body?.messages) ? body.messages : []
  const system = messages
    .filter((message) => message?.role === "system")
    .map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? "")))
    .join("\n")
  return hasNudgeTool && system.includes(PERSONA_TITLE)
}

/**
 * The mock server keeps ONE global cursor and reads `script[cursor]`, so a body-routed script must
 * place its step at exactly that index. The driver counts requests itself (the cursor is simply the
 * number of prior requests), and pads the array so the routed step lands where the server looks.
 */
function createRouter({ judgeSteps }) {
  const state = { requests: 0, parent: 0, judge: 0, judgeBodies: [] }
  // The parent script is REPLACED between phases (seeding turn, then the two RPC turns) while the
  // server holds one long-lived reference to `steps`; the counters reset with it.
  let parentSteps = []
  const steps = (body) => {
    const cursor = state.requests
    state.requests += 1
    const judge = isJudgeRequest(body)
    let step
    if (judge) {
      state.judgeBodies.push(body)
      // A judge script shorter than the request count REPEATS its last step: senpi retries a failed
      // provider call, and an outage that heals on retry is a different scenario from the one under
      // test. Padding with a success step would silently turn S2 into S1.
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
  return { steps, state, setParentSteps }
}

// ---------------------------------------------------------------------------
// RPC session
// ---------------------------------------------------------------------------

function launchRpc(senpiCli, sandbox, env) {
  const child = spawn("bun", [senpiCli, "--mode", "rpc", "--provider", "omo-mock", "--model", "mock-1", "--session-dir", join(sandbox.agentDir, "sessions")], {
    cwd: sandbox.cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  })
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
  // A waiter subscribes from the CURRENT end of the stream: a turn must never settle on a stale
  // agent_end emitted by an earlier prompt.
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
  return {
    child,
    mark: () => events.length,
    waitFrom,
    stderr: () => stderr,
    send: (command) => { child.stdin.write(`${JSON.stringify(command)}\n`) },
  }
}

async function getState(session) {
  const from = session.mark()
  session.send({ id: `state-${from}`, type: "get_state" })
  const response = await session.waitFrom(from, (event) => event.type === "response" && event.command === "get_state", TURN_TIMEOUT_MS, "get_state response")
  if (response.success !== true) throw new Error(`get_state failed: ${response.error}`)
  return response.data
}

/** One prompt, correlated end to end: the agent_start that follows THIS prompt, and then ITS agent_end. */
async function prompt(session, message) {
  const from = session.mark()
  session.send({ id: `prompt-${from}`, type: "prompt", message })
  const start = await session.waitFrom(from, (event) => event.type === "agent_start", TURN_TIMEOUT_MS, "agent_start")
  const startIndex = session.mark()
  await session.waitFrom(startIndex - 1, (event) => event.type === "agent_end", TURN_TIMEOUT_MS, "agent_end")
  return start
}

async function teardown(session) {
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

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise((resolvePromise) => {
    const timer = setTimeout(() => {
      child.removeListener("exit", onExit)
      resolvePromise(false)
    }, timeoutMs)
    const onExit = () => { clearTimeout(timer); resolvePromise(true) }
    child.once("exit", onExit)
  })
}

// ---------------------------------------------------------------------------
// Sandbox state readers
// ---------------------------------------------------------------------------

function readEntries(sessionFile) {
  if (!existsSync(sessionFile)) return []
  return readFileSync(sessionFile, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => { try { return [JSON.parse(line)] } catch { return [] } })
}

function identityDirs(memoryHome) {
  const agents = join(memoryHome, "agents")
  if (!existsSync(agents)) return []
  return readdirSync(agents).map((name) => join(agents, name))
}

function recallRuns(memoryHome) {
  const runs = []
  for (const identity of identityDirs(memoryHome)) {
    const dir = join(identity, "runtime", "recall", "runs")
    if (!existsSync(dir)) continue
    for (const runId of readdirSync(dir)) runs.push({ runId, dir: join(dir, runId) })
  }
  return runs
}

function pendingFiles(memoryHome, sessionId) {
  const found = []
  for (const identity of identityDirs(memoryHome)) {
    const path = join(identity, "runtime", "recall", "pending", `${sessionId}.json`)
    if (existsSync(path)) found.push(path)
  }
  return found
}

function childTranscript(runDir) {
  if (!existsSync(runDir)) return undefined
  const file = readdirSync(runDir).find((name) => name.endsWith(".jsonl"))
  if (file === undefined) return undefined
  const messages = readEntries(join(runDir, file)).filter((entry) => entry.type === "message")
  return { path: join(runDir, file), messages }
}

function lastAssistant(messages) {
  return [...messages].reverse().find((entry) => entry.message?.role === "assistant")?.message
}

/**
 * Bounded, event-free polling: the judge is a detached task, so the only honest signal that it
 * finished is the state it writes (pending nudges, a gate entry, or a completed run transcript).
 * Never a fixed sleep - the wait resolves the instant the condition holds.
 */
function waitUntil(predicate, { timeoutMs, description }) {
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

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

const SEED_STEPS = [
  { type: "tool_call", name: "memory", arguments: { command: "create", file_path: SEED_PATH, description: SEED_DESCRIPTION, file_text: SEED_BODY, reason: "seed the recall corpus for the memorian gate proof" } },
  { type: "text", text: "memory seeded" },
]

async function seedMemoryRepo(options, sandbox, env, router) {
  writeOmoConfig(sandbox, false)
  router.setParentSteps(SEED_STEPS)
  // The seed prompt deliberately avoids the note's own words: with recall disabled for this turn it
  // cannot spawn a judge anyway, and keeping the two prompts distinct makes the scenario's single
  // gate run unambiguous.
  const seed = spawn("bun", [options.senpiCli, "-p", "--mode", "json", "--provider", "omo-mock", "--model", "mock-1", "--session-dir", join(sandbox.agentDir, "sessions"), `Write down this operational rule: ${SEED_BODY}`], {
    cwd: sandbox.cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  })
  let stderr = ""
  seed.stderr.on("data", (chunk) => { stderr += chunk.toString() })
  const status = await new Promise((resolvePromise) => seed.once("exit", (code) => resolvePromise(code)))
  return { status, stderr }
}

function scenarioSteps(kind) {
  const parentSteps = [
    { type: "text", text: "Checking." },
    { type: "text", text: "Done." },
  ]
  // S1's second step is the REAL judge shape: an empty final text after the tool call. S2's single
  // step repeats (see createRouter), so the outage survives senpi's retry ladder.
  const judgeSteps = kind === "s1"
    ? [
      { type: "tool_call", name: NUDGE_TOOL, arguments: { path: SEED_PATH, hint: SEED_BODY } },
      { type: "text", text: "" },
    ]
    : [{ type: "error", status: 500, body: { error: { message: "mock judge outage\nline2" } } }]
  return { parentSteps, judgeSteps }
}

async function runScenario(kind, options) {
  const cleanup = []
  const { parentSteps, judgeSteps } = scenarioSteps(kind)
  const router = createRouter({ judgeSteps })
  const server = startMockCompletionsServer({ steps: router.steps })
  const baseUrl = await server.ready
  const sandbox = prepareSandbox(options.pluginRoot, baseUrl)
  const env = sandboxEnv(sandbox)
  assertSandboxEnv(sandbox, env)
  record(`${kind}.sandbox-isolated`, true, `agentDir=${sandbox.agentDir} memoryHome=${sandbox.memoryHome}`)

  let session
  const facts = { scenario: kind, baseUrl, sandboxRoot: sandbox.root }
  try {
    const seed = await seedMemoryRepo(options, sandbox, env, router)
    if (seed.status !== 0) {
      record(`${kind}.memory-seeded`, false, `seed turn exited ${seed.status}: ${seed.stderr.slice(-400)}`)
      return facts
    }
    const seeded = identityDirs(sandbox.memoryHome).map((dir) => join(dir, "repo", SEED_PATH)).filter(existsSync)
    record(`${kind}.memory-seeded`, seeded.length === 1, seeded[0] ?? `no ${SEED_PATH} under ${sandbox.memoryHome}`)
    if (seeded.length !== 1) return facts
    // The scenario's assertions read "the" gate run; a seed-turn run would make them read the wrong one.
    const seedRuns = recallRuns(sandbox.memoryHome)
    record(`${kind}.seed-turn-gate-quiet`, seedRuns.length === 0 && router.state.judge === 0, `runs=${seedRuns.length} judgeRequests=${router.state.judge}`)
    if (seedRuns.length !== 0 || router.state.judge !== 0) return facts

    writeOmoConfig(sandbox, true)
    router.setParentSteps(parentSteps)
    session = launchRpc(options.senpiCli, sandbox, env)
    const state = await getState(session)
    const sessionFile = state.sessionFile
    facts.sessionId = state.sessionId
    facts.sessionFile = sessionFile
    record(`${kind}.session-identified`, typeof sessionFile === "string" && sessionFile.length > 0, `sessionId=${state.sessionId} sessionFile=${sessionFile}`)
    if (typeof sessionFile !== "string") return facts

    await prompt(session, TURN_1_PROMPT)

    // The gate is a detached task started at settle; the honest completion signal is the VERDICT it
    // leaves behind - the pending nudges a successful run writes, or the gate entry a failed one
    // appends. A run directory alone is not a settled judge (it is created before the child speaks),
    // so waiting on it would race the write this scenario asserts.
    const judgeSettled = await waitUntil(
      () => {
        const gate = readEntries(sessionFile).filter((entry) => entry.customType === "omo-memorian:gate")
        if (gate.length > 0) return { gate: gate.map((entry) => entry.data?.status) }
        if (kind === "s1") {
          const pending = pendingFiles(sandbox.memoryHome, state.sessionId)
          if (pending.length > 0) return { pending }
        }
        return undefined
      },
      { timeoutMs: JUDGE_TIMEOUT_MS, description: `${kind} judge verdict (pending nudges or a gate entry)` },
    ).catch((error) => ({ error: error.message }))
    if (judgeSettled.error !== undefined) {
      // The judge is detached: when it never reports, its stderr and the run tree are the only
      // evidence of where it stopped, and a bare timeout would hide both.
      const runs = recallRuns(sandbox.memoryHome).map((run) => run.runId)
      record(`${kind}.judge-settled`, false, `${judgeSettled.error}; runs=[${runs.join(",")}]; stderr=${session.stderr().slice(-1200).replace(/\n/g, " | ")}`)
      return facts
    }
    record(`${kind}.judge-settled`, true, JSON.stringify(judgeSettled))

    await prompt(session, TURN_2_PROMPT)
    const entries = readEntries(sessionFile)
    facts.judgeRequests = router.state.judge
    if (kind === "s1") assertS1(entries, sandbox, state, facts, router)
    else assertS2(entries, sandbox, state, facts)
  } finally {
    if (session !== undefined) cleanup.push(await teardown(session))
    server.close()
    cleanup.push("server closed")
    if (options.keepSandbox) cleanup.push(`sandbox KEPT: ${sandbox.root}`)
    else {
      rmSync(sandbox.root, { recursive: true, force: true })
      cleanup.push(existsSync(sandbox.root) ? `sandbox NOT removed: ${sandbox.root}` : "sandbox removed")
    }
    console.log(`cleanup: ${cleanup.join(", ")}`)
    facts.cleanup = cleanup
  }
  return facts
}

function assertS1(entries, sandbox, state, facts, router) {
  const nudged = entries.filter((entry) => entry.type === "custom" && entry.customType === "omo-memorian:nudged")
  const firstPath = nudged[0]?.data?.nudges?.[0]?.path
  record("s1.nudged-entry", nudged.length >= 1 && firstPath === SEED_PATH, `count=${nudged.length} path=${firstPath ?? "none"}`)

  const recall = entries.filter((entry) => entry.type === "custom_message" && entry.customType === "omo-memorian:recall")
  record("s1.recall-injected", recall.length >= 1, `count=${recall.length}`)

  const failedGate = entries.filter((entry) => entry.customType === "omo-memorian:gate" && entry.data?.status === "failed")
  record("s1.no-failed-gate", failedGate.length === 0, failedGate.length === 0 ? "no failed gate entry" : failedGate.map((entry) => JSON.stringify(entry.data)).join(" | "))

  const runs = recallRuns(sandbox.memoryHome)
  const run = runs[0]
  const transcript = run === undefined ? undefined : childTranscript(run.dir)
  const stopReason = transcript === undefined ? undefined : lastAssistant(transcript.messages)?.stopReason
  const hasCandidates = run !== undefined && existsSync(join(run.dir, "candidates.json"))
  record("s1.run-dir-artifacts", runs.length === 1 && hasCandidates && transcript !== undefined && stopReason === "stop", `runs=${runs.length} candidates=${hasCandidates} stopReason=${stopReason ?? "none"}`)
  facts.runId = run?.runId
  facts.childStopReason = stopReason

  record("s1.judge-request-count", router.state.judge === 2, `judgeRequests=${router.state.judge}`)
}

function assertS2(entries, sandbox, state, facts) {
  const gate = entries.filter((entry) => entry.customType === "omo-memorian:gate" && entry.data?.status === "failed")
  const data = gate[0]?.data
  facts.gate = data
  const reasonOk = typeof data?.reason === "string" && data.reason.length <= 160 && !data.reason.includes("\n")
  record("s2.gate-child-failed", gate.length === 1 && data?.cause === "child_failed", `count=${gate.length} cause=${data?.cause ?? "none"}`)
  record("s2.gate-reason-sanitized", reasonOk, `reason=${JSON.stringify(data?.reason ?? null)} length=${data?.reason?.length ?? 0}`)
  record("s2.gate-run-id", typeof data?.runId === "string" && /^[0-9a-f-]{36}$/.test(data.runId), `runId=${data?.runId ?? "none"}`)
  facts.runId = data?.runId

  const nudged = entries.filter((entry) => entry.customType === "omo-memorian:nudged")
  record("s2.no-nudged-entry", nudged.length === 0, `count=${nudged.length}`)

  const pending = pendingFiles(sandbox.memoryHome, state.sessionId)
  record("s2.no-pending-file", pending.length === 0, pending.length === 0 ? "no pending nudges" : pending.join(","))
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (!existsSync(options.senpiCli)) throw new Error(`senpi cli not found at ${options.senpiCli}`)
  if (!existsSync(join(options.pluginRoot, "extensions"))) throw new Error(`plugin bundle not built at ${options.pluginRoot}/extensions`)
  console.log(`plugin-root: ${options.pluginRoot}`)
  console.log(`senpi-cli: ${options.senpiCli}`)
  console.log(`scenario: ${options.scenario}`)

  const scenarios = options.scenario === "all" ? ["s1", "s2"] : [options.scenario]
  const facts = []
  for (const kind of scenarios) facts.push(await runScenario(kind, options))

  const failures = checks.filter((check) => !check.ok)
  const payload = { ok: failures.length === 0, scenarios, checks, facts }
  if (options.evidenceDir !== undefined) {
    mkdirSync(options.evidenceDir, { recursive: true })
    writeFileSync(join(options.evidenceDir, "memorian-gate-e2e.json"), `${JSON.stringify(payload, null, 2)}\n`)
    console.log(`evidence: ${join(options.evidenceDir, "memorian-gate-e2e.json")}`)
  }
  console.log(JSON.stringify({ ok: payload.ok, total: checks.length, failures: failures.map((check) => check.name) }, null, 2))
  process.exit(failures.length === 0 ? 0 : 1)
}

function runSelfTest() {
  const judgeBody = { tools: [{ type: "function", function: { name: NUDGE_TOOL } }], messages: [{ role: "system", content: "# Memorian — memory nudge agent" }] }
  if (!isJudgeRequest(judgeBody)) throw new Error("self-test: a nudge-tool + persona request must route to the judge")
  if (isJudgeRequest({ tools: [{ type: "function", function: { name: "read" } }], messages: [{ role: "system", content: "# Memorian" }] })) {
    throw new Error("self-test: a request without the nudge tool must route to the parent")
  }
  if (isJudgeRequest({ tools: [{ type: "function", function: { name: NUDGE_TOOL } }], messages: [{ role: "system", content: "you are a helpful agent" }] })) {
    throw new Error("self-test: a nudge tool without the persona must route to the parent")
  }

  const router = createRouter({ judgeSteps: [{ type: "tool_call", name: NUDGE_TOOL }] })
  router.setParentSteps([{ type: "text", text: "p1" }, { type: "text", text: "p2" }])
  const first = router.steps({ messages: [] })
  if (first[0]?.text !== "p1") throw new Error("self-test: the first request must read the first parent step at cursor 0")
  const second = router.steps(judgeBody)
  if (second.length !== 2 || second[1]?.name !== NUDGE_TOOL) throw new Error("self-test: a routed step must land at the server's global cursor")
  const third = router.steps({ messages: [] })
  if (third.length !== 3 || third[2]?.text !== "p2") throw new Error("self-test: parent and judge counters must advance independently")
  if (router.state.judge !== 1 || router.state.parent !== 2) throw new Error("self-test: request counters are wrong")
  const retried = router.steps(judgeBody)
  if (retried[3]?.name !== NUDGE_TOOL) throw new Error("self-test: an exhausted judge script must repeat its last step, never fall back to a success text")

  const sandbox = { root: "/tmp/x", agentDir: "/tmp/x/agent", memoryHome: "/tmp/x/memory", homeDir: "/tmp/x/home" }
  assertSandboxEnv(sandbox, { SENPI_CODING_AGENT_DIR: "/tmp/x/agent", OMO_MEMORY_HOME: "/tmp/x/memory", HOME: "/tmp/x/home" })
  let escaped = false
  try { assertSandboxEnv(sandbox, { SENPI_CODING_AGENT_DIR: `${process.env.HOME}/.omo/agent`, OMO_MEMORY_HOME: "/tmp/x/memory", HOME: "/tmp/x/home" }) }
  catch { escaped = true }
  if (!escaped) throw new Error("self-test: a real agent dir must fail the sandbox assertion")
  let leaked = false
  try { assertSandboxEnv(sandbox, { SENPI_CODING_AGENT_DIR: "/tmp/x/agent", OMO_MEMORY_HOME: "/tmp/x/memory", HOME: "/tmp/x/home", OMO_CODING_AGENT_DIR: "/real" }) }
  catch { leaked = true }
  if (!leaked) throw new Error("self-test: an unscrubbed OMO_CODING_AGENT_DIR must fail the sandbox assertion")

  console.log("SELF-TEST OK")
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) runSelfTest()
  else await main()
}

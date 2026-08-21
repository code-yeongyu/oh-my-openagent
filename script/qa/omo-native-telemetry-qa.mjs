#!/usr/bin/env bun
import { spawn, spawnSync } from "node:child_process"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, delimiter, dirname, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import {
  KNOWN_MODELS,
  KNOWN_PROVIDERS,
  OMO_NATIVE_PROPERTY_ALLOWLISTS,
} from "../../packages/omo-senpi/src/components/telemetry/product-identity.ts"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "..", "..")
const pluginRoot = join(repoRoot, "packages", "omo-senpi", "plugin")
const goalExtension = join(repoRoot, "packages", "pi-goal", "src", "index.ts")
const defaultEvidenceDir = join(repoRoot, ".omo", "evidence", "20260810-omo-native-telemetry")
const expectedNativeEvents = new Set([
  "daily_active",
  "session_started",
  "prompt_submitted",
  "turn_completed",
  "skill_loaded",
  "delegation_started",
  "delegation_completed",
  "category_config",
  "feature_used",
  "parallelism_summary",
])

export function assertAllowlistCoverage(allowlists) {
  const actual = new Set(Object.keys(allowlists))
  const missing = [...expectedNativeEvents].filter((name) => !actual.has(name)).sort()
  const extra = [...actual].filter((name) => !expectedNativeEvents.has(name)).sort()
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`OmO Native QA allowlist event coverage diverged: missing=${missing.join(",") || "none"}; extra=${extra.join(",") || "none"}`)
  }
}

assertAllowlistCoverage(OMO_NATIVE_PROPERTY_ALLOWLISTS)
const nativeEvents = new Set(Object.keys(OMO_NATIVE_PROPERTY_ALLOWLISTS))
const sharedKeys = new Set(["$process_person_profile", "package_version", "platform", "product_name", "schema_version"])
const sdkAddedKeys = new Set(["$lib", "$lib_version", "$geoip_disable"])
const sdkWireKeys = new Set(["distinct_id", "uuid"])
const knownModels = new Set(Object.values(KNOWN_MODELS).flat())
const knownProviders = new Set(KNOWN_PROVIDERS)
const prompts = [
  "ulw plan: list the repo top-level files by delegating one quick task, and track it with a goal",
  "Read one packaged builtin SKILL.md and summarize its purpose briefly.",
  "Reply with a short confirmation that this telemetry QA control prompt completed.",
]
const helpText = `omo-native-telemetry-qa

Usage:
  bun script/qa/omo-native-telemetry-qa.mjs [--evidence-dir <dir>] [--senpi-bin <path>]

Runs a real isolated Senpi CLI against a local PostHog capture server, writes redacted evidence,
and exits non-zero unless the enabled drive, both opt-out drives, privacy scans, and cleanup pass.
`

function parseArgs(argv) {
  const args = { evidenceDir: defaultEvidenceDir }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--help" || arg === "-h") return { ...args, help: true }
    const next = argv[index + 1]
    if (next === undefined) throw new Error(`missing value for ${arg}`)
    index += 1
    if (arg === "--evidence-dir") args.evidenceDir = resolve(next)
    else if (arg === "--senpi-bin") args.senpiBin = resolve(next)
    else throw new Error(`unknown argument: ${arg}`)
  }
  return args
}

function findExecutable(name) {
  if (name.includes("/")) return existsSync(name) ? resolve(name) : null
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = resolve(directory || ".", name)
    if (existsSync(candidate)) return candidate
  }
  const workspaceCandidate = join(repoRoot, "node_modules", ".bin", name)
  return existsSync(workspaceCandidate) ? workspaceCandidate : null
}

function runHelp(senpiBin) {
  const result = spawnSync(senpiBin, ["--help"], { cwd: repoRoot, encoding: "utf8", timeout: 30_000 })
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`
  if (result.status !== 0) throw new Error(`senpi --help failed with exit ${result.status}\n${output}`)
  if (!/(?:--print, -p|--print\b[\s\S]*\b-p\b)/.test(output)) {
    const error = new Error("installed Senpi help does not expose a non-interactive print flag")
    error.name = "BlockedClaim"
    error.helpOutput = output
    throw error
  }
  return output
}

async function startCaptureServer() {
  const root = mkdtempSync(join(tmpdir(), "omo-native-telemetry-capture-"))
  const capturePath = join(root, "requests.jsonl")
  const serverPath = join(root, "server.mjs")
  writeFileSync(serverPath, `import { appendFileSync } from "node:fs"\nconst capturePath = process.argv[2]\nconst server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) { const encoded = new Uint8Array(await request.arrayBuffer()); const encoding = request.headers.get("content-encoding"); const decoded = encoding === "gzip" ? Bun.gunzipSync(encoded) : encoding === "deflate" ? Bun.inflateSync(encoded) : encoded; const raw = new TextDecoder().decode(decoded); if (request.method === "POST") appendFileSync(capturePath, JSON.stringify({ method: request.method, path: new URL(request.url).pathname, raw }) + "\\n"); return Response.json({ status: "ok" }) } })\nconsole.log(JSON.stringify({ pid: process.pid, port: server.port }))\n`)
  const bunBin = findExecutable("bun")
  if (bunBin === null) throw new Error("Bun executable is required for the capture server")
  const child = spawn(bunBin, [serverPath, capturePath], { stdio: ["ignore", "pipe", "pipe"] })
  let stdout = ""
  let stderr = ""
  const started = await new Promise((resolveStart, rejectStart) => {
    const timeout = setTimeout(() => rejectStart(new Error(`capture server startup timed out: ${stderr}`)), 10_000)
    child.once("error", rejectStart)
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8") })
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8")
      const newline = stdout.indexOf("\n")
      if (newline === -1) return
      clearTimeout(timeout)
      try { resolveStart(JSON.parse(stdout.slice(0, newline))) } catch (error) { rejectStart(error) }
    })
    child.once("exit", (code) => rejectStart(new Error(`capture server exited before startup with ${code}: ${stderr}`)))
  })
  if (!isRecord(started) || typeof started.port !== "number" || typeof started.pid !== "number") throw new Error("capture server startup receipt was invalid")
  return { child, capturePath, root, port: started.port, pid: started.pid, stderr: () => stderr }
}

function readCaptureRequests(capture) {
  if (!existsSync(capture.capturePath)) return []
  return readFileSync(capture.capturePath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
}

function createSandbox(label, configEnabled) {
  const root = mkdtempSync(join(tmpdir(), `omo-native-telemetry-${label}-`))
  const cwd = join(root, "project")
  const agentDir = join(root, "agent")
  const sessionDir = join(root, "sessions")
  const xdgConfigHome = join(root, "xdg")
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
  return { root, cwd, agentDir, sessionDir, xdgConfigHome, providerPath }
}

function mockProviderSource() {
  return `const model = { id: "gpt-5.6-sol", name: "GPT 5.6 Sol QA", reasoning: false, input: ["text"], cost: { input: 0.000001, output: 0.000002, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 4096 }
const PROMPT_A = ${JSON.stringify(prompts[0])}
const PROMPT_B = ${JSON.stringify(prompts[1])}
const PROMPT_C = ${JSON.stringify(prompts[2])}
const CHILD = "List the repository top-level entries and report them briefly."
export default function register(pi) {
  pi.registerProvider("openai", { name: "OpenAI local telemetry QA", baseUrl: "file://telemetry-qa", apiKey: "mock", api: "openai-completions", models: [model], streamSimple(_model, context, options) { return stream(stepFor(context), options) } })
}
function stepFor(context) {
  const messages = Array.isArray(context?.messages) ? context.messages : []
  const joined = JSON.stringify(messages)
  const promptAIndex = joined.lastIndexOf(PROMPT_A)
  const promptBIndex = joined.lastIndexOf(PROMPT_B)
  const promptCIndex = joined.lastIndexOf(PROMPT_C)
  const latestPromptIndex = Math.max(promptAIndex, promptBIndex, promptCIndex)
  if (latestPromptIndex === -1 && joined.includes(CHILD)) return { type: "text", text: "Child listed the repository entries." }
  if (promptAIndex === latestPromptIndex) {
    const toolNames = messages.flatMap((message) => message?.role === "assistant" && Array.isArray(message.content) ? message.content.filter((item) => item?.type === "toolCall").map((item) => item.name) : [])
    if (!toolNames.includes("create_goal")) return { type: "tool_call", name: "create_goal", arguments: { objective: "List repository entries with one delegated quick task and keep the run tracked by a goal." } }
    if (!toolNames.includes("task")) return { type: "tool_call", name: "task", arguments: { category: "quick", prompt: CHILD, run_in_background: true, name: "telemetry-qa-child" } }
    if (!toolNames.includes("update_goal")) return { type: "tool_call", name: "update_goal", arguments: { status: "complete" } }
    return { type: "text", text: "The goal and delegated listing task were started and the requested tracking goal was completed." }
  }
  if (promptBIndex === latestPromptIndex) {
    const readUsed = messages.some((message) => message?.role === "assistant" && Array.isArray(message.content) && message.content.some((item) => item?.type === "toolCall" && item.name === "read"))
    if (!readUsed) return { type: "tool_call", name: "read", arguments: { path: ${JSON.stringify(join(pluginRoot, "skills", "debugging", "SKILL.md"))} } }
    return { type: "text", text: "The builtin debugging skill describes a disciplined debugging workflow." }
  }
  if (promptCIndex === latestPromptIndex) return { type: "text", text: "Telemetry QA control prompt completed." }
  return { type: "text", text: "Local QA child completed." }
}
function message(step, callCount) {
  const content = step.type === "text" ? [{ type: "text", text: step.text }] : [{ type: "toolCall", id: "telemetry-qa-tool-" + callCount, name: step.name, arguments: step.arguments }]
  return { role: "assistant", content, api: "openai-completions", provider: "openai", model: "gpt-5.6-sol", usage: { input: 12, output: 8, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 20, cost: { input: 0.000012, output: 0.000016, cacheRead: 0, cacheWrite: 0, total: 0.000028 } }, stopReason: step.type === "tool_call" ? "toolUse" : "stop", timestamp: Date.now() }
}
let calls = 0
function stream(step, options) {
  const queue = []; const waiters = []; let done = false; let resolveResult; let rejectResult
  const result = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject }); result.catch(() => {})
  const output = { push(event) { if (done) return; const waiter = waiters.shift(); if (waiter) waiter({ value: event, done: false }); else queue.push(event) }, end(final) { if (done) return; done = true; resolveResult(final); while (waiters.length) waiters.shift()({ value: undefined, done: true }) }, fail(error) { if (done) return; done = true; rejectResult(error); while (waiters.length) waiters.shift()({ value: undefined, done: true }) }, result() { return result }, [Symbol.asyncIterator]() { return { next() { if (queue.length) return Promise.resolve({ value: queue.shift(), done: false }); if (done) return Promise.resolve({ value: undefined, done: true }); return new Promise((resolve) => waiters.push(resolve)) } } } }
  calls += 1; const final = message(step, calls)
  queueMicrotask(() => { if (options?.signal?.aborted) { output.end({ ...final, stopReason: "aborted" }); return } output.push({ type: "start", partial: { ...final, content: [] } }); if (step.type === "text") { output.push({ type: "text_start", contentIndex: 0, partial: { ...final, content: [{ type: "text", text: "" }] } }); output.push({ type: "text_delta", contentIndex: 0, delta: step.text, partial: final }); output.push({ type: "text_end", contentIndex: 0, content: step.text, partial: final }) } else { const toolCall = final.content[0]; output.push({ type: "toolcall_start", contentIndex: 0, partial: { ...final, content: [] } }); output.push({ type: "toolcall_delta", contentIndex: 0, delta: JSON.stringify(step.arguments), partial: final }); output.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: final }) } output.push({ type: "done", reason: final.stopReason, message: final }); output.end(final) })
  return output
}
`
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

async function driveCli({ senpiBin, port, label, configEnabled = true, extraEnv = {} }) {
  const sandbox = createSandbox(label, configEnabled)
  const commandArgs = [
    "--mode", "rpc", "--offline", "--approve", "--no-context-files", "--session-dir", sandbox.sessionDir,
    "-e", sandbox.providerPath, "-e", goalExtension, "--provider", "openai", "--model", "gpt-5.6-sol",
  ]
  const child = spawn(senpiBin, commandArgs, {
    cwd: sandbox.cwd,
    env: cleanEnvironment(sandbox, port, extraEnv),
    stdio: ["pipe", "pipe", "pipe"],
  })
  const transcript = []
  let stdoutBuffer = ""
  let stderr = ""
  let agentEndCount = 0
  let settled = false
  let timeoutHandle
  const completed = new Promise((resolveRun, rejectRun) => {
    timeoutHandle = setTimeout(() => rejectRun(new Error(`${label} Senpi RPC drive timed out after 120000ms`)), 120_000)
    child.on("error", rejectRun)
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8") })
    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString("utf8")
      let newline = stdoutBuffer.indexOf("\n")
      while (newline !== -1) {
        const line = stdoutBuffer.slice(0, newline)
        stdoutBuffer = stdoutBuffer.slice(newline + 1)
        if (line.trim() !== "") {
          transcript.push(line)
          let event
          try { event = JSON.parse(line) } catch { event = undefined }
          if (event?.type === "agent_end") {
            agentEndCount += 1
            if (agentEndCount < prompts.length) {
              child.stdin.write(`${JSON.stringify({ type: "prompt", message: prompts[agentEndCount] })}\n`)
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
      if (code === 0 && agentEndCount === prompts.length) resolveRun({ code, signal })
      else rejectRun(new Error(`${label} Senpi RPC exited code=${code} signal=${signal} agent_end=${agentEndCount}\n${stderr.slice(-4000)}`))
    })
    child.stdin.write(`${JSON.stringify({ type: "prompt", message: prompts[0] })}\n`)
  })
  try {
    const result = await completed
    return { sandbox, commandArgs, transcript, stderr, agentEndCount, pid: child.pid, result }
  } catch (error) {
    if (child.exitCode === null) child.kill("SIGTERM")
    throw error
  }
}

function parseCapturedEvents(requests) {
  const events = []
  for (const request of requests) {
    let body
    try { body = JSON.parse(request.raw) } catch { continue }
    collectEvents(body, request.path, events)
  }
  return events
}

function collectEvents(value, path, output) {
  if (Array.isArray(value)) {
    for (const item of value) collectEvents(item, path, output)
    return
  }
  if (!isRecord(value)) return
  if (typeof value.event === "string" && isRecord(value.properties)) {
    output.push({ event: value.event, properties: value.properties, timestamp: value.timestamp, distinct_id: value.distinct_id, path })
  }
  if (Array.isArray(value.batch)) collectEvents(value.batch, path, output)
}

function assertEnabled(events) {
  const checks = []
  const check = (name, condition, detail) => {
    if (!condition) throw new Error(`${name}: ${detail}`)
    checks.push({ name, result: "PASS", detail })
  }
  const native = events.filter((event) => nativeEvents.has(event.event))
  const realPrompts = native.filter((event) => event.event === "prompt_submitted" && event.properties.is_real_user_prompt === true)
  check("exactly-three-real-prompts", realPrompts.length === 3, `observed ${realPrompts.length}; events=${events.map((event) => event.event).join(",")}`)
  const first = realPrompts.find((event) => event.properties.real_prompt_ordinal_bucket === "1")
  check("first-prompt-ulw-classification", first !== undefined && first.properties.is_effective_ultrawork_invocation === true && first.properties.keyword_variant === "ulw" && first.properties.keyword_occurrence_bucket === "1" && first.properties.invocation_stage === "first_arm", JSON.stringify(first?.properties ?? null))
  const controls = realPrompts.filter((event) => event !== first)
  check("two-keyword-negative-controls", controls.length === 2 && controls.every((event) => event.properties.keyword_any === false), controls.map((event) => JSON.stringify(event.properties)).join(" | "))
  for (const name of nativeEvents) check(`event-present-${name}`, native.some((event) => event.event === name), `captured ${name}`)
  check("turn-completed-positive-tokens", native.some((event) => event.event === "turn_completed" && Number(event.properties.total_tokens) > 0), "at least one turn_completed has total_tokens > 0")
  check("feature-goal-tool", native.some((event) => event.event === "feature_used" && event.properties.feature === "goal_tool"), "captured feature_used goal_tool")
  check("legacy-dual-emit-presence-only", events.some((event) => event.event === "omo_senpi_daily_active"), "legacy event present and excluded from all scans")
  privacyScan(native, checks)
  return checks
}

function privacyScan(events, checks) {
  const addPass = (name, detail) => checks.push({ name, result: "PASS", detail })
  for (const event of events) {
    const allowed = new Set([...OMO_NATIVE_PROPERTY_ALLOWLISTS[event.event], ...sharedKeys, ...sdkAddedKeys, ...sdkWireKeys])
    for (const key of Object.keys(event.properties)) {
      if (!allowed.has(key)) throw new Error(`property-allowlist: ${event.event}.${key} is not documented or SDK-added`)
      if (key.startsWith("$") && !OMO_NATIVE_PROPERTY_ALLOWLISTS[event.event].includes(key) && !sharedKeys.has(key) && !sdkAddedKeys.has(key)) {
        throw new Error(`dollar-property-allowlist: ${event.event}.${key} is not permitted`)
      }
    }
    for (const [key, value] of walkValues(event.properties)) {
      if (typeof value !== "string") continue
      if (key === "model_id" || key === "default_model") {
        if (value !== "custom" && !knownModels.has(value)) throw new Error(`known-model-allowlist: ${key}=${value}`)
        continue
      }
      if (key === "provider" || key === "default_provider") {
        if (value !== "custom" && !knownProviders.has(value)) throw new Error(`known-provider-allowlist: ${key}=${value}`)
        continue
      }
      if (key === "providers") {
        const providers = value === "" ? [] : value.split(",")
        if (providers.some((provider) => !knownProviders.has(provider))) throw new Error(`known-provider-allowlist: ${key}=${value}`)
        continue
      }
      if (/(^|\s)(\/|~\/|[A-Za-z]:\\)/.test(value)) throw new Error(`path-privacy: ${event.event}.${key}=${value}`)
      for (const prompt of prompts) {
        for (const fragment of promptFragments(prompt)) {
          if (value.toLowerCase().includes(fragment)) throw new Error(`prompt-fragment-privacy: ${event.event}.${key} contains ${JSON.stringify(fragment)}`)
        }
      }
    }
  }
  addPass("native-event-property-allowlists", `all ${events.length} OmO Native events use documented or SDK-added keys`)
  addPass("native-event-path-privacy", "no scanned value contains an absolute/home path pattern; model fields use known-model or custom masking")
  addPass("native-event-prompt-fragment-privacy", "no scanned value contains any 8+ character driven-prompt substring")
  addPass("legacy-event-scan-exclusion", "omo_senpi_daily_active was presence-checked only")
}

function promptFragments(prompt) {
  const normalized = prompt.toLowerCase()
  const fragments = new Set()
  for (let index = 0; index <= normalized.length - 8; index += 1) fragments.add(normalized.slice(index, index + 8))
  return fragments
}

function* walkValues(value, key = "") {
  if (Array.isArray(value)) {
    for (const item of value) yield* walkValues(item, key)
    return
  }
  if (isRecord(value)) {
    for (const [childKey, child] of Object.entries(value)) yield* walkValues(child, childKey)
    return
  }
  yield [key, value]
}

function redactEvents(events) {
  const distinctIds = new Set()
  const sessionHashes = new Set()
  for (const event of events) {
    const distinctId = event.distinct_id ?? event.properties.distinct_id
    if (typeof distinctId === "string") distinctIds.add(distinctId)
    const sessionHash = event.properties.$session_id
    if (typeof sessionHash === "string") sessionHashes.add(sessionHash)
  }
  const replace = (value) => {
    if (typeof value === "string") {
      if (distinctIds.has(value)) return "<redacted-distinct-id>"
      if (sessionHashes.has(value)) return "<redacted-session-hash>"
      return value
    }
    if (Array.isArray(value)) return value.map(replace)
    if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replace(child)]))
    return value
  }
  return events.map(replace)
}

function sanitizeTranscript(text, sandboxes) {
  let sanitized = text
  for (const sandbox of sandboxes) sanitized = sanitized.replaceAll(sandbox.root, `<temp-${basename(sandbox.root).split("-").at(-2) ?? "sandbox"}>`)
  sanitized = sanitized.replaceAll(repoRoot, "<repo-root>")
  sanitized = sanitized.replaceAll(pluginRoot, "<plugin-root>")
  return sanitized
}

async function closeCaptureServer(capture) {
  if (capture.child.exitCode === null) capture.child.kill("SIGTERM")
  await new Promise((resolveExit) => {
    if (capture.child.exitCode !== null) { resolveExit(); return }
    const timeout = setTimeout(() => { capture.child.kill("SIGKILL"); resolveExit() }, 5_000)
    capture.child.once("exit", () => { clearTimeout(timeout); resolveExit() })
  })
  let killZeroFails = false
  try { process.kill(capture.pid, 0) } catch { killZeroFails = true }
  const portProbe = spawnSync("lsof", ["-nP", `-iTCP:${capture.port}`, "-sTCP:LISTEN"], { encoding: "utf8" })
  return {
    serverPid: capture.pid,
    killZeroFails,
    serverListening: !killZeroFails,
    port: capture.port,
    portFree: (portProbe.stdout ?? "").trim() === "",
    lsofOutput: (portProbe.stdout ?? "").trim(),
  }
}

function removeSandboxes(sandboxes) {
  return sandboxes.map((sandbox) => {
    rmSync(sandbox.root, { recursive: true, force: true })
    return { path: `<temp-${basename(sandbox.root).split("-").at(-2) ?? "sandbox"}>`, removed: !existsSync(sandbox.root) }
  })
}

function evidenceMarkdown(input) {
  const assertionLines = input.checks.map((check) => `- PASS ${check.name}: ${redactEvidenceText(check.detail)}`).join("\n")
  return `# Task 14: OmO Native telemetry real-surface QA

## Result

PASS. The real Senpi CLI emitted all eight OmO Native events plus the unchanged legacy daily-active event, both opt-out paths emitted zero requests, and cleanup completed.

## Senpi precheck

Resolved executable: \`${input.senpiLabel}\`

\`senpi --help\` exposed \`--print, -p\`, confirming a real non-interactive surface. Full output:

\`\`\`text
${input.help.trimEnd()}
\`\`\`

## Drive mechanism

The enabled and opt-out scenarios used the real Senpi CLI in persistent \`--mode rpc\` so exactly three prompts ran in one real session and prompt ordinals remained meaningful. The executable's \`-p\` capability was prechecked first as required. Tool selection used a temporary local provider generated from the repository precedent at \`packages/omo-senpi/scripts/qa/mock-provider/index.ts\`; it deterministically issued \`create_goal\`, \`task\`, and builtin \`read\` calls. The real built plugin at \`packages/omo-senpi/plugin\` was loaded through each isolated Senpi \`settings.json\`, and \`packages/pi-goal/src/index.ts\` was loaded explicitly for the goal tool.

Isolation for every run used a fresh mktemp root containing its own \`SENPI_CODING_AGENT_DIR\`, session directory, XDG config directory, project, provider fixture, and omo.json. The developer's real \`~/.senpi\` was never configured or read by the driver.

## Assertion results

${assertionLines}
- PASS opt-out-do-not-track-zero-requests: ${input.optOutDntRequests} requests
- PASS opt-out-config-zero-requests: ${input.optOutConfigRequests} requests

All privacy, property, and path scans above were scoped strictly to: daily_active, session_started, prompt_submitted, turn_completed, skill_loaded, delegation_started, feature_used, and parallelism_summary. The legacy \`omo_senpi_daily_active\` event was asserted for presence only and was not scanned.

## Captured payloads

The complete sanitized parsed-event dump is committed in \`captured-payloads.json\`. Machine distinct ids are replaced with \`<redacted-distinct-id>\`; keyed session hashes are replaced with \`<redacted-session-hash>\`. Raw hostname and identity salt are not present.

\`\`\`json
${JSON.stringify(input.redactedEvents, null, 2)}
\`\`\`

## Opt-out runs

- \`DO_NOT_TRACK=1\`: replayed the same three real prompts through the same real CLI drive; zero new HTTP requests reached the capture server from either native or legacy telemetry.
- \`omo.json telemetry.enabled:false\`: replayed the same three real prompts through the same real CLI drive; zero new HTTP requests reached the capture server from either native or legacy telemetry.

## Cleanup receipts

- Capture server process receipt: pid ${input.cleanup.serverPid}; server listening false: ${!input.cleanup.serverListening}; kill-zero-equivalent check failed as required: ${input.cleanup.killZeroFails}.
- Port ${input.cleanup.port} free after close: ${input.cleanup.portFree}; \`lsof -nP -iTCP:${input.cleanup.port} -sTCP:LISTEN\` output was empty: ${input.cleanup.lsofOutput === ""}.
${input.tempCleanup.map((receipt) => `- Removed ${receipt.path}: ${receipt.removed}.`).join("\n")}

## Transcript

A sanitized CLI transcript and stderr summary are committed in \`transcript.txt\`. Absolute repository and temporary paths are replaced with labels.
`
}

function redactEvidenceText(value) {
  return String(value).replace(/\b[a-f0-9]{64}\b/gi, "<redacted-session-hash>")
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) { process.stdout.write(helpText); return }
  const senpiBin = args.senpiBin ?? findExecutable(process.env.SENPI_BIN?.trim() || "senpi")
  if (senpiBin === null) throw new Error("BlockedClaim: installed senpi CLI was not found on PATH or in node_modules/.bin")
  const help = runHelp(senpiBin)
  if (!existsSync(join(pluginRoot, "extensions", "omo.js"))) throw new Error("built omo-senpi plugin is missing")
  if (!existsSync(goalExtension)) throw new Error("pi-goal extension source is missing")
  mkdirSync(args.evidenceDir, { recursive: true })

  const capture = await startCaptureServer()
  const sandboxes = []
  let cleanup
  let tempCleanup = []
  try {
    const enabledStart = readCaptureRequests(capture).length
    const enabled = await driveCli({ senpiBin, port: capture.port, label: "enabled" })
    sandboxes.push(enabled.sandbox)
    const enabledRequests = readCaptureRequests(capture).slice(enabledStart)
    const events = parseCapturedEvents(enabledRequests)
    const checks = assertEnabled(events)

    const dntStart = readCaptureRequests(capture).length
    const dnt = await driveCli({ senpiBin, port: capture.port, label: "dnt", extraEnv: { DO_NOT_TRACK: "1" } })
    sandboxes.push(dnt.sandbox)
    const optOutDntRequests = readCaptureRequests(capture).length - dntStart
    if (optOutDntRequests !== 0) throw new Error(`DO_NOT_TRACK opt-out emitted ${optOutDntRequests} requests`)

    const configStart = readCaptureRequests(capture).length
    const config = await driveCli({ senpiBin, port: capture.port, label: "config", configEnabled: false })
    sandboxes.push(config.sandbox)
    const optOutConfigRequests = readCaptureRequests(capture).length - configStart
    if (optOutConfigRequests !== 0) throw new Error(`omo.json telemetry.enabled:false emitted ${optOutConfigRequests} requests`)

    const redactedEvents = redactEvents(events)
    writeFileSync(join(args.evidenceDir, "captured-payloads.json"), `${JSON.stringify(redactedEvents, null, 2)}\n`)
    const transcript = [enabled, dnt, config].map((run) => {
      const eventTypes = new Map()
      for (const line of run.transcript) {
        try { const event = JSON.parse(line); eventTypes.set(event.type ?? "unknown", (eventTypes.get(event.type ?? "unknown") ?? 0) + 1) } catch {}
      }
      return `## ${basename(run.sandbox.root)}\nagent_end=${run.agentEndCount}\nevent_types=${JSON.stringify(Object.fromEntries(eventTypes))}\nstderr_tail=${JSON.stringify(run.stderr.slice(-2000))}`
    }).join("\n\n")
    writeFileSync(join(args.evidenceDir, "transcript.txt"), `${sanitizeTranscript(transcript, sandboxes).trimEnd()}\n`)

    cleanup = await closeCaptureServer(capture)
    tempCleanup = removeSandboxes([...sandboxes, { root: capture.root }])
    if (!cleanup.killZeroFails || !cleanup.portFree || tempCleanup.some((receipt) => !receipt.removed)) throw new Error("cleanup verification failed")
    const evidence = evidenceMarkdown({
      checks,
      cleanup,
      help,
      optOutConfigRequests,
      optOutDntRequests,
      redactedEvents,
      senpiLabel: relative(repoRoot, senpiBin) || basename(senpiBin),
      tempCleanup,
    })
    writeFileSync(join(args.evidenceDir, "task-14.md"), evidence)
    writeFileSync(join(args.evidenceDir, "cleanup-receipt.json"), `${JSON.stringify({ captureServer: cleanup, tempDirectories: tempCleanup }, null, 2)}\n`)
    process.stdout.write(`${JSON.stringify({ result: "PASS", evidenceDir: relative(repoRoot, args.evidenceDir), assertions: checks.length + 2, enabledRequests: enabledRequests.length, capturedEvents: events.length, optOutDntRequests, optOutConfigRequests, cleanup }, null, 2)}\n`)
  } finally {
    if (capture.child.exitCode === null) await closeCaptureServer(capture).catch(() => {})
    const remaining = [...sandboxes, { root: capture.root }].filter((sandbox) => existsSync(sandbox.root))
    if (remaining.length > 0) removeSandboxes(remaining)
  }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch((error) => {
    if (error?.name === "BlockedClaim") {
      process.stderr.write(`${error.name}: ${error.message}\n${error.helpOutput ?? ""}`)
      process.exit(2)
    }
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exit(1)
  })
}

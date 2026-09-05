#!/usr/bin/env bun
// allow: SIZE_OK - one auditable before/run/after flow owns PTY, evidence, isolation, and cleanup.
// Plan: explicit built-extension seed -> real PTY reflection -> historical/pending health
// sessions -> evidence export -> owned-process cleanup -> protected-state receipts.
// The model is scripted localhost HTTP; Senpi, its TUI, tools, child, and memory merge are real.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { EventEmitter } from "node:events"
import {
  appendFileSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync,
  readdirSync, readlinkSync, renameSync, rmSync, watch, writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createSandbox, seedSandbox } from "./drive.mjs"
import { changedSnapshotPaths, snapshotProtectedState } from "./isolation-state.mjs"
import { startMockCompletionsServer } from "./mock-completions-server.mjs"

const scriptPath = fileURLToPath(import.meta.url)
const repoRoot = resolve(dirname(scriptPath), "../../../..")
const pluginEntry = join(repoRoot, "packages/omo-senpi/plugin/extensions/omo.js")
const senpiCli = join(repoRoot, "node_modules/@code-yeongyu/senpi/dist/cli.js")
const MODEL = "omo-reflection-qa/mock-1"
const PARENT_MARKER = "QA_PARENT_ONLY_MEMORY_7B19C2"
const MERGED_MARKER = "QA_REFLECTION_MERGED_8A31D4"
const HEALTH_TYPE = "senpi-memory.health"
const MAX_PARENT_REQUESTS_PER_PHASE = 8
const CHILD_LAUNCH_RECEIPT = "child-launch.json"
const CHILD_EXIT_RECEIPT = "child-exit.json"

function childReceiptPaths(sessionDir) {
  // --session-dir is <identity>/runtime/reflection/runs/<runId>. The reflection runtime
  // already has a production write grant; the parent knows its runs root before launch.
  const directory = dirname(sessionDir)
  return { directory, launch: join(directory, CHILD_LAUNCH_RECEIPT), exit: join(directory, CHILD_EXIT_RECEIPT) }
}

function mockStep(model, phase, cursor, seedSteps, childSteps) {
  assert(model === "parent-1" || model === "mock-1", `unexpected model: ${model}`)
  assert(Number.isSafeInteger(cursor) && cursor >= 0, "invalid model request cursor")
  const child = model === "mock-1"
  if (child) assert.equal(phase, "trigger", `unexpected child request during ${phase}`)
  else assert(["seed", "trigger", "followup", "pending-failure"].includes(phase), `unexpected parent phase: ${phase}`)
  // Initial TUI responses can be followed by host continuation requests. Return the same terminal
  // text deterministically, but never let a runaway continuation consume an unlimited script.
  const step = child ? childSteps[cursor] : phase === "seed" ? seedSteps[cursor]
    : cursor < MAX_PARENT_REQUESTS_PER_PHASE ? { type: "text", text: "QA_PARENT_DONE" } : undefined
  assert(step, `unexpected extra ${child ? "child" : phase} model request ${cursor}`)
  return step
}

function classifyMemoryChanges(changedPaths, { identity, tokens }) {
  const attributedSandboxPaths = [], concurrentMemoryPaths = [], unclassifiedMemoryPaths = []
  for (const path of changedPaths) {
    const normalized = path.replace(/^\.\//, "")
    const owner = /^agents\/([^/]+)(?:\/|$)/.exec(normalized)?.[1]
    if (tokens.some((token) => path.includes(token)) || (identity && owner === identity)) {
      attributedSandboxPaths.push(path)
    } else if (identity && tokens.length > 0 && owner && owner !== identity) {
      // Memory is identity-scoped. A different identity's paths cannot be this sandbox's paths;
      // retain these changes as observations, not as a whole-home "untouched" claim.
      concurrentMemoryPaths.push(path)
    } else unclassifiedMemoryPaths.push(path)
  }
  return { attributedSandboxPaths, concurrentMemoryPaths, unclassifiedMemoryPaths }
}

function assessIsolation(beforeProtected, afterProtected, beforeMemory, afterMemory, scope) {
  const changedProtected = beforeProtected ? changedSnapshotPaths(beforeProtected.snapshot, afterProtected.snapshot) : []
  const changedMemory = beforeMemory && afterMemory ? changedSnapshotPaths(beforeMemory, afterMemory) : []
  const ownership = classifyMemoryChanges(changedMemory, scope)
  const realSenpiUntouched = Boolean(beforeProtected?.complete && afterProtected.complete && changedProtected.length === 0)
  const memoryNotAttributed = Boolean(beforeMemory && afterMemory && scope.identity && scope.tokens.length > 0
    && ownership.attributedSandboxPaths.length === 0 && ownership.unclassifiedMemoryPaths.length === 0)
  return { realSenpiUntouched, realMemoryUntouched: Boolean(beforeMemory && afterMemory && changedMemory.length === 0),
    memoryNotAttributed, verified: realSenpiUntouched && memoryNotAttributed,
    changedProtected, changedMemory, ...ownership, memoryScope: scope }
}

function parseArgs(argv) {
  const options = { selfTest: false, keepSandbox: false, timeoutMs: 120_000,
    evidenceSlug: `reflection-isolation-${randomUUID()}` }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--self-test") options.selfTest = true
    else if (arg === "--keep-sandbox") options.keepSandbox = true
    else if (arg === "--timeout-ms" || arg === "--evidence-slug") {
      const value = argv[++i]
      assert(value && !value.startsWith("--"), `missing value for ${arg}`)
      if (arg === "--timeout-ms") options.timeoutMs = Number(value)
      else options.evidenceSlug = value
    } else throw new Error(`unknown argument: ${arg}`)
  }
  assert(Number.isSafeInteger(options.timeoutMs) && options.timeoutMs >= 1000, "invalid timeout")
  assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(options.evidenceSlug), "invalid evidence slug")
  return options
}

function parentArgs(observer, sessionDir, print = false) {
  return [senpiCli, "--no-extensions", "-e", pluginEntry, "-e", observer,
    "--no-skills", "--no-prompt-templates", "--no-context-files",
    "--provider", "omo-reflection-qa", "--model", "parent-1", "--thinking", "off",
    "--session-dir", sessionDir, ...(print ? ["-p", "--mode", "json", "seed QA memory"] : [])]
}

function isolatedEnv(s, shim, phase, source = process.env) {
  // Drop inherited task-child selectors, profiles, credentials and Bun/Node preload hooks.
  const env = Object.fromEntries(["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TZ"].flatMap(
    (key) => source[key] === undefined ? [] : [[key, source[key]]]))
  return { ...env, HOME: s.homeDir, USERPROFILE: s.homeDir,
    XDG_CONFIG_HOME: s.xdgConfigHome, XDG_DATA_HOME: s.xdgDataHome,
    XDG_CACHE_HOME: s.xdgCacheHome, XDG_STATE_HOME: join(s.root, "xdg-state"),
    TMPDIR: join(s.root, "tmp"), SENPI_CODING_AGENT_DIR: s.agentDir,
    OMO_CODING_AGENT_DIR: s.agentDir, PI_CODING_AGENT_DIR: s.agentDir,
    OMO_MEMORY_HOME: join(s.root, "memory"), SENPI_BIN: shim,
    OMO_DISABLE_TELEMETRY: "1", DO_NOT_TRACK: "1", TERM: "xterm-256color",
    QA_REFLECTION_PHASE: phase, QA_REFLECTION_RECEIPTS: join(s.root, "receipts"),
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: "Reflection QA", GIT_AUTHOR_EMAIL: "reflection-qa@example.invalid",
    GIT_COMMITTER_NAME: "Reflection QA", GIT_COMMITTER_EMAIL: "reflection-qa@example.invalid" }
}

function json(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.tmp-${randomUUID()}`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporary, path)
}
function readJson(path) { return JSON.parse(readFileSync(path, "utf8")) }
function jsonl(text) {
  // Session appends can split across events. Only parse newline-terminated records.
  return text.split("\n").slice(0, -1).filter(Boolean).map((line) => JSON.parse(line))
}
function sha(value) { return createHash("sha256").update(value).digest("hex") }

async function bounded(promise, timeoutMs, label, signal) {
  let timer, onAbort
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`deadline: ${label} (${timeoutMs}ms)`)), timeoutMs)
      onAbort = () => reject(signal.reason)
      if (signal?.aborted) onAbort()
      else signal?.addEventListener("abort", onAbort, { once: true })
    })])
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener("abort", onAbort)
  }
}

// Subscribe BEFORE any writer launches. Retain event-addressed contents so selecting the exact
// runId after its launch receipt cannot lose a fast completion. Never enumerate/poll this dir.
function subscribeDirectory(directory, fatal) {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const events = new EventEmitter()
  const observed = new Map()
  const subscription = watch(directory, (_, filename) => {
    if (!filename || !/\.(json|jsonl)$/.test(filename)) return
    try {
      const value = { filename, text: readFileSync(join(directory, filename), "utf8"),
        eventObservedAt: new Date().toISOString() }
      observed.set(filename, value)
      events.emit(filename, value)
    } catch (error) {
      // An atomic writer can remove a file after its event was queued.
      if (error.code !== "ENOENT") fatal.abort(error)
    }
  })
  subscription.on("error", (error) => fatal.abort(error))
  return {
    directory, armedAt: new Date().toISOString(),
    async wait(filename, predicate, timeoutMs) {
      let listener
      try {
        return await bounded(new Promise((resolveWait, reject) => {
          listener = (value) => {
            try { if (predicate(value.text)) resolveWait(value) } catch (error) { reject(error) }
          }
          events.on(filename, listener)
          if (observed.has(filename)) listener(observed.get(filename))
        }), timeoutMs, `file event ${join(directory, filename)}`, fatal.signal)
      } finally { events.off(filename, listener) }
    },
    close() { subscription.close() },
  }
}

function observerSource() {
  return `import { writeFileSync, renameSync } from "node:fs"
import { join } from "node:path"
export default function observe(pi) {
  const phase = process.env.QA_REFLECTION_PHASE
  const receipts = process.env.QA_REFLECTION_RECEIPTS
  function emit(kind, ctx, extra = {}) {
    const path = join(receipts, phase + "-" + kind + ".json")
    const value = { kind, phase, pid: process.pid, hasUI: ctx.hasUI,
      sessionId: ctx.sessionManager.getSessionId(), sessionFile: ctx.sessionManager.getSessionFile(), ...extra }
    writeFileSync(path + ".tmp", JSON.stringify(value) + "\\n", { mode: 0o600 })
    renameSync(path + ".tmp", path)
  }
  pi.on("session_start", (_, ctx) => emit("ready", ctx))
  pi.on("agent_settled", (event, ctx) => emit("settled", ctx, { event }))
  pi.on("session_shutdown", (_, ctx) => emit("shutdown", ctx))
  pi.registerCommand("qa-reflection-exit", { description: "Exit this QA-owned TUI", handler: async (_, ctx) => ctx.shutdown() })
}
`
}
function childShimSource() {
  return `#!${process.execPath}
import { runReflectionChild } from ${JSON.stringify(pathToFileURL(scriptPath).href)}
await runReflectionChild(process.argv.slice(2))
`
}

// Do not alter Senpi's flags or load an extension into the reflection child.
export async function runReflectionChild(args) {
  if (args.includes("--list-models")) {
    // Model visibility preflight must use the identical real CLI, not a fabricated catalog.
    const probe = Bun.spawn([process.execPath, senpiCli, ...args], {
      cwd: process.cwd(), env: process.env, stdin: "ignore", stdout: "inherit", stderr: "inherit",
    })
    process.exitCode = await probe.exited
    return
  }
  assert(args.includes("--session-dir") && args.includes("--system-prompt"), "missing isolated child arguments")
  const sessionDir = args[args.indexOf("--session-dir") + 1]
  const persona = args[args.indexOf("--system-prompt") + 1]
  assert(sessionDir && persona, "child launch missing evidence paths")
  const receipts = childReceiptPaths(sessionDir)
  const runId = basename(sessionDir)
  const systemPrompt = readFileSync(persona, "utf8")
  const child = Bun.spawn([process.execPath, senpiCli, ...args], {
    cwd: process.cwd(), env: process.env, stdin: "ignore", stdout: "inherit", stderr: "inherit",
  })
  json(receipts.launch, { runId, wrapperPid: process.pid, pid: child.pid,
    command: process.execPath, args: [senpiCli, ...args], cwd: process.cwd(), sessionDir, persona,
    systemPrompt, agentDir: process.env.SENPI_CODING_AGENT_DIR, memoryHome: process.env.OMO_MEMORY_HOME,
    launchedAt: new Date().toISOString() })
  const code = await child.exited
  json(receipts.exit, { runId, pid: child.pid, code })
  process.exitCode = code
}

function config(stepCount) {
  return { categories: { quick: { model: MODEL } }, memory: { enabled: true,
    facts: { enabled: false }, recall: { enabled: false }, nudge: { enabled: false },
    dream: { enabled: false, idle_minutes: 0, shutdown_launch: false },
    reflection: { trigger: { step_count: stepCount, on_compaction: false } } } }
}
function failureRecord(completion, index, status) {
  // Explicit fixture ordering, not a wall-clock wait. Every fixture follows the live success.
  const finishedAt = new Date(Date.parse(completion.finishedAt) + index + 1).toISOString()
  return { schemaVersion: 1, identity: completion.identity, category: "quick", model: MODEL,
    runId: `qa-health-${index}`, conversationIds: [], trigger: "manual", outcome: "failed",
    reason: "child_exit", detail: "QA_HEALTH_STABLE_FAILURE", startedAt: finishedAt, finishedAt,
    delivery: status === "pending" ? { status } : { status, sessionId: "qa-history", consumedAt: finishedAt } }
}

function memorySnapshot(root) {
  const snapshot = new Map()
  let bytes = 0
  function visit(path, rel) {
    const stat = lstatSync(path)
    assert(snapshot.size < 100_000, "real memory snapshot exceeds 100000 entries")
    if (stat.isSymbolicLink()) snapshot.set(rel, `symlink:${readlinkSync(path)}`)
    else if (stat.isDirectory()) {
      snapshot.set(rel, "directory")
      for (const name of readdirSync(path).sort()) visit(join(path, name), `${rel}/${name}`)
    } else if (stat.isFile()) {
      bytes += stat.size
      assert(bytes <= 512 * 1024 * 1024, "real memory exceeds 512MiB; isolation is unverified")
      snapshot.set(rel, sha(readFileSync(path)))
    } else throw new Error(`unsupported real memory entry: ${path}`)
  }
  if (existsSync(root)) visit(root, ".")
  return snapshot
}
function alive(pid) {
  try { process.kill(pid, 0); return true } catch (error) {
    if (error.code === "ESRCH") return false
    throw error
  }
}
function processTable() {
  const result = spawnSync("ps", ["-axo", "pid=,ppid=,pgid=,command="], { encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim().split("\n").map((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/)
    assert(match, `unparseable process row: ${line}`)
    return { pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]), command: match[4] }
  })
}
function exportTree(source, destination) {
  if (!existsSync(source)) return
  mkdirSync(destination, { recursive: true, mode: 0o700 })
  for (const name of readdirSync(source)) {
    // The production launch manifest includes a full environment. Our separate receipt keeps
    // argv and sandbox paths without exporting that manifest, including on failed launches.
    if (name === "launch.json") continue
    const from = join(source, name)
    const stat = lstatSync(from)
    if (stat.isDirectory()) exportTree(from, join(destination, name))
    else if (stat.isFile()) copyFileSync(from, join(destination, name))
    else throw new Error(`unexpected artifact type: ${from}`)
  }
}

async function live(options) {
  assert(typeof Bun !== "undefined" && typeof Bun.Terminal === "function", "Bun with PTY support required")
  assert(process.platform === "darwin" || process.platform === "linux", "POSIX PTY/process groups required")
  for (const path of [pluginEntry, senpiCli]) assert(existsSync(path), `missing local build: ${path}`)
  const resolver = join(repoRoot, ".agents/skills/senpi-qa/scripts/resolve-evidence-dir.mjs")
  const resolved = spawnSync(process.execPath, [resolver, "--repo-root", repoRoot,
    "--slug", options.evidenceSlug], { encoding: "utf8" })
  assert.equal(resolved.status, 0, resolved.stderr)
  const evidenceDir = resolved.stdout.trim()
  assert(!existsSync(evidenceDir), `refusing to overwrite evidence: ${evidenceDir}`)
  mkdirSync(evidenceDir, { recursive: true, mode: 0o700 })
  const report = { result: "FAIL", evidenceDir, checks: [], errors: [], sessions: [],
    build: { pluginEntry, pluginSha256: sha(readFileSync(pluginEntry)), senpiCli,
      senpiSha256: sha(readFileSync(senpiCli)), interpreter: process.execPath },
    model: { kind: "scripted-localhost-http", id: MODEL, liveProvider: false,
      maxParentRequestsPerTuiPhase: MAX_PARENT_REQUESTS_PER_PHASE } }
  const check = (name, ok, detail) => {
    report.checks.push({ name, ok: Boolean(ok), detail })
    assert(ok, `${name}: ${JSON.stringify(detail)}`)
  }
  const realAgent = join(homedir(), ".senpi/agent")
  const realMemory = join(homedir(), ".omo/memory")
  let protectedBefore, memoryBefore, s, server, completions, receipts
  const subscriptions = [], processes = [], requests = []
  const fatal = new AbortController()
  const sigint = () => fatal.abort(new Error("received SIGINT"))
  const sigterm = () => fatal.abort(new Error("received SIGTERM"))
  process.once("SIGINT", sigint)
  process.once("SIGTERM", sigterm)
  const subscribe = (dir) => {
    const sub = subscribeDirectory(dir, fatal)
    subscriptions.push(sub)
    return sub
  }
  let phase = "seed", phaseCursor = 0, childCursor = 0
  try {
    protectedBefore = snapshotProtectedState(realAgent)
    check("real protected snapshot complete", protectedBefore.complete, protectedBefore.errors)
    memoryBefore = memorySnapshot(realMemory)
    s = createSandbox()
    report.sandbox = s
    seedSandbox(s)
    for (const dir of ["receipts", "tmp", "xdg-state"]) mkdirSync(join(s.root, dir), { mode: 0o700 })
    json(join(s.agentDir, "settings.json"), { packages: [], defaultProjectTrust: "always",
      quietStartup: true, retry: { enabled: false } })
    json(join(s.agentDir, "omo-senpi/omo-native/onboarding-completed"), { version: 1, completedAt: new Date().toISOString() })
    const observer = join(s.root, "observer.mjs"), shim = join(s.root, "senpi-reflection-child")
    writeFileSync(observer, observerSource(), { mode: 0o600 })
    writeFileSync(shim, childShimSource(), { mode: 0o700 })
    receipts = subscribe(join(s.root, "receipts"))
    const seedSteps = [
      { type: "tool_call", name: "memory", arguments: { command: "create", file_path: "system/qa-parent.md",
        description: PARENT_MARKER, file_text: PARENT_MARKER, reason: "seed isolation QA" } },
      { type: "text", text: "QA_SEEDED" },
    ]
    const childSteps = [
      { type: "tool_call", name: "bash", arguments: { command:
        `printf '%s\\n' '---' 'description: QA reflection merge' '---' '${MERGED_MARKER}' > system/qa-reflection.md && git add system/qa-reflection.md && git commit -m 'qa: reflection isolation merge'` } },
      { type: "text", text: "QA_CHILD_DONE" },
    ]
    server = startMockCompletionsServer({ steps(body) {
      const child = body.model === "mock-1"
      const cursor = child ? childCursor++ : phaseCursor++
      requests.push({ phase, child, cursor, body })
      appendFileSync(join(evidenceDir, "model-requests.jsonl"), `${JSON.stringify(requests.at(-1))}\n`, { mode: 0o600 })
      try {
        // The shared server uses a global request index, independent of each model/phase cursor.
        return Array(requests.length).fill(mockStep(body.model, phase, cursor, seedSteps, childSteps))
      } catch (error) {
        fatal.abort(error)
        return Array(requests.length).fill({ type: "error", status: 400, body: { error: error.message } })
      }
    } })
    const baseUrl = await bounded(server.ready, options.timeoutMs, "localhost model listening", fatal.signal)
    json(join(s.agentDir, "auth.json"), { "omo-reflection-qa": { type: "api_key", key: "qa-not-a-secret" } })
    json(join(s.agentDir, "models.json"), { providers: { "omo-reflection-qa": {
      api: "openai-completions", baseUrl, apiKey: "qa-not-a-secret", models: ["parent-1", "mock-1"].map((id) => ({ id,
        name: "Reflection QA", reasoning: false, input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 8192 })),
    } } })
    const configPath = join(s.cwd, ".omo/omo.json")
    json(configPath, config(0))

    async function launch(name, print = false) {
      phase = name
      phaseCursor = 0
      const sessionDir = join(s.agentDir, "sessions", name)
      const sessionEvents = subscribe(sessionDir)
      const args = parentArgs(observer, sessionDir, print)
      const raw = join(evidenceDir, `${name}.terminal.raw`)
      writeFileSync(raw, "", { mode: 0o600 })
      const proc = Bun.spawn([process.execPath, ...args], { cwd: s.cwd,
        env: isolatedEnv(s, shim, name), ...(print ? { stdin: "ignore", stdout: "pipe", stderr: "pipe" } : {
          terminal: { cols: 120, rows: 40, name: "xterm-256color",
            data(_terminal, data) { appendFileSync(raw, data) } },
        }) })
      const tracked = { name, proc, raw, sessionEvents }
      processes.push(tracked)
      if (print) tracked.output = Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
      const event = await receipts.wait(`${name}-ready.json`, () => true, options.timeoutMs)
      tracked.ready = JSON.parse(event.text)
      report.sessions.push({ name, args, pid: proc.pid, ...tracked.ready })
      check(`${name} real surface`, tracked.ready.hasUI === !print && tracked.ready.pid === proc.pid, tracked.ready)
      return tracked
    }
    async function exitSession(run) {
      if (run.proc.terminal) run.proc.terminal.write("/qa-reflection-exit\r")
      const code = await bounded(run.proc.exited, run.proc.terminal ? 15_000 : options.timeoutMs, `${run.name} exit`, fatal.signal)
      if (run.output) {
        const [stdout, stderr] = await run.output
        writeFileSync(run.raw, stdout + stderr, { mode: 0o600 })
      }
      run.proc.terminal?.close()
      check(`${run.name} clean exit`, code === 0, code)
      await receipts.wait(`${run.name}-shutdown.json`, () => true, options.timeoutMs)
      const entries = jsonl(readFileSync(run.ready.sessionFile, "utf8"))
      copyFileSync(run.ready.sessionFile, join(evidenceDir, `${run.name}.session.jsonl`))
      return entries
    }
    const seed = await launch("seed", true)
    const seedEntries = await exitSession(seed)
    check("real memory tool seed succeeded", seedEntries.some((entry) => entry.message?.role === "toolResult"
      && entry.message.toolName === "memory" && !entry.message.isError), seed.ready.sessionFile)
    const agents = readdirSync(join(s.root, "memory/agents"))
    check("one sandbox memory identity", agents.length === 1, agents)
    report.memoryIdentity = agents[0]
    const identityRoot = join(s.root, "memory/agents", agents[0]), repo = join(identityRoot, "repo")
    check("seed through explicitly loaded extension", readFileSync(join(repo, "system/qa-parent.md"), "utf8").includes(PARENT_MARKER), repo)
    const completionsDir = join(identityRoot, "runtime/reflection/completions")
    completions = subscribe(completionsDir)
    const childReceipts = subscribe(join(dirname(completionsDir), "runs"))
    report.childReceiptSubscription = { directory: childReceipts.directory, armedAt: childReceipts.armedAt,
      launchFilename: CHILD_LAUNCH_RECEIPT, exitFilename: CHILD_EXIT_RECEIPT }
    check("reflection disabled while seeding", readdirSync(completionsDir).length === 0
      && !existsSync(join(childReceipts.directory, CHILD_LAUNCH_RECEIPT)), completionsDir)
    json(configPath, config(1))
    const trigger = await launch("trigger")
    report.completionSubscription = { directory: completionsDir, armedAt: completions.armedAt,
      triggerSubmittedAt: new Date().toISOString() }
    trigger.proc.terminal.write("Trigger one QA reflection.\r")
    await receipts.wait("trigger-settled.json", () => true, options.timeoutMs)
    const child = JSON.parse((await childReceipts.wait(CHILD_LAUNCH_RECEIPT, () => true, options.timeoutMs)).text)
    report.child = child
    const completionEvent = await completions.wait(`${child.runId}.json`,
      (text) => JSON.parse(text).delivery.status === "consumed", options.timeoutMs)
    const completion = JSON.parse(completionEvent.text)
    report.completion = completion
    Object.assign(report.completionSubscription, { filename: completionEvent.filename, eventObservedAt: completionEvent.eventObservedAt })
    check("completion merged", completion.outcome === "merged" && completion.runId === child.runId, completion)
    check("merge contents landed", readFileSync(join(repo, "system/qa-reflection.md"), "utf8").includes(MERGED_MARKER), completion.mergedCommitSha)
    const flags = ["--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files"]
    check("child isolated argv", !child.args.some((arg) => arg === "--fork" || arg.startsWith("--fork="))
      && child.args[0] === senpiCli && child.command === process.execPath
      && flags.every((flag) => child.args.includes(flag))
      && child.args[child.args.indexOf("--tools") + 1] === "bash,edit"
      && child.args[child.args.indexOf("--session-dir") + 1] === child.sessionDir
      && child.sessionDir === join(identityRoot, "runtime/reflection/runs", child.runId)
      && child.args[child.args.indexOf("--model") + 1] === MODEL
      && child.agentDir === s.agentDir && child.memoryHome === join(s.root, "memory"), child.args)
    const parentRequests = requests.filter((request) => request.phase === "trigger" && !request.child)
    const childRequests = requests.filter((request) => request.child)
    const systemText = (request) => JSON.stringify(request.body.messages.filter((message) => ["system", "developer"].includes(message.role)))
    check("parent-only marker actually injected", parentRequests.some((request) => systemText(request).includes(PARENT_MARKER)), parentRequests.length)
    check("child system prompt isolated", childRequests.length > 0 && childRequests.every((request) => !systemText(request).includes(PARENT_MARKER))
      && !child.systemPrompt.includes(PARENT_MARKER), childRequests.length)
    const childExit = JSON.parse((await childReceipts.wait(CHILD_EXIT_RECEIPT, () => true, options.timeoutMs)).text)
    check("real child exited successfully", childExit.runId === child.runId && childExit.code === 0, childExit)
    await trigger.sessionEvents.wait(basename(trigger.ready.sessionFile), (text) => jsonl(text).some(
      (entry) => entry.customType === "senpi-memory.reflection-completion" && entry.data?.runId === child.runId), options.timeoutMs)
    await exitSession(trigger)
    exportTree(child.sessionDir, join(evidenceDir, "reflection-run"))
    const childSessions = readdirSync(child.sessionDir).filter((name) => name.endsWith(".jsonl"))
    check("one real child session JSONL captured", childSessions.length === 1, childSessions)
    const childEntries = jsonl(readFileSync(join(child.sessionDir, childSessions[0]), "utf8"))
    check("child session executed the real bash tool", childEntries.some((entry) => entry.message?.role === "toolResult"
      && entry.message.toolName === "bash" && !entry.message.isError), childSessions[0])

    json(configPath, config(0))
    // A consumed failure streak is essential: empty history cannot detect the historical nag bug.
    for (let index = 0; index < 3; index++) json(join(completionsDir, `qa-health-${index}.json`), failureRecord(completion, index, "consumed"))
    const records = () => readdirSync(completionsDir).filter((name) => name.endsWith(".json")).map((name) => readJson(join(completionsDir, name)))
    check("follow-up has no pending completion", records().every((record) => record.delivery.status === "consumed"), records())
    const followup = await launch("followup")
    followup.proc.terminal.write("Acknowledge QA follow-up.\r")
    await receipts.wait("followup-settled.json", () => true, options.timeoutMs)
    const followupEntries = await exitSession(followup)
    check("fresh follow-up adds no health alert", followup.ready.sessionId !== trigger.ready.sessionId
      && followupEntries.filter((entry) => entry.customType === HEALTH_TYPE).length === 0, followup.ready.sessionId)
    const pending = failureRecord(completion, 3, "pending")
    json(join(completionsDir, `${pending.runId}.json`), pending)
    const failure = await launch("pending-failure")
    failure.proc.terminal.write("Acknowledge QA pending completion.\r")
    await receipts.wait("pending-failure-settled.json", () => true, options.timeoutMs)
    const failureEntries = await exitSession(failure)
    const alerts = failureEntries.filter((entry) => entry.customType === HEALTH_TYPE)
    check("new pending failure adds exactly one health alert", alerts.length === 1
      && alerts[0].data.identity === completion.identity && alerts[0].data.streak === 4
      && failureEntries.some((entry) => entry.customType === "senpi-memory.reflection-completion" && entry.data?.runId === pending.runId)
      && readJson(join(completionsDir, `${pending.runId}.json`)).delivery.status === "consumed", alerts)
    report.healthFixtures = { source: "synthetic durable completions; real TUI startup/drain", records: records() }
    const errorFiles = [...processes.flatMap((run) => [run.raw, run.ready.sessionFile]), ...readdirSync(child.sessionDir)
      .filter((name) => /\.(jsonl|log)$/.test(name)).map((name) => join(child.sessionDir, name))]
    check("no ModelUsabilityBudgetError", errorFiles.every((path) => !readFileSync(path, "utf8").includes("ModelUsabilityBudgetError")), errorFiles)
  } catch (error) {
    report.errors.push(error.stack ?? String(error))
  } finally {
    for (const subscription of subscriptions) subscription.close()
    try {
      // One process-tree snapshot, not polling. Descendant closure is computed over that snapshot.
      const table = processTable()
      const owned = new Set(processes.filter((run) => run.proc.exitCode === null).map((run) => run.proc.pid))
      if (s) for (const row of table) if (row.command.includes(s.root)) owned.add(row.pid)
      function addDescendants(pid) {
        for (const row of table) if (row.ppid === pid && !owned.has(row.pid)) {
          owned.add(row.pid)
          addDescendants(row.pid)
        }
      }
      for (const pid of [...owned]) addDescendants(pid)
      const killed = []
      for (const pid of owned) if (pid !== process.pid && alive(pid)) {
        try { process.kill(pid, "SIGKILL"); killed.push(pid) } catch (error) {
          if (error.code !== "ESRCH") throw error
        }
      }
      await Promise.all(processes.map(async (run) => {
        await bounded(run.proc.exited, 15_000, `${run.name} cleanup exit`)
        run.proc.terminal?.close()
        if (run.output) {
          const [stdout, stderr] = await bounded(run.output, 15_000, `${run.name} pipe close`)
          writeFileSync(run.raw, stdout + stderr, { mode: 0o600 })
        }
      }))
      const survivors = s ? processTable().filter((row) => row.pid !== process.pid
        && (row.command.includes(s.root) || owned.has(row.pid))) : []
      report.cleanup = { killedPids: killed, survivors, keepSandbox: options.keepSandbox }
      if (survivors.length) report.errors.push(`cleanup survivors: ${JSON.stringify(survivors)}`)
    } catch (error) { report.errors.push(`process cleanup: ${error.stack ?? error}`) }
    server?.close()
    try {
      if (s) {
        exportTree(join(s.root, "receipts"), join(evidenceDir, "receipts"))
        exportTree(join(s.agentDir, "sessions"), join(evidenceDir, "sessions"))
        if (completions) {
          exportTree(completions.directory, join(evidenceDir, "completions"))
          // Includes root-level child receipts even if launch/exit/completion validation failed.
          exportTree(join(dirname(completions.directory), "runs"), join(evidenceDir, "reflection-runs"))
        }
      }
    } catch (error) { report.errors.push(`artifact export: ${error.stack ?? error}`) }
    try {
      const after = snapshotProtectedState(realAgent)
      const scope = { identity: report.memoryIdentity,
        tokens: [s?.root, s && basename(s.root), ...report.sessions.map((session) => session.sessionId),
          report.child?.runId].filter((token) => typeof token === "string" && token.length > 0) }
      const isolation = assessIsolation(protectedBefore, after, memoryBefore,
        memoryBefore ? memorySnapshot(realMemory) : undefined, scope)
      report.isolation = { realAgent, realMemory, protectedFiles: [...after.snapshot.keys()],
        ...isolation,
        policy: "Senpi protected state must be complete and unchanged. Memory paths owned by another identity without sandbox/session/run tokens are concurrent observations; sandbox-owned or unclassified changes fail." }
      if (!isolation.verified) report.errors.push("real-home isolation not proven")
    } catch (error) { report.errors.push(`isolation receipt: ${error.stack ?? error}`) }
    try {
      if (s && !options.keepSandbox) rmSync(s.root, { recursive: true, force: true })
      report.cleanup = { ...report.cleanup, sandboxRemoved: s ? !existsSync(s.root) : true,
        retainedPath: s && options.keepSandbox ? s.root : null }
    } catch (error) { report.errors.push(`sandbox cleanup: ${error.stack ?? error}`) }
    process.off("SIGINT", sigint)
    process.off("SIGTERM", sigterm)
  }
  if (fatal.signal.aborted) report.errors.push(`event failure: ${fatal.signal.reason}`)
  report.result = report.errors.length === 0 && report.checks.every((entry) => entry.ok) ? "PASS" : "FAIL"
  json(join(evidenceDir, "result.json"), report)
  writeFileSync(join(evidenceDir, "README.md"), `# Reflection isolation QA\n\n## What was tested\n\n${JSON.stringify(process.argv)}\n\nReal worktree-local Senpi PTY; built local OMO extension; localhost scripted model.\n\n## What was observed\n\n${report.result}; see result.json, terminal raw files, model-requests.jsonl, sessions, reflection-run, receipts and completions.\n\n## Why it is enough\n\nCompletion and merged files, child argv and actual HTTP system prompts, fresh-session health counts, isolation snapshots and cleanup receipts are independent PASS gates. Health failures are synthetic durable fixtures, not simulated delivery hooks.\n\n## What was omitted\n\nNo production credentials, auth files, real-home file contents or environment dumps are copied. No claim about live model quality.\n`, { mode: 0o600 })
  return report
}

function selfTest() {
  const options = parseArgs(["--self-test", "--timeout-ms", "5000", "--evidence-slug", "qa-test", "--keep-sandbox"])
  assert.equal(options.timeoutMs, 5000)
  assert(options.selfTest && options.keepSandbox)
  for (const args of [["--unknown"], ["--timeout-ms"], ["--timeout-ms", "NaN"], ["--evidence-slug", "../escape"]]) assert.throws(() => parseArgs(args))
  const args = parentArgs("/isolated/observer.mjs", "/isolated/sessions")
  assert.equal(args[0], senpiCli)
  assert.equal(args[args.indexOf("--model") + 1], "parent-1")
  assert(args.includes(pluginEntry) && args.includes("--no-extensions"))
  assert(!args.includes("-p") && !args.includes("--fork"))
  assert(parentArgs("observer", "sessions", true).includes("-p"))
  for (const root of ["/isolated/memory/agents/qa/runtime/reflection/runs",
    "/isolated with spaces/memory/agents/other/runtime/reflection/runs"]) {
    const receiptPaths = childReceiptPaths(join(root, "run-1"))
    assert.deepEqual(receiptPaths, { directory: root,
      launch: join(root, "child-launch.json"), exit: join(root, "child-exit.json") })
    assert.deepEqual(childReceiptPaths(join(root, "run-2")), receiptPaths)
    assert.equal(basename(receiptPaths.launch), CHILD_LAUNCH_RECEIPT)
    assert.equal(basename(receiptPaths.exit), CHILD_EXIT_RECEIPT)
    assert.equal(dirname(receiptPaths.launch), dirname(receiptPaths.exit))
  }
  const sandbox = { root: "/isolated", homeDir: "/isolated/home", agentDir: "/isolated/agent",
    xdgConfigHome: "/isolated/config", xdgDataHome: "/isolated/data", xdgCacheHome: "/isolated/cache" }
  const env = isolatedEnv(sandbox, "/isolated/shim", "self-test", { HOME: "/real",
    OMO_CODING_AGENT_DIR: "/real/agent", SENPI_BIN: "/real/senpi", NODE_OPTIONS: "--require=bad",
    SENPI_TASK_ID: "parent-task", OMO_PROFILE: "real-profile", API_KEY: "secret", PATH: "/bin" })
  assert.equal(env.HOME, "/isolated/home")
  assert.equal(env.OMO_MEMORY_HOME, "/isolated/memory")
  assert.equal(env.SENPI_CODING_AGENT_DIR, "/isolated/agent")
  for (const key of ["NODE_OPTIONS", "SENPI_TASK_ID", "OMO_PROFILE", "API_KEY"]) assert(!(key in env))
  assert.equal(config(0).memory.reflection.trigger.step_count, 0)
  assert.equal(config(1).memory.reflection.trigger.step_count, 1)
  assert.equal(config(0).memory.dream.enabled, false)
  const completion = { identity: "qa", finishedAt: "2026-09-05T00:00:00.000Z" }
  assert.equal(failureRecord(completion, 3, "pending").delivery.status, "pending")
  assert.equal(failureRecord(completion, 2, "consumed").delivery.status, "consumed")
  assert(Date.parse(failureRecord(completion, 3, "pending").finishedAt)
    > Date.parse(failureRecord(completion, 2, "consumed").finishedAt))
  const transpiler = new Bun.Transpiler({ loader: "js" })
  transpiler.transformSync(observerSource())
  transpiler.transformSync(childShimSource())
  assert.equal(jsonl('{"customType":"senpi-memory.health"}\n{"partial":').length, 1)
  const seedSteps = [{ type: "tool_call", name: "memory" }, { type: "text", text: "QA_SEEDED" }]
  const childSteps = [{ type: "tool_call", name: "bash" }, { type: "text", text: "QA_CHILD_DONE" }]
  for (const phase of ["trigger", "followup", "pending-failure"]) {
    for (let cursor = 0; cursor < MAX_PARENT_REQUESTS_PER_PHASE; cursor++) {
      assert.deepEqual(mockStep("parent-1", phase, cursor, seedSteps, childSteps),
        mockStep("parent-1", phase, 0, seedSteps, childSteps))
    }
    assert.throws(() => mockStep("parent-1", phase, MAX_PARENT_REQUESTS_PER_PHASE, seedSteps, childSteps))
    assert.throws(() => mockStep("wrong-model", phase, 0, seedSteps, childSteps))
  }
  for (let cursor = 0; cursor < 2; cursor++) {
    assert.equal(mockStep("parent-1", "seed", cursor, seedSteps, childSteps), seedSteps[cursor])
    assert.equal(mockStep("mock-1", "trigger", cursor, seedSteps, childSteps), childSteps[cursor])
  }
  assert.throws(() => mockStep("parent-1", "seed", 2, seedSteps, childSteps))
  assert.throws(() => mockStep("mock-1", "trigger", 2, seedSteps, childSteps))
  assert.throws(() => mockStep("mock-1", "followup", 0, seedSteps, childSteps))
  assert.throws(() => mockStep("parent-1", "unknown", 0, seedSteps, childSteps))
  const protectedState = { complete: true, snapshot: new Map([["auth.json", "unchanged"]]) }
  const scope = { identity: "project-qa123", tokens: ["omo-senpi-qa-test", "qa-session-id"] }
  const concurrentPaths = ["./agents/lead/runtime/transcripts/lead-session/transcript.jsonl",
    "./agents/lead/runtime/facts-queue/cursor/lead.json", "./agents/lead/runtime/recall/runs/lead/state.json"]
  const before = new Map(concurrentPaths.map((path) => [path, "before"]))
  const after = new Map(concurrentPaths.map((path) => [path, "after"]))
  const concurrent = assessIsolation(protectedState, protectedState, before, after, scope)
  assert(concurrent.verified && concurrent.realSenpiUntouched && concurrent.memoryNotAttributed)
  assert.equal(concurrent.realMemoryUntouched, false)
  assert.deepEqual(concurrent.changedMemory, [...concurrentPaths].sort())
  assert.deepEqual(concurrent.concurrentMemoryPaths, concurrent.changedMemory)
  assert.deepEqual(concurrent.attributedSandboxPaths, [])
  for (const path of ["./agents/project-qa123/runtime/facts/state.json",
    "./agents/lead/runtime/transcripts/qa-session-id/state.json", "./agents/omo-senpi-qa-test/repo/facts.md"]) {
    const leaked = assessIsolation(protectedState, protectedState, before, new Map([...after, [path, "leak"]]), scope)
    assert.equal(leaked.verified, false)
    assert.deepEqual(leaked.attributedSandboxPaths, [path])
  }
  const unknown = assessIsolation(protectedState, protectedState, before, new Map([...after, ["global.json", "changed"]]), scope)
  assert.equal(unknown.verified, false)
  assert.deepEqual(unknown.unclassifiedMemoryPaths, ["global.json"])
  assert.equal(assessIsolation(protectedState, protectedState, before, after, { tokens: [] }).verified, false)
  assert.equal(assessIsolation(protectedState, protectedState, undefined, after, scope).verified, false)
  assert.equal(assessIsolation(protectedState, { ...protectedState, complete: false }, before, after, scope).verified, false)
  assert.equal(assessIsolation(protectedState, { complete: true, snapshot: new Map([["auth.json", "changed"]]) }, before, after, scope).verified, false)
  return { result: "PASS", mode: "self-test", senpiLaunched: false, sandboxCreated: false,
    checks: ["argument validation", "local build paths and PTY/print argv", "granted reflection receipt paths and stable filenames", "environment isolation",
      "reflection toggle", "health fixture ordering", "generated observer/shim syntax", "partial JSONL",
      "bounded TUI parent continuations", "strict seed/child/model routing", "identity-scoped concurrent memory changes",
      "sandbox memory attribution and unknown-path rejection", "protected-state fail-closed"] }
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    const options = parseArgs(process.argv.slice(2))
    const report = options.selfTest ? selfTest() : await live(options)
    console.log(JSON.stringify(report, null, 2))
    process.exitCode = report.result === "PASS" ? 0 : 1
  } catch (error) {
    console.log(JSON.stringify({ result: "FAIL", errors: [error.stack ?? String(error)] }, null, 2))
    process.exitCode = 1
  }
}

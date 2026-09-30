/**
 * Released-engine harness for the session-gateway scenarios (plan todo 16).
 *
 * The older scenarios in this directory drive the thread components from source against a senpi
 * SOURCE checkout (`lib/harness.mjs`). These drive the product the way a user runs it:
 *
 * - the engine is the RELEASED senpi from npm (`THREAD_QA_SENPI_VERSION`, default 2026.9.29-5),
 *   installed once into a kit dir (`THREAD_QA_KIT_DIR`, default `/tmp/qa-thread-tools-kit`);
 * - `omo` is this checkout's launcher (`packages/omo-native/bin/omo.js`) over a COPY of this
 *   checkout's built plugin (`packages/omo-senpi/plugin`), so `omo`, `omo --session`, `omo thread`
 *   and `omo daemon adopt` are the real CLI paths;
 * - every terminal is a real pty TUI (`Bun.spawn({ terminal })`) whose screen is kept by
 *   `@xterm/headless`, and every assertion reads target state: the endpoint's own answers, the
 *   gateway store and the session file.
 *
 * Scratch copies are patched, never the checkout, and only to re-open test seams the bundle
 * compiled out (see `PATCHES`); the gateway is the only send path, so no scenario patches how it
 * sends. Every patch must hit exactly one site, or the kit refuses to build.
 *
 * Waits are event-driven: a predicate is re-checked on pty output, file-system events under the
 * scratch dir, endpoint feed records and fake-model requests, under one bounded deadline. Nothing
 * here sleeps to wait for a state.
 */
import { spawn as spawnChild } from "node:child_process"
import { randomBytes } from "node:crypto"
import { EventEmitter } from "node:events"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { createConnection } from "node:net"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))

export const OMO_ROOT = resolve(here, "..", "..", "..", "..", "..", "..")
export const ENGINE_VERSION = process.env.THREAD_QA_SENPI_VERSION ?? "2026.9.29-5"
export const KIT_DIR = process.env.THREAD_QA_KIT_DIR ?? "/tmp/qa-thread-tools-kit"
const KIT_DEPENDENCIES = {
  "@code-yeongyu/senpi": ENGINE_VERSION,
  "@babel/parser": "8.0.4",
  "@xterm/headless": "6.0.0",
  "@xterm/xterm": "6.0.0",
}
const SOURCE_BIN = join(OMO_ROOT, "packages", "omo-native", "bin")
const SOURCE_NATIVE_MANIFEST = join(OMO_ROOT, "packages", "omo-native", "package.json")
const SOURCE_PLUGIN = join(OMO_ROOT, "packages", "omo-senpi", "plugin")

/** One bus every event source reports to; `waitFor` re-checks its predicate on each tick. */
export const bus = new EventEmitter()
bus.setMaxListeners(0)
const tick = (source) => bus.emit("tick", source)

/* ------------------------------------------------------------------ cleanup tracking */

const children = new Set()
const closers = []

/** Track a spawned process; cleanup signals its whole process group (every child is spawned detached). */
export function track(proc, label) {
  const entry = { proc, label, pid: proc.pid }
  children.add(entry)
  return entry
}

/** Register a teardown step; steps run in reverse registration order, after every child is gone. */
export function onCleanup(fn) {
  closers.push(fn)
}

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === "EPERM"
  }
}

function signalGroup(pid, signal) {
  try {
    process.kill(-pid, signal)
  } catch {
    try {
      process.kill(pid, signal)
    } catch {
      // Already gone.
    }
  }
}

/** Wait until `pid` is gone; resolved by polling `kill -0` on the exit edge of a process we do not own. */
export async function waitGone(pid, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (alive(pid)) {
    if (Date.now() > deadline) return false
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25))
  }
  return true
}

const sandboxes = new Set()

/**
 * Processes whose command line names a sandbox of this run. A terminal's task host and its supervisor
 * run in their own process group and outlive the terminal until their idle exit, so killing the
 * terminal's group is not enough; the sandbox path is unique to this run, so matching it can never
 * reach another session's process.
 */
function sandboxPids() {
  const pids = new Set()
  for (const dir of sandboxes) {
    for (const line of Bun.spawnSync(["pgrep", "-f", dir]).stdout.toString().split("\n")) {
      const pid = Number(line.trim())
      if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) pids.add(pid)
    }
  }
  return [...pids]
}

export const swept = []

let cleaned = false
export async function cleanupAll() {
  if (cleaned) return
  cleaned = true
  for (const entry of children) signalGroup(entry.pid, "SIGTERM")
  for (const entry of children) {
    if (!(await waitGone(entry.pid, 3000))) {
      signalGroup(entry.pid, "SIGKILL")
      await waitGone(entry.pid, 3000)
    }
  }
  children.clear()
  for (const pid of sandboxPids()) {
    swept.push(pid)
    signalGroup(pid, "SIGTERM")
    if (!(await waitGone(pid, 3000))) {
      signalGroup(pid, "SIGKILL")
      await waitGone(pid, 3000)
    }
  }
  for (const close of closers.reverse()) {
    try {
      await close()
    } catch (error) {
      process.stderr.write(`cleanup step failed: ${error instanceof Error ? error.message : String(error)}\n`)
    }
  }
  closers.length = 0
}

let hooksInstalled = false
export function installCleanupHooks() {
  if (hooksInstalled) return
  hooksInstalled = true
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      void cleanupAll().finally(() => process.exit(130))
    })
  }
}

/* ------------------------------------------------------------------ reporting */

/** Same line format as `lib/harness.mjs` (`PASS|FAIL|SKIP <label>/<name>`), so `run-all.mjs` counts it. */
export function createReport(label) {
  const lines = []
  const steps = []
  const defects = []
  let failures = 0
  let skipped = 0
  return {
    label,
    lines,
    steps,
    log(line) {
      lines.push(line)
      process.stdout.write(`${line}\n`)
    },
    assert(name, ok, detail) {
      if (!ok) failures += 1
      steps.push({ name, status: ok ? "pass" : "fail", detail: detail ?? null })
      this.log(`${ok ? "PASS" : "FAIL"} ${label}/${name}${detail === undefined ? "" : ` ${detail}`}`)
      return ok
    },
    skip(name, reason) {
      skipped += 1
      steps.push({ name, status: "skip", detail: reason })
      this.log(`SKIP ${label}/${name} ${reason}`)
    },
    /**
     * A documented behavior this run found broken in the PRODUCT (not in the harness). It is not a
     * PASS and not a harness failure: the line reads `DEFECT <label>/<name> <id> ...`, the step is
     * recorded as `product_defect`, and `run-all.mjs` counts it, so a green run never hides it. Once
     * the product holds the documented behavior the same check prints PASS.
     */
    defect(name, holds, defectId, detail) {
      if (holds) return this.assert(name, true, detail)
      defects.push({ name, id: defectId, detail })
      steps.push({ name, status: "product_defect", defect: defectId, detail })
      this.log(`DEFECT ${label}/${name} ${defectId} ${detail}`)
      return false
    },
    get defects() {
      return defects
    },
    get failures() {
      return failures
    },
    get skipped() {
      return skipped
    },
  }
}

export function flag(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

export function hasFlag(name) {
  return process.argv.includes(name)
}

/** Where a scenario writes its evidence: `--evidence-dir`, else `--out`'s dir, else a scratch-independent tmp dir. */
export function evidenceDir(label) {
  const explicit = flag("--evidence-dir")
  const out = flag("--out")
  const dir = explicit ?? (out === undefined ? join("/tmp", `thread-qa-evidence-${label}-${Date.now()}`) : join(dirname(out), label))
  mkdirSync(dir, { recursive: true })
  return dir
}

/* ------------------------------------------------------------------ waits */

/**
 * Resolve with the first truthy value of `check()`. The predicate runs once now and again on every
 * bus tick (pty output, file-system events, feed records, model requests); the deadline is the only
 * timer and it only ever rejects.
 */
export function waitFor(check, { label, timeoutMs = 60_000 } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false
    let running = false
    let again = false
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      bus.off("tick", onTick)
      fn(value)
    }
    const evaluate = async () => {
      if (settled) return
      if (running) {
        again = true
        return
      }
      running = true
      try {
        do {
          again = false
          const value = await check()
          if (value) {
            finish(resolvePromise, value)
            return
          }
        } while (again && !settled)
      } catch (error) {
        finish(rejectPromise, error)
      } finally {
        running = false
      }
    }
    const onTick = () => void evaluate()
    const timer = setTimeout(() => finish(rejectPromise, new Error(`timeout after ${timeoutMs}ms waiting for: ${label ?? "condition"}`)), timeoutMs)
    bus.on("tick", onTick)
    void evaluate()
  })
}

/** Report file-system activity under `dir` to the bus for the life of the scenario. */
export function watchTree(dir) {
  let watcher
  try {
    watcher = watch(dir, { recursive: true }, () => tick("fs"))
  } catch {
    return
  }
  watcher.on("error", () => undefined)
  onCleanup(() => watcher.close())
}

/* ------------------------------------------------------------------ kit */

async function run(command, args, { cwd, env } = {}) {
  return await new Promise((resolvePromise) => {
    const child = spawnChild(command, args, { cwd, env: env ?? process.env, stdio: ["ignore", "pipe", "pipe"] })
    const out = []
    const err = []
    child.stdout.on("data", (chunk) => out.push(chunk))
    child.stderr.on("data", (chunk) => err.push(chunk))
    child.once("close", (code) => resolvePromise({ code, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") }))
  })
}

function installedEngineVersion() {
  try {
    return JSON.parse(readFileSync(join(KIT_DIR, "node_modules", "@code-yeongyu", "senpi", "package.json"), "utf8")).version
  } catch {
    return undefined
  }
}

/** Install the released engine (and the screen emulator) into the kit once; later calls reuse it. */
export async function ensureKit() {
  if (installedEngineVersion() !== ENGINE_VERSION || !existsSync(join(KIT_DIR, "node_modules", "@xterm", "headless"))) {
    mkdirSync(KIT_DIR, { recursive: true })
    writeFileSync(join(KIT_DIR, "package.json"), `${JSON.stringify({ name: "qa-thread-tools-kit", private: true, type: "module", dependencies: KIT_DEPENDENCIES }, null, 2)}\n`)
    const installed = await run(process.execPath, ["install"], { cwd: KIT_DIR })
    if (installed.code !== 0) throw new Error(`kit install failed (${installed.code}):\n${installed.stderr.slice(-2000)}`)
  }
  const version = installedEngineVersion()
  if (version !== ENGINE_VERSION) throw new Error(`kit engine is ${version}, expected ${ENGINE_VERSION}`)
  return { dir: KIT_DIR, engineVersion: version, engineDist: join(KIT_DIR, "node_modules", "@code-yeongyu", "senpi", "dist") }
}

/**
 * Patches applied to a scratch COPY of the built plugin. Each names the bundle, the exact text it
 * replaces and why; `buildOmoInstall` refuses a patch that does not match exactly once, so a rebuilt
 * bundle can never silently skip one.
 */
export const PATCHES = {
  /**
   * `receiver-crash`: the drain's `_test.afterAdmit` seam, reachable from the environment. With
   * `THREAD_QA_CRASH_AFTER_ADMIT=<kind>` the receiver SIGKILLs itself right after
   * `admitExternalMessage` returned that kind - after T1 (claim) and before T2 (`recordOutcome`).
   * Without the variable the seam is a no-op, exactly as in production.
   */
  crash_after_admit: {
    file: "extensions/omo.js",
    from: "e._test?.afterAdmit?.(p.row,f.kind)",
    to: '(e._test?.afterAdmit??((r,k)=>{if(process.env.THREAD_QA_CRASH_AFTER_ADMIT===k){try{process.getBuiltinModule("node:fs").writeFileSync(process.env.THREAD_QA_CRASH_MARKER,r.delivery_id)}catch{}process.kill(process.pid,"SIGKILL")}}))(p.row,f.kind)',
  },
  /**
   * `lost-ack`: the store worker's `afterDbCommit` test hook (it runs only right after a delivery's
   * COMMIT), reachable from the environment. `THREAD_QA_AFTER_DB_COMMIT=sigkill` kills the sending
   * process the instant its delivery row committed, before it can reply. Unset, it is a no-op.
   * The minifier renames identifiers on every rebuild, so the anchor captures them.
   */
  sender_kill_after_commit: {
    file: "extensions/gateway-store-worker.mjs",
    from: /let ([\w$]+)=([\w$]+)\?\.config\.test_hooks\[([\w$]+)\];/,
    to: 'let $1=$2?.config.test_hooks[$3]??("afterDbCommit"===$3?process.env.THREAD_QA_AFTER_DB_COMMIT:void 0);',
  },
  /** `loop-guard --mutant`: the cycle guard of the store worker answers "no cycle", so the scenario must FAIL. */
  cycle_check_off: {
    file: "extensions/gateway-store-worker.mjs",
    from: /([\w$]+\.sender_node,[\w$]+\.target_durable_id\))\?([\w$]+\("loop_detected","The target already leads back to the sender in this causal chain.")/,
    to: "$1&&false?$2",
  },
}

/**
 * A runnable omo install in the kit: `<kit>/<name>/{bin,package.json,plugin}`, resolving the engine
 * from `<kit>/node_modules`. Rebuilt from this checkout on every call.
 */
export async function buildOmoInstall(name, patchNames = []) {
  await ensureKit()
  const root = join(KIT_DIR, name)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
  cpSync(SOURCE_BIN, join(root, "bin"), { recursive: true })
  cpSync(SOURCE_NATIVE_MANIFEST, join(root, "package.json"))
  cpSync(SOURCE_PLUGIN, join(root, "plugin"), { recursive: true })
  const applied = []
  for (const patchName of patchNames) {
    const patch = PATCHES[patchName]
    if (patch === undefined) throw new Error(`unknown patch ${patchName}`)
    const path = join(root, "plugin", patch.file)
    const text = readFileSync(path, "utf8")
    const hits = patch.from instanceof RegExp ? [...text.matchAll(new RegExp(patch.from.source, "g"))].length : text.split(patch.from).length - 1
    if (hits !== 1) throw new Error(`patch ${patchName} matched ${hits} sites in ${patch.file}; expected exactly 1`)
    writeFileSync(path, text.replace(patch.from, patch.to))
    applied.push({ patch: patchName, file: patch.file })
  }
  return { name, root, omoJs: join(root, "bin", "omo.js"), plugin: join(root, "plugin"), patches: applied }
}

/* ------------------------------------------------------------------ scratch */

const PASSTHROUGH_ENV = ["PATH", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "LC_CTYPE"]

/**
 * A hermetic sandbox under `/tmp/qa-thread-tools-<label>-<rand>`: its own HOME and agent dir (never
 * the real `~/.omo`), a work dir every session of the scenario shares (one workspace), the mock
 * provider pointed at `fake`, the first-run onboarding marked done, and the task shard pre-warm off
 * so no idle task host joins the agent dir. The path stays short so every socket lands inside it.
 */
export function makeScratch(label, fake) {
  const dir = mkdtempSync(join("/tmp", `qa-thread-tools-${label}-`))
  sandboxes.add(dir)
  onCleanup(() => rmSync(dir, { recursive: true, force: true }))
  const home = join(dir, "home")
  const agentDir = join(dir, "agent")
  const work = join(dir, "work")
  for (const path of [home, agentDir, work, join(agentDir, "omo-senpi", "omo-native")]) mkdirSync(path, { recursive: true })
  writeFileSync(join(agentDir, "models.json"), `${JSON.stringify(mockModels(fake.url), null, 2)}\n`)
  writeFileSync(join(agentDir, "settings.json"), `${JSON.stringify({ defaultProvider: "mock", defaultModel: "mock-model", quietStartup: true }, null, 2)}\n`)
  const omoConfig = `${JSON.stringify({ task: { host_shard_prewarm: "off" } }, null, 2)}\n`
  writeFileSync(join(agentDir, "omo.json"), omoConfig)
  mkdirSync(join(home, ".omo"), { recursive: true })
  writeFileSync(join(home, ".omo", "omo.json"), omoConfig)
  writeFileSync(join(agentDir, "omo-senpi", "omo-native", "onboarding-completed"), "qa-thread-tools\n")
  const env = {}
  for (const key of PASSTHROUGH_ENV) if (process.env[key] !== undefined) env[key] = process.env[key]
  Object.assign(env, {
    HOME: home,
    OMO_CODING_AGENT_DIR: agentDir,
    SENPI_CODING_AGENT_DIR: agentDir,
    TMPDIR: "/tmp/",
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    PI_OFFLINE: "1",
    PI_TELEMETRY: "0",
    DO_NOT_TRACK: "1",
    OMO_DISABLE_POSTHOG: "1",
  })
  watchTree(dir)
  return { label, dir, home, agentDir, work, env }
}

function mockModels(url) {
  return {
    providers: {
      mock: {
        baseUrl: url,
        apiKey: "sk-qa-thread-tools",
        api: "openai-completions",
        models: [{ id: "mock-model", baseUrl: url, api: "openai-completions", contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
      },
    },
  }
}

/* ------------------------------------------------------------------ fake model */

/** A tool call the fake model makes when it reads this line; base64url keeps the JSON escape-free inside a delivery body. */
export function callDirective(tool, args) {
  return `QA:CALL ${tool} ${Buffer.from(JSON.stringify(args), "utf8").toString("base64url")}`
}

export function holdDirective(tag) {
  return `QA:HOLD ${tag}`
}

const DELIVERY_PATTERN = /^\[OMO_GATEWAY v=1 ([^\]]*)\]\n[^\n]*\n([\s\S]*)$/

/** A delivery's rendered text split into its header fields and the sender's own text. */
export function parseDeliveryText(text) {
  const match = DELIVERY_PATTERN.exec(text)
  if (match === null) return undefined
  const header = Object.fromEntries(match[1].split(" ").slice(1).map((pair) => pair.split("=")).map(([key, ...value]) => [key, value.join("=")]))
  let body = match[2]
  try {
    body = JSON.parse(match[2])
  } catch {
    // An unparseable body stays the raw text.
  }
  return { header, body: typeof body === "string" ? body : JSON.stringify(body) }
}

function contentText(message) {
  if (typeof message?.content === "string") return message.content
  if (Array.isArray(message?.content)) return message.content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("\n")
  return ""
}

/**
 * An OpenAI-completions fake that answers from the conversation instead of a global turn index, so
 * several sessions can share it. It reads the newest message:
 * - a tool result -> `QA-TOOL-RESULT <tool> <result>` (the scenario parses the result from `requests`);
 * - a user message (a typed prompt, or a delivery, whose body is unwrapped) with `QA:SCRIPT <name>`
 *   (registered by `fake.script`) or `QA:CALL <tool> <b64>` lines -> those tool calls; with `QA:HOLD <tag>` -> a stream held open until `release(tag)`;
 *   otherwise -> `QA-ACK <every QA-TOKEN-* in it>`.
 * Every request is recorded with the directive it answered.
 */
export async function startFakeModel() {
  const requests = []
  const holds = new Map()
  const scripts = new Map()
  const server = createServer((req, res) => {
    const chunks = []
    req.on("data", (chunk) => chunks.push(chunk))
    req.on("end", () => {
      let body = {}
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")
      } catch {
        body = {}
      }
      if ((req.url ?? "").includes("/models")) {
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify({ object: "list", data: [{ id: "mock-model", object: "model" }] }))
        return
      }
      const messages = Array.isArray(body.messages) ? body.messages : []
      const last = messages.at(-1)
      const record = { at: Date.now(), tools: (body.tools ?? []).map((tool) => tool?.function?.name), messages, answer: undefined }
      requests.push(record)
      let turn
      if (last?.role === "tool") {
        const call = [...messages].reverse().find((message) => message.role === "assistant" && Array.isArray(message.tool_calls))
        const nameOf = (message) => call?.tool_calls?.find((toolCall) => toolCall.id === message.tool_call_id)?.function?.name ?? "unknown"
        // Parallel tool calls come back as one request carrying every result after the assistant message.
        const trailing = messages.slice(messages.lastIndexOf(call) + 1).filter((message) => message.role === "tool")
        const name = nameOf(last)
        record.answer = { kind: "tool_result", tool: name, result: contentText(last), results: trailing.map((message) => ({ tool: nameOf(message), result: contentText(message) })) }
        turn = { text: `QA-TOOL-RESULT ${name} ${contentText(last).replace(/\s+/g, " ").slice(0, 400)}` }
      } else {
        const raw = contentText([...messages].reverse().find((message) => message.role === "user"))
        const delivery = parseDeliveryText(raw.trim())
        const text = delivery?.body ?? raw
        const scripted = [...text.matchAll(/QA:SCRIPT ([A-Za-z0-9_-]+)/g)].flatMap((match) => scripts.get(match[1]) ?? [])
        const calls = [...scripted, ...[...text.matchAll(/QA:CALL ([A-Za-z0-9_]+) ([A-Za-z0-9_-]+)/g)].map((match) => ({ name: match[1], args: JSON.parse(Buffer.from(match[2], "base64url").toString("utf8")) }))]
        const hold = /QA:HOLD ([A-Za-z0-9_-]+)/.exec(text)?.[1]
        const tokens = [...new Set(text.match(/QA-TOKEN-[A-Za-z0-9_-]+/g) ?? [])]
        if (calls.length > 0) {
          record.answer = { kind: "tool_calls", calls, delivery: delivery?.header }
          turn = { toolCalls: calls }
        } else if (hold !== undefined) {
          record.answer = { kind: "hold", tag: hold, tokens, delivery: delivery?.header }
          turn = { hold, text: `QA-RELEASED ${hold} ${tokens.join(" ")}`.trim() }
        } else {
          record.answer = { kind: "ack", tokens, delivery: delivery?.header }
          turn = { text: `QA-ACK ${tokens.length === 0 ? "none" : tokens.join(" ")}` }
        }
      }
      writeSse(res, turn, body.model ?? "mock-model", holds)
      tick("model")
    })
  })
  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise))
  const port = server.address().port
  const sockets = new Set()
  server.on("connection", (socket) => {
    sockets.add(socket)
    socket.once("close", () => sockets.delete(socket))
  })
  const stop = () =>
    new Promise((resolvePromise) => {
      for (const release of holds.values()) release()
      for (const socket of sockets) socket.destroy()
      server.close(() => resolvePromise())
    })
  onCleanup(stop)
  return {
    url: `http://127.0.0.1:${port}/v1`,
    port,
    requests,
    heldTags: () => [...holds.keys()],
    /** A named batch of tool calls: a message carrying `QA:SCRIPT <name>` is answered with them (keeps typed prompts short). */
    script(name, calls) {
      scripts.set(name, calls)
      return `QA:SCRIPT ${name}`
    },
    release(tag) {
      const release = holds.get(tag)
      if (release === undefined) return false
      release()
      return true
    },
    stop,
  }
}

function writeSse(res, turn, model, holds) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" })
  const base = { id: "chatcmpl-qa", object: "chat.completion.chunk", created: 0, model }
  const send = (delta, finish = null) => res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`)
  const complete = () => {
    res.write(`data: ${JSON.stringify({ ...base, choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`)
    res.write("data: [DONE]\n\n")
    res.end()
  }
  send({ role: "assistant", content: "" })
  if (turn.toolCalls !== undefined) {
    send({ tool_calls: turn.toolCalls.map((call, index) => ({ index, id: `call_${randomBytes(6).toString("hex")}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } })) })
    send({}, "tool_calls")
    complete()
    return
  }
  if (turn.hold !== undefined) {
    // A held turn is visibly streaming: the first chunk arrives now, the rest on release.
    send({ content: `QA-STREAMING ${turn.hold} ` })
    const release = () => {
      holds.delete(turn.hold)
      if (res.destroyed) return
      send({ content: turn.text })
      send({}, "stop")
      complete()
      tick("model")
    }
    holds.set(turn.hold, release)
    res.once("close", () => holds.delete(turn.hold))
    return
  }
  send({ content: turn.text })
  send({}, "stop")
  complete()
}

/** Every finished model answer of a given kind, in order. */
export function answers(fake, kind) {
  return fake.requests.filter((request) => request.answer?.kind === kind).map((request) => request.answer)
}

/** Every `<tool>` result in model requests after index `from`, parsed, in call order (parallel calls included). */
export function allToolResults(fake, tool, from = 0) {
  return fake.requests
    .slice(from)
    .flatMap((request) => (request.answer?.kind === "tool_result" ? request.answer.results : []))
    .filter((entry) => entry.tool === tool)
    .map((entry) => {
      try {
        const parsed = JSON.parse(entry.result)
        return parsed?.details?.result ?? parsed?.result ?? parsed
      } catch {
        return { unparsed: entry.result }
      }
    })
}

/* ------------------------------------------------------------------ pty TUI */

let terminalModule
async function headlessTerminal(cols, rows) {
  terminalModule ??= await import(join(KIT_DIR, "node_modules", "@xterm", "headless", "lib-headless", "xterm-headless.js"))
  const Terminal = terminalModule.Terminal ?? terminalModule.default?.Terminal
  return new Terminal({ cols, rows, allowProposedApi: true, scrollback: 5000 })
}

const KEYS = { enter: "\r", escape: "\x1b", tab: "\t", backspace: "\x7f", "ctrl+c": "\x03", "ctrl+d": "\x04", "ctrl+u": "\x15", up: "\x1b[A", down: "\x1b[B" }

/**
 * One interactive `omo` in a real pty. The raw byte stream goes to `<evidence>/<label>.pty.log`; the
 * screen is an xterm emulator fed the same bytes. `keystrokes` counts every byte this harness wrote
 * to the pty, which is what "no keystroke on its pty" is asserted against.
 */
export class Tui {
  static async start(scratch, install, { label, args = [], cols = 120, rows = 40, evidence, env = {} }) {
    const term = await headlessTerminal(cols, rows)
    const tui = new Tui(label, term, evidence)
    const proc = Bun.spawn([process.env.THREAD_QA_NODE ?? "node", install.omoJs, ...args], {
      cwd: scratch.work,
      env: { ...scratch.env, ...env },
      detached: true,
      terminal: {
        cols,
        rows,
        data: (_terminal, data) => tui.#ingest(data),
      },
    })
    tui.proc = proc
    tui.pid = proc.pid
    tui.entry = track(proc, label)
    tui.exited = proc.exited.then((code) => {
      tui.exitCode = code
      tick(`exit:${label}`)
      return code
    })
    return tui
  }

  constructor(label, term, evidence) {
    this.label = label
    this.term = term
    this.raw = []
    this.keystrokes = 0
    this.logPath = evidence === undefined ? undefined : join(evidence, `${label}.pty.log`)
  }

  #ingest(data) {
    const text = typeof data === "string" ? data : Buffer.from(data).toString("utf8")
    this.raw.push(text)
    this.term.write(text, () => tick(`pty:${this.label}`))
  }

  rawText() {
    return this.raw.join("")
  }

  /** The emulator's current viewport (what a user sees right now). */
  screen() {
    const buffer = this.term.buffer.active
    const lines = []
    for (let row = 0; row < this.term.rows; row += 1) lines.push(buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? "")
    return lines.join("\n")
  }

  /** Every line the emulator holds, scrollback included. */
  history() {
    const buffer = this.term.buffer.active
    const lines = []
    for (let row = 0; row < buffer.length; row += 1) lines.push(buffer.getLine(row)?.translateToString(true) ?? "")
    return lines.join("\n")
  }

  /** The editor's text: the lines between the two horizontal rules around the `❯` prompt. */
  editorText() {
    const lines = this.screen().split("\n")
    const promptIndex = lines.findLastIndex((line) => line.startsWith("❯"))
    if (promptIndex === -1) return undefined
    const collected = []
    for (let row = promptIndex; row < lines.length; row += 1) {
      const line = lines[row]
      if (/^─{10,}/.test(line)) break
      collected.push(row === promptIndex ? line.slice(1).trim() : line.trim())
    }
    return collected.join("\n").trim()
  }

  async waitScreen(predicate, { label, timeoutMs = 60_000, scope = "screen" } = {}) {
    const test = typeof predicate === "function" ? predicate : (text) => (predicate instanceof RegExp ? predicate.test(text) : text.includes(predicate))
    return await waitFor(() => {
      if (this.exitCode !== undefined) throw new Error(`${this.label} exited (${this.exitCode}) while waiting for ${label ?? predicate}`)
      const text = scope === "history" ? this.history() : this.screen()
      return test(text) ? text : undefined
    }, { label: `${this.label}: ${label ?? String(predicate)}`, timeoutMs })
  }

  write(text) {
    this.keystrokes += Buffer.byteLength(text)
    this.proc.terminal.write(text)
  }

  /** Type text the way a user does: one write per character, each echoed before the next. */
  async type(text) {
    for (const char of text) this.write(char)
    await this.waitScreen(() => (this.editorText() ?? "").replace(/\s+/g, "").includes(text.replace(/\s+/g, "")), { label: `editor shows ${JSON.stringify(text.slice(0, 40))}`, timeoutMs: 20_000 })
  }

  press(key) {
    const sequence = KEYS[key]
    if (sequence === undefined) throw new Error(`unknown key ${key}`)
    this.write(sequence)
  }

  /** Submit a line and wait until the editor is empty again (the submission reached the session). */
  async submit(text) {
    await this.type(text)
    this.press("enter")
    await this.waitScreen(() => this.editorText() === "", { label: `editor cleared after submitting ${JSON.stringify(text.slice(0, 40))}`, timeoutMs: 30_000 })
  }

  saveLog() {
    if (this.logPath !== undefined) writeFileSync(this.logPath, this.rawText())
  }
}

/* ------------------------------------------------------------------ CLI */

/** Run `omo <args>` from the scratch work dir with the scratch env; `--json` output is parsed. */
export async function omo(scratch, install, args, { env = {}, cwd } = {}) {
  const result = await run(process.env.THREAD_QA_NODE ?? "node", [install.omoJs, ...args], { cwd: cwd ?? scratch.work, env: { ...scratch.env, ...env } })
  let json
  const trimmed = result.stdout.trim()
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      json = JSON.parse(trimmed)
    } catch {
      json = undefined
    }
  }
  return { ...result, json }
}

/**
 * A Desktop-thread shard host (`i-*`), started the way the Desktop starts one: the engine names the
 * shard path (`omo host shard-path --kind i`) and ensures a host there from omo's launch spec, so the
 * host loads the same (patched) plugin as the terminals.
 */
export async function startShardHost(scratch, install, owner) {
  const shard = await omo(scratch, install, ["host", "shard-path", "--kind", "i", "--owner", owner, "--json"])
  const socket = shard.json?.socket ?? shard.json?.path ?? shard.stdout.trim().split("\n").pop()
  if (typeof socket !== "string" || !socket.endsWith(".sock")) throw new Error(`shard-path answered ${shard.code}: ${shard.stdout} ${shard.stderr}`)
  const ensured = await omo(scratch, install, ["host", "ensure", "--launch-spec", join(install.plugin, "daemon-launch-spec.json"), "--policy", "upgrade", "--socket", socket, "--json"])
  if (ensured.code !== 0) throw new Error(`host ensure ${socket} exited ${ensured.code}: ${ensured.stdout} ${ensured.stderr.slice(-800)}`)
  const client = await EndpointClient.connect(socket, `shard-${owner}`)
  return { socket, client, ensured: ensured.json }
}

/** Open a session on a host and return both identities plus its file. */
export async function openHostSession(client, cwd, extra = {}) {
  const opened = await client.request({ type: "open_session", cwd, retain_on_disconnect: true, ...extra })
  if (opened.success !== true) throw new Error(`open_session failed: ${JSON.stringify(opened.error ?? opened)}`)
  const routingId = opened.data.sessionId
  const listed = await client.request({ type: "list_sessions" })
  const row = listed.data.sessions.find((session) => session.sessionId === routingId)
  return { routingId, durableId: row?.durableSessionId ?? opened.data.state?.sessionId, sessionPath: row?.sessionPath ?? opened.data.state?.sessionFile, row }
}

/** `omo thread send <target> <text> --json` from the sandbox (principal `cli:<uid>`). */
export async function cliSend(scratch, install, target, text, args = [], options = {}) {
  return await omo(scratch, install, ["thread", "send", target, text, "--json", ...args], options)
}

/* ------------------------------------------------------------------ endpoint client */

let socketTransport
async function engineSocketTransport() {
  socketTransport ??= await import(join(KIT_DIR, "node_modules", "@code-yeongyu", "senpi", "dist", "modes", "rpc", "socket-transport.js"))
  return socketTransport
}

/**
 * JSONL client for a terminal's control endpoint or a host socket, with the engine's own secret
 * handshake (the 32 bytes of `<socket>.secret` when that file exists). Records land in `records`
 * and tick the bus, so feed events can be awaited like anything else.
 */
export class EndpointClient {
  static async connect(socketPath, label = "endpoint") {
    const transport = await engineSocketTransport()
    const secretPath = transport.socketSecretPath(socketPath)
    const secret = existsSync(secretPath) ? await transport.readSocketSecret(secretPath) : undefined
    const socket = createConnection(socketPath)
    await new Promise((resolvePromise, rejectPromise) => {
      socket.once("connect", resolvePromise)
      socket.once("error", rejectPromise)
    })
    if (secret !== undefined) transport.sendSocketHandshake(socket, secret)
    const client = new EndpointClient(socket, label)
    onCleanup(() => client.close())
    return client
  }

  constructor(socket, label) {
    this.socket = socket
    this.label = label
    this.records = []
    this.buffer = ""
    this.sequence = 0
    this.closed = false
    socket.on("data", (chunk) => {
      this.buffer += chunk.toString("utf8")
      for (;;) {
        const newline = this.buffer.indexOf("\n")
        if (newline < 0) break
        const line = this.buffer.slice(0, newline).trim()
        this.buffer = this.buffer.slice(newline + 1)
        if (line.length === 0) continue
        try {
          this.records.push(JSON.parse(line))
        } catch {
          continue
        }
      }
      tick(`endpoint:${label}`)
    })
    socket.on("error", () => undefined)
    socket.once("close", () => {
      this.closed = true
      tick(`endpoint:${label}`)
    })
  }

  async request(command, { timeoutMs = 30_000 } = {}) {
    this.sequence += 1
    const id = `${this.label}-${this.sequence}`
    this.socket.write(`${JSON.stringify({ id, ...command })}\n`)
    return await waitFor(() => {
      const found = this.records.find((record) => record.type === "response" && record.id === id)
      if (found !== undefined) return found
      if (this.closed) throw new Error(`${this.label}: connection closed before ${command.type} answered`)
      return undefined
    }, { label: `${this.label} ${command.type}`, timeoutMs })
  }

  close() {
    if (!this.closed) this.socket.destroy()
  }
}

/* ------------------------------------------------------------------ registry, store, session file */

/** Every endpoint record of the agent dir's registry (`rpc-host-daemon/<16hex>/endpoint.json`). */
export function registryEndpoints(agentDir) {
  const root = join(agentDir, "rpc-host-daemon")
  if (!existsSync(root)) return []
  const endpoints = []
  for (const name of readdirSync(root)) {
    const path = join(root, name, "endpoint.json")
    if (!existsSync(path)) continue
    try {
      endpoints.push({ dir: join(root, name), ...JSON.parse(readFileSync(path, "utf8")) })
    } catch {
      // A record mid-write is read again on the next tick.
    }
  }
  return endpoints
}

/**
 * The terminal a pty TUI registered: waits for a new `tui` registry record, then asks its endpoint
 * for the one session row. Returns `{ socket, durableId, sessionPath, row }`.
 */
export async function awaitTuiEndpoint(scratch, tui, { exclude = [], timeoutMs = 60_000 } = {}) {
  const record = await waitFor(() => {
    if (tui.exitCode !== undefined) throw new Error(`${tui.label} exited (${tui.exitCode}) before registering its endpoint`)
    return registryEndpoints(scratch.agentDir).find((endpoint) => endpoint.endpoint_kind === "tui" && !exclude.includes(endpoint.socket) && existsSync(endpoint.socket))
  }, { label: `${tui.label} registers a tui endpoint`, timeoutMs })
  const client = await EndpointClient.connect(record.socket, `${tui.label}-ctl`)
  const listed = await client.request({ type: "list_sessions" })
  const row = listed.data?.sessions?.[0]
  if (row === undefined) throw new Error(`${tui.label}: endpoint listed no session: ${JSON.stringify(listed)}`)
  const state = await client.request({ type: "get_state" })
  return {
    socket: record.socket,
    client,
    row,
    durableId: row.durableId ?? row.durable_id ?? row.sessionId ?? state.data?.sessionId,
    sessionPath: row.sessionFile ?? row.session_path ?? row.path ?? state.data?.sessionFile,
    state: state.data,
  }
}

let sqlite
async function openStore(agentDir) {
  sqlite ??= await import("bun:sqlite")
  const path = join(agentDir, "gateway", "gateway.sqlite")
  if (!existsSync(path)) return undefined
  // A WAL reader must be able to map the `-shm` file, which a `readonly` open cannot create; the
  // connection is read-write at the file level but `query_only`, so it can never write the store.
  const db = new sqlite.Database(path)
  db.exec("PRAGMA query_only = 1")
  return db
}

/** Rows of the gateway store through a `query_only` connection (the store is WAL; a reader takes no write lock). */
export async function storeRows(agentDir, sql, params = []) {
  const db = await openStore(agentDir)
  if (db === undefined) return []
  try {
    return db.query(sql).all(...params)
  } finally {
    db.close()
  }
}

export async function deliveryRow(agentDir, deliveryId) {
  return (await storeRows(agentDir, "SELECT * FROM deliveries WHERE delivery_id = ?", [deliveryId]))[0]
}

/** Parsed JSONL entries of a session file (a partial trailing line is ignored). */
export function sessionEntries(path) {
  if (path === undefined || path === null || !existsSync(path)) return []
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)]
      } catch {
        return []
      }
    })
}

const DELIVERY_TYPE = "session_control_delivery"

/**
 * The admitted-delivery entries of a session file: the engine writes each as a `custom` message
 * (`role: "custom"`, `customType: "session_control_delivery"`, `details.delivery_id`).
 */
export function deliveryEntries(path) {
  return sessionEntries(path).filter((entry) => entry.customType === DELIVERY_TYPE || entry.message?.customType === DELIVERY_TYPE)
}

export function deliveryIdOf(entry) {
  const details = entry?.message?.details ?? entry?.details ?? entry?.data
  return details?.delivery_id
}

export function assistantTexts(path) {
  return sessionEntries(path)
    .filter((entry) => entry.type === "message" && entry.message?.role === "assistant")
    .map((entry) => (Array.isArray(entry.message.content) ? entry.message.content.map((part) => part.text ?? "").join("") : String(entry.message.content ?? "")))
}

/* ------------------------------------------------------------------ cleanup receipt */

function capture(command, args) {
  const result = Bun.spawnSync([command, ...args])
  return result.stdout.toString()
}

/**
 * Tear everything down, then PROVE it: no process whose command line names the scratch dir, no unix
 * socket under it held by anyone, the fake model's port closed, the scratch tree gone. Written to
 * `<evidence>/cleanup-receipt.json` and asserted as `cleanup-no-leftovers`.
 */
export async function finishWithReceipt(report, { scratch, fake, evidence, extra = {} }) {
  const pids = [...children].map((entry) => ({ label: entry.label, pid: entry.pid }))
  await cleanupAll()
  const scratchDir = scratch?.dir
  const survivors = scratchDir === undefined ? [] : capture("pgrep", ["-f", scratchDir]).split("\n").map((line) => line.trim()).filter(Boolean)
  const unixHolders = scratchDir === undefined ? [] : capture("lsof", ["-U"]).split("\n").filter((line) => line.includes(scratchDir))
  const portHolders = fake === undefined ? [] : capture("lsof", ["-a", "-i", `TCP:${fake.port}`, "-sTCP:LISTEN", "-t"]).split("\n").map((line) => line.trim()).filter(Boolean)
  const scratchLeft = scratchDir !== undefined && existsSync(scratchDir)
  const receipt = {
    scenario: report.label,
    at: new Date().toISOString(),
    killed: pids,
    swept_sandbox_pids: [...swept],
    pids_alive: pids.filter((entry) => alive(entry.pid)).map((entry) => entry.pid),
    pgrep_scratch: survivors,
    lsof_unix_scratch: unixHolders,
    lsof_fake_port: portHolders,
    scratch_dir: scratchDir ?? null,
    scratch_removed: !scratchLeft,
    ...extra,
  }
  if (evidence !== undefined) writeFileSync(join(evidence, "cleanup-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`)
  report.assert(
    "cleanup-no-leftovers",
    receipt.pids_alive.length === 0 && survivors.length === 0 && unixHolders.length === 0 && portHolders.length === 0 && !scratchLeft,
    `pids_alive=${JSON.stringify(receipt.pids_alive)} pgrep=${JSON.stringify(survivors)} lsof_unix=${unixHolders.length} lsof_port=${portHolders.length} scratch_removed=${!scratchLeft}`,
  )
  return receipt
}

/** Write the scenario's machine-readable result next to its text log. */
export function writeResult(report, evidence, extra = {}) {
  if (evidence === undefined) return
  writeFileSync(join(evidence, "result.json"), `${JSON.stringify({ scenario: report.label, failures: report.failures, skipped: report.skipped, product_defects: report.defects, steps: report.steps, ...extra }, null, 2)}\n`)
  writeFileSync(join(evidence, "report.txt"), `${report.lines.join("\n")}\n`)
  const out = flag("--out")
  if (out !== undefined) {
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, `${report.lines.join("\n")}\n`)
  }
}

/** The next `<tool>` result the fake model sees after request index `from`, parsed. */
export async function awaitToolResult(fake, tool, from, { timeoutMs = 60_000, label } = {}) {
  return await waitFor(() => {
    const found = fake.requests.slice(from).find((request) => request.answer?.kind === "tool_result" && request.answer.tool === tool)
    if (found === undefined) return undefined
    try {
      const parsed = JSON.parse(found.answer.result)
      return parsed?.details?.result ?? parsed?.result ?? parsed
    } catch {
      return { unparsed: found.answer.result }
    }
  }, { label: label ?? `${tool} result`, timeoutMs })
}

/**
 * The frame every scenario runs in: kit + patched install, fake model, sandbox, then `body`, then
 * teardown with a proven cleanup receipt, whatever happened in between. Exits 0 only when every
 * assertion (the receipt included) passed.
 */
export async function runScenario(label, body, { patches = [], installName } = {}) {
  installCleanupHooks()
  const report = createReport(label)
  const evidence = evidenceDir(label)
  const ctx = { report, evidence, tuis: [], label }
  ctx.startTui = async (tuiLabel, options = {}) => {
    const tui = await Tui.start(ctx.scratch, options.install ?? ctx.install, { label: tuiLabel, evidence, ...options })
    ctx.tuis.push(tui)
    return tui
  }
  try {
    ctx.install = await buildOmoInstall(installName ?? `omo-ai-${label}`, patches)
    ctx.fake = await startFakeModel()
    ctx.scratch = makeScratch(label, ctx.fake)
    report.log(`engine senpi ${ENGINE_VERSION} install=${ctx.install.root} patches=${ctx.install.patches.map((patch) => patch.patch).join(",")} scratch=${ctx.scratch.dir}`)
    await body(ctx)
  } catch (error) {
    report.assert("scenario-completed", false, error instanceof Error ? (error.stack ?? error.message).split("\n").slice(0, 6).join(" | ") : String(error))
  } finally {
    for (const tui of ctx.tuis) {
      tui.saveLog()
      if (evidence !== undefined) writeFileSync(join(evidence, `${tui.label}.screen.txt`), tui.history())
    }
    await finishWithReceipt(report, { scratch: ctx.scratch, fake: ctx.fake, evidence })
    writeResult(report, evidence, { engine: ENGINE_VERSION, patches: ctx.install?.patches ?? [], evidence })
    report.log(`${label} failures=${report.failures} skipped=${report.skipped} evidence=${evidence}`)
  }
  process.exit(report.failures === 0 ? 0 : 1)
}

/**
 * Screenshot a terminal byte stream through a real xterm.js terminal in a headless browser
 * (`Bun.WebView`, system WebKit on macOS): the same bytes the pty produced, rendered true-color.
 * Resolves once xterm.js reports the write parsed and a frame was painted.
 */
export async function renderTerminalPng(raw, pngPath, { cols = 120, rows = 40 } = {}) {
  const xterm = join(KIT_DIR, "node_modules", "@xterm", "xterm")
  const script = readFileSync(join(xterm, "lib", "xterm.js"), "utf8")
  const css = readFileSync(join(xterm, "css", "xterm.css"), "utf8")
  const page = `<!doctype html><html><head><meta charset="utf-8"><style>${css}
html,body{margin:0;background:#1e1e1e}#t{padding:8px}</style><script>${script}</script></head><body><div id="t"></div><script>
const term = new Terminal({ cols: ${cols}, rows: ${rows}, fontSize: 14, fontFamily: 'Menlo, monospace', allowProposedApi: true, theme: { background: '#1e1e1e' } });
term.open(document.getElementById('t'));
window.__render = (data) => new Promise((done) => term.write(data, () => requestAnimationFrame(() => requestAnimationFrame(() => done('rendered')))));
</script></body></html>`
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } }) })
  const view = new Bun.WebView({ width: Math.ceil(cols * 8.5) + 32, height: rows * 17 + 32 })
  try {
    await view.navigate(`http://127.0.0.1:${server.port}/`)
    const state = await view.evaluate(`window.__render(${JSON.stringify(raw)})`)
    if (state !== "rendered") throw new Error(`xterm.js render answered ${JSON.stringify(state)}`)
    const shot = await view.screenshot()
    await Bun.write(pngPath, shot)
    return { path: pngPath, bytes: shot.size }
  } finally {
    view.close?.()
    server.stop(true)
  }
}

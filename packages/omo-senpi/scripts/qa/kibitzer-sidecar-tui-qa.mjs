#!/usr/bin/env bun
// allow: SIZE_OK - one auditable live-terminal proof: sandbox, mock provider, PTY, xterm.js renderer,
// rendered-text signals, evidence capture and teardown are one indivisible lifecycle.
//
// Live terminal proof of the resident Kibitzer sidecar (plan .omo/plans/kibitzer-resident-sidecar.md,
// verification strategy item (e) and todo 20): the REAL senpi TUI runs the built plugin artifact
// inside a real pseudo-terminal against the mock openai-completions provider, the user asks about a
// rollout, the sidecar wakes on the fresh candidate and nudges, and the parent session SHOWS the
// Kibitzer recollection notice - `✦ Kibitzer !` over `recalled memory: <hint>` - on the next turn.
//
// The terminal is a Bun-native PTY (`Bun.spawn` with the `terminal` option; node-pty's socket never
// delivers data under bun, so the PTY the other lanes take from node-pty comes from Bun here). Its
// byte stream is rendered by a REAL xterm.js terminal in headless Chrome (puppeteer-core drives the
// system Chrome, the same path as script/qa/web-terminal-visual-qa.mjs), so terminal.txt is what
// xterm.js has on screen and terminal.png is that screen, true color, never tmux.
//
// Every wait is a signal with a bounded timeout: a rendered-text predicate re-evaluated after each
// PTY chunk lands in xterm.js, a filesystem change under the sandbox, or a process exit. Nothing
// sleeps for a fixed interval. The TUI, the browser, the mock server and the sandbox are torn down
// on success, on failure and on SIGINT/SIGTERM, and every receipt lands in the summary.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { startMockCompletionsServer } from "./mock-completions-server.mjs"
import {
  DEFAULT_PLUGIN_ROOT,
  DEFAULT_SENPI_CLI,
  EXIT_TIMEOUT_MS,
  MEMORIES,
  SIDECAR_TOOL_NAMES,
  TURN_TIMEOUT_MS,
  WAKE_TIMEOUT_MS,
  assertSandboxEnv,
  childTranscripts,
  createCleanup,
  createRouter,
  encodeSidecarDirName,
  installInterruptCleanup,
  isNudged,
  isRecall,
  leaseFiles,
  messageText,
  nudgeStep,
  nudgedPaths,
  pendingFile,
  prepareSandbox,
  readEntries,
  removeSandbox,
  requestSystemText,
  resolveCommand,
  sameNames,
  sandboxEnv,
  seedMemories,
  sidecarDirs,
  toolCallsOf,
  waitForAccepted,
  watchUntil,
  writeEvidence,
  writeOmoConfig,
} from "./kibitzer-sidecar-support.mjs"

const require = createRequire(import.meta.url)

export const DRIVER = "kibitzer-sidecar-tui-qa"
export const PROBE_LAYER = "probe"
export const RUNTIME_LAYER = "host-runtime"
/** What kibitzer/notice.ts draws for an `omo-kibitzer:nudged` entry: glyph + fixed title, then the why line. */
export const NOTICE_GLYPH = "✦"
export const NOTICE_TITLE = "Kibitzer !"
export const RECALLED_PREFIX = "recalled memory: "
export const EDITOR_PROMPT = "❯"
/** The memory status footer (`mem:<identity> <age>`, components/memory/status.ts): drawn once the omo extension has bound the identity, which is after senpi enabled real submission. */
export const MEMORY_STATUS_PREFIX = "mem:"
export const WORKING_MARKER = "esc to interrupt"
/** Carries no recall candidate (the corpus holds the rollout memory and the memory-discipline skill), so turn 2 only drains the held nudge. */
export const FOLLOW_UP_PROMPT = "Go ahead."
export const PARENT_ANSWERS = ["Checking the rollout playbook.", "Noted - drain first, and never during an incident."]
/**
 * Interactive senpi titles a session in the background with a provider call of its own after the
 * first turn (core/session-title-generator.js) and retries at every turn end until a title parses.
 * Answered on a lane of its own so it neither consumes the parent's script nor counts as a turn.
 */
export const TITLE_REQUEST_MARKER = "Generate a concise title for this coding-agent session."
export const SESSION_TITLE = "Resident Kibitzer TUI QA"
export const titleLane = () => ({ name: "title", matches: (body) => requestSystemText(body).includes(TITLE_REQUEST_MARKER), step: () => ({ type: "text", text: `<title>${SESSION_TITLE}</title>` }) })
export const READY_TIMEOUT_MS = 60_000
export const RENDER_TIMEOUT_MS = 60_000

const checks = []
const signals = []

function record(layer, name, ok, detail) {
  checks.push({ layer, name, ok, detail })
  console.log(`${ok ? "PASS" : "FAIL"} [${layer}] ${name} :: ${detail}`)
  return ok
}

/** Awaits a signal and keeps how long it took: the timings are evidence that nothing here is a fixed sleep. */
async function signal(name, promise) {
  const started = Date.now()
  const value = await promise
  signals.push({ name, ms: Date.now() - started })
  return value
}

// ---- arguments -----------------------------------------------------------------------------------------

export function parseArgs(argv) {
  const options = { pluginRoot: DEFAULT_PLUGIN_ROOT, senpiCli: DEFAULT_SENPI_CLI, commandFile: undefined, evidenceDir: undefined, cols: 120, rows: 40, chromeBin: undefined, keepSandbox: false, selfTest: false }
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
    else if (arg === "--evidence-dir") options.evidenceDir = resolve(take())
    else if (arg === "--cols") options.cols = positiveInt(arg, take())
    else if (arg === "--rows") options.rows = positiveInt(arg, take())
    else if (arg === "--chrome-bin") options.chromeBin = resolve(take())
    else if (arg === "--keep-sandbox") options.keepSandbox = true
    else if (arg === "--self-test") options.selfTest = true
    else throw new Error(`unknown argument ${arg}`)
  }
  if (!options.selfTest && options.evidenceDir === undefined) throw new Error("--evidence-dir <dir> is required (receives terminal.png, terminal.txt, metadata.json)")
  return options
}

function positiveInt(name, value) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`)
  return parsed
}

export function resolveChrome(explicit, env = process.env, platform = process.platform) {
  const candidates = [explicit, env.CHROME_BIN, env.GOOGLE_CHROME_BIN]
  if (platform === "darwin") candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium")
  if (platform === "linux") candidates.push("/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser")
  return candidates.find((candidate) => typeof candidate === "string" && candidate.length > 0 && existsSync(candidate))
}

// ---- the xterm.js renderer ---------------------------------------------------------------------------------

export function buildPageHtml({ xtermJs, xtermCss, unicodeJs, cols, rows, fontSize }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${xtermCss}
html,body{margin:0;padding:0;background:#0b0e14}
#t{padding:8px}
</style></head><body><div id="t"></div>
<script>${xtermJs}</script>
<script>${unicodeJs}</script>
<script>
  const term = new Terminal({
    cols: ${cols}, rows: ${rows}, fontSize: ${fontSize},
    fontFamily: 'Menlo, "DejaVu Sans Mono", "Noto Sans Mono CJK KR", monospace',
    allowProposedApi: true, convertEol: false, scrollback: 4000,
    theme: { background: '#0b0e14', foreground: '#d7dae0' },
  });
  try { const u = new Unicode11Addon.Unicode11Addon(); term.loadAddon(u); term.unicode.activeVersion = '11'; } catch (e) {}
  term.open(document.getElementById('t'));
  // Resolves once xterm.js has PARSED the chunk, so a snapshot taken afterwards is the rendered state.
  window.__write = (d) => new Promise((done) => term.write(d, done));
  window.__snapshot = () => {
    const b = term.buffer.active;
    const lines = [];
    for (let i = 0; i < b.length; i++) { const ln = b.getLine(i); lines.push(ln ? ln.translateToString(true) : ''); }
    const viewport = lines.slice(b.viewportY, b.viewportY + term.rows);
    const trim = (arr) => { const copy = arr.slice(); while (copy.length > 0 && copy[copy.length - 1] === '') copy.pop(); return copy.join('\\n'); };
    return { viewport: trim(viewport), buffer: trim(lines), viewportY: b.viewportY, rows: term.rows, cols: term.cols };
  };
  window.__settled = () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  term.focus();
</script></body></html>`
}

/**
 * A real xterm.js terminal in headless Chrome. `write` feeds PTY bytes in order and re-evaluates every
 * pending screen waiter once xterm.js has parsed them; `waitForScreen` resolves with the first snapshot
 * a predicate accepts, or rejects after `timeoutMs` with the tail of the last screen for diagnosis.
 */
export async function openRenderer({ executablePath, cols, rows }) {
  const puppeteer = (await import("puppeteer-core")).default
  const asset = (spec) => readFileSync(require.resolve(spec), "utf8")
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--force-color-profile=srgb"],
    defaultViewport: { width: cols * 10 + 40, height: rows * 20 + 40, deviceScaleFactor: 2 },
    // The cleanup registry owns teardown order (TUI first, then the browser); puppeteer's own
    // signal handlers would close Chrome under a still-running TUI on SIGINT/SIGTERM.
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  })
  const page = await browser.newPage()
  await page.setContent(buildPageHtml({ xtermJs: asset("@xterm/xterm/lib/xterm.js"), xtermCss: asset("@xterm/xterm/css/xterm.css"), unicodeJs: asset("@xterm/addon-unicode11/lib/addon-unicode11.js"), cols, rows, fontSize: 15 }), { waitUntil: "load" })
  await page.evaluate(() => document.fonts && document.fonts.ready)

  const waiters = []
  let chain = Promise.resolve()
  let latest = { viewport: "", buffer: "", viewportY: 0, rows, cols }
  let closed = false
  let rendererError
  const snapshot = async () => {
    latest = await page.evaluate(() => window.__snapshot())
    return latest
  }
  const settleWaiters = () => {
    for (const waiter of [...waiters]) {
      let value
      try { value = waiter.predicate(latest) } catch (error) { value = undefined; waiter.fail(error); continue }
      if (value === undefined || value === false) continue
      waiter.fulfil(value)
    }
  }
  return {
    write(text) {
      chain = chain.then(async () => {
        if (closed) return
        await page.evaluate((chunk) => window.__write(chunk), text)
        if (waiters.length === 0) return
        await snapshot()
        settleWaiters()
      }).catch((error) => { rendererError = error })
      return chain
    },
    async waitForScreen(predicate, { timeoutMs, description }) {
      await chain
      if (rendererError !== undefined) throw rendererError
      const first = predicate(await snapshot())
      if (first !== undefined && first !== false) return first
      return new Promise((resolvePromise, reject) => {
        const waiter = { predicate, fulfil: undefined, fail: undefined, timer: undefined }
        const remove = () => { clearTimeout(waiter.timer); const index = waiters.indexOf(waiter); if (index >= 0) waiters.splice(index, 1) }
        waiter.fulfil = (value) => { remove(); resolvePromise(value) }
        waiter.fail = (error) => { remove(); reject(error) }
        waiter.timer = setTimeout(() => waiter.fail(new Error(`${description} timed out after ${timeoutMs}ms; screen tail=${JSON.stringify(latest.viewport.split("\n").slice(-8).join("\n"))}`)), timeoutMs)
        waiters.push(waiter)
      })
    },
    snapshot,
    latest: () => latest,
    async screenshot() {
      await chain
      await page.evaluate(() => window.__settled())
      const element = await page.$(".xterm")
      if (element === null) throw new Error("xterm.js did not mount")
      return element.screenshot({ type: "png" })
    },
    async close() {
      closed = true
      for (const waiter of [...waiters]) waiter.fail(new Error("renderer closed"))
      await browser.close()
      return "browser closed"
    },
  }
}

// ---- the PTY -------------------------------------------------------------------------------------------------

/** The real TUI in a Bun-native pseudo-terminal; every chunk is decoded as a stream so a glyph split across reads survives. */
export function launchTui(command, sandbox, env, { cols, rows }, onData) {
  const decoder = new TextDecoder("utf-8")
  return Bun.spawn([command.file, ...command.prefix, "--provider", "omo-mock", "--model", "mock-1", "--session-dir", sandbox.sessionsDir], {
    cwd: sandbox.cwd,
    env: { ...env, TERM: "xterm-256color", COLORTERM: "truecolor", LANG: env.LANG ?? "en_US.UTF-8" },
    terminal: {
      cols,
      rows,
      data(_terminal, chunk) { onData(decoder.decode(chunk, { stream: true })) },
    },
  })
}

function exitedWithin(proc, timeoutMs) {
  if (proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve(true)
  return new Promise((resolvePromise) => {
    const timer = setTimeout(() => resolvePromise(false), timeoutMs)
    proc.exited.then(() => { clearTimeout(timer); resolvePromise(true) })
  })
}

/** `/quit` first (senpi honours it even mid-startup), then SIGTERM, then SIGKILL; the PTY master is closed once the process is gone. */
export async function quitTui(proc) {
  const receipt = await (async () => {
    if (proc.exitCode !== null || proc.signalCode !== null) return `pid ${proc.pid} already exited (code=${proc.exitCode} signal=${proc.signalCode})`
    try { proc.terminal.write("/quit\r") } catch { /* pty already closed */ }
    if (await exitedWithin(proc, EXIT_TIMEOUT_MS)) return `pid ${proc.pid} exited on /quit`
    proc.kill("SIGTERM")
    if (await exitedWithin(proc, EXIT_TIMEOUT_MS)) return `pid ${proc.pid} exited after SIGTERM`
    proc.kill("SIGKILL")
    await exitedWithin(proc, EXIT_TIMEOUT_MS)
    return `pid ${proc.pid} killed`
  })()
  try { proc.terminal.close() } catch { /* already closed */ }
  return `${receipt}; pty closed`
}

// ---- readers ---------------------------------------------------------------------------------------------------

export function listSessionFiles(dir) {
  if (!existsSync(dir)) return []
  const files = []
  const walk = (current) => {
    for (const name of readdirSync(current)) {
      const path = join(current, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (name.endsWith(".jsonl")) files.push(path)
    }
  }
  walk(dir)
  return files.sort()
}

/** The parent session the TUI opened: the first new JSONL under the session dir whose header carries a session id. */
export function findNewSession(dir, before) {
  for (const file of listSessionFiles(dir).filter((path) => !before.has(path))) {
    const header = readEntries(file)[0]
    if (header?.type === "session" && typeof header.id === "string") return { sessionId: header.id, sessionFile: file }
  }
  return undefined
}

export function linesContaining(text, needle) {
  return text.split("\n").filter((line) => line.includes(needle)).map((line) => line.trimEnd())
}

export const recalledLine = (memory) => `${RECALLED_PREFIX}${memory.body}`
/**
 * The editor glyph and model footer are drawn BEFORE senpi enables submission (a prompt entered then
 * is parked with "Startup is still in progress"); the memory status footer only appears once the omo
 * extension's session start has run, which is after submission was enabled.
 */
export const isReady = (screen) => (screen.viewport.includes(EDITOR_PROMPT) && screen.viewport.includes("mock-1") && screen.viewport.includes(MEMORY_STATUS_PREFIX) ? screen : undefined)
export const isIdleWith = (text) => (screen) => (screen.buffer.includes(text) && !screen.viewport.includes(WORKING_MARKER) ? screen : undefined)
export const showsNotice = (memory) => (screen) => (screen.buffer.includes(NOTICE_TITLE) && screen.buffer.includes(recalledLine(memory)) && screen.buffer.includes(PARENT_ANSWERS[1]) && !screen.viewport.includes(WORKING_MARKER) ? screen : undefined)

// ---- main ----------------------------------------------------------------------------------------------------

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.selfTest) { runSelfTest(); return }
  const cleanup = createCleanup()
  installInterruptCleanup(() => [cleanup])
  let interrupted
  for (const name of ["SIGINT", "SIGTERM"]) process.once(name, () => { interrupted = name })
  const router = createRouter({ lanes: [titleLane()] })
  const facts = { pluginRoot: options.pluginRoot, geometry: { cols: options.cols, rows: options.rows } }
  const evidence = options.evidenceDir
  let identity
  let state
  let raw = ""
  let screen
  let tui
  try {
    // ---- probe layer: everything the proof needs before the binary is judged ---------------------------
    let command
    try {
      command = resolveCommand(options)
      facts.command = command.display
      facts.commandSource = command.source
      record(PROBE_LAYER, "command-resolved", true, `${command.display} (${command.source})`)
    } catch (error) {
      record(PROBE_LAYER, "command-resolved", false, error instanceof Error ? error.message : String(error))
    }
    record(PROBE_LAYER, "artifact-present", existsSync(join(options.pluginRoot, "extensions", "omo.js")), `${join(options.pluginRoot, "extensions", "omo.js")}`)
    const chrome = resolveChrome(options.chromeBin)
    facts.chrome = chrome
    record(PROBE_LAYER, "chrome-resolved", chrome !== undefined, chrome ?? "no Chrome/Chromium found; pass --chrome-bin or set CHROME_BIN")
    if (checks.some((check) => !check.ok)) return finish()

    const server = startMockCompletionsServer({ steps: router.steps, requestLogPath: writeEvidence(evidence, "tui-mock-requests.jsonl", ""), classifyRequest: router.classify })
    cleanup.add("mock server", () => { server.close(); return "closed" })
    const baseUrl = await server.ready
    const sandbox = prepareSandbox(options.pluginRoot, baseUrl)
    cleanup.add("sandbox", () => removeSandbox(sandbox, options.keepSandbox))
    const env = sandboxEnv(sandbox)
    assertSandboxEnv(sandbox, env)
    facts.sandboxRoot = sandbox.root
    record(PROBE_LAYER, "mock-provider-ready", true, `baseUrl=${baseUrl} sandbox=${sandbox.root}`)

    // ---- host/runtime layer: the corpus is seeded through the real memory tool, recall is switched on ------
    const seed = await seedMemories(command, sandbox, env, router, [MEMORIES.rollout])
    facts.seed = { sessionId: seed.sessionId, identities: seed.identities, results: seed.results, teardown: seed.teardown }
    if (!record(RUNTIME_LAYER, "memory-seeded", seed.ok, seed.ok ? `identity=${seed.identities[0]}` : `results=${JSON.stringify(seed.results)} identities=${seed.identities.length} stderr=${seed.stderr?.replace(/\n/g, " | ")}`)) return finish()
    identity = seed.identities[0]
    const seedRequests = router.state.parent
    writeOmoConfig(sandbox, { recallEnabled: true })
    router.setParentSteps(PARENT_ANSWERS.map((text) => ({ type: "text", text })))
    router.setSidecarSteps([nudgeStep(MEMORIES.rollout)])

    // ---- the terminal: xterm.js first, then the TUI in its PTY streaming into it ------------------------------
    const renderer = await openRenderer({ executablePath: chrome, cols: options.cols, rows: options.rows })
    cleanup.add("browser", () => renderer.close())
    const before = new Set(listSessionFiles(sandbox.sessionsDir))
    tui = launchTui(command, sandbox, env, options, (text) => { raw += text; void renderer.write(text) })
    cleanup.add("tui", () => quitTui(tui))
    facts.pid = tui.pid
    screen = await signal("tui-ready", renderer.waitForScreen(isReady, { timeoutMs: READY_TIMEOUT_MS, description: "TUI ready (editor glyph, model footer and memory status footer)" }))
    record(RUNTIME_LAYER, "tui-ready", true, `pid=${tui.pid} rows=${screen.rows} cols=${screen.cols}`)

    // Turn 1: the fresh candidate. The typed text is awaited on screen before Enter, so the editor - not
    // the line discipline - is what received it.
    tui.terminal.write(MEMORIES.rollout.prompt)
    await signal("prompt-1-echoed", renderer.waitForScreen((current) => (current.viewport.includes(MEMORIES.rollout.prompt) ? current : undefined), { timeoutMs: RENDER_TIMEOUT_MS, description: "first prompt echoed by the editor" }))
    tui.terminal.write("\r")
    state = await signal("parent-session-file", watchUntil(sandbox.sessionsDir, () => findNewSession(sandbox.sessionsDir, before), { timeoutMs: TURN_TIMEOUT_MS, description: "parent session file" }))
    facts.sessionId = state.sessionId
    facts.sessionFile = state.sessionFile
    record(RUNTIME_LAYER, "session-identified", true, `sessionId=${state.sessionId} file=${state.sessionFile}`)
    const [held] = await Promise.all([
      signal("wake-accepted", waitForAccepted(identity, state, MEMORIES.rollout, { timeoutMs: WAKE_TIMEOUT_MS, description: "TUI wake 1: accepted nudge" })),
      signal("parent-answer-1-rendered", renderer.waitForScreen(isIdleWith(PARENT_ANSWERS[0]), { timeoutMs: TURN_TIMEOUT_MS, description: "first parent answer rendered and the turn settled" })),
    ])
    const lineages = sidecarDirs(identity)
    const transcripts = lineages[0] === undefined ? [] : childTranscripts(lineages[0].dir)
    const seedText = messageText(transcripts[0]?.users[0])
    const nudgeCall = transcripts[0]?.assistants.flatMap(toolCallsOf).find((call) => call.name === "nudge")
    const registry = router.state.sidecarRequests[0]?.toolNames ?? []
    record(RUNTIME_LAYER, "wake-accepted", held.nudges.length === 1 && held.nudges[0].path === MEMORIES.rollout.path && held.nudges[0].hint === MEMORIES.rollout.body, `via=${held.via} held=${JSON.stringify(held.nudges)}`)
    record(RUNTIME_LAYER, "one-resident-child", lineages.length === 1 && lineages[0].name === encodeSidecarDirName(state.sessionId) && transcripts.length === 1, `lineages=${lineages.length} generations=${transcripts.length} dir=${lineages[0]?.name}`)
    record(RUNTIME_LAYER, "seed-envelope", seedText.startsWith("<kibitzer-seed ") && seedText.includes(`<candidate path="${MEMORIES.rollout.path}"`), `head=${JSON.stringify(seedText.slice(0, 100))}`)
    record(RUNTIME_LAYER, "child-called-nudge", nudgeCall?.arguments?.path === MEMORIES.rollout.path, `nudge=${JSON.stringify(nudgeCall?.arguments ?? null)}`)
    record(RUNTIME_LAYER, "registry-on-the-wire", router.state.sidecar === 1 && sameNames(registry, SIDECAR_TOOL_NAMES), `sidecarRequests=${router.state.sidecar} tools=[${registry.join(",")}]`)

    // Turn 2: the held nudge is drained into the parent as the turn opens and its notice is drawn. A
    // nudge that was already steered into the running first turn needs no second prompt.
    const steered = readEntries(state.sessionFile).filter(isNudged).length > 0
    facts.deliveredDuringFirstTurn = steered
    if (!steered) {
      tui.terminal.write(FOLLOW_UP_PROMPT)
      await signal("prompt-2-echoed", renderer.waitForScreen((current) => (current.viewport.includes(FOLLOW_UP_PROMPT) ? current : undefined), { timeoutMs: RENDER_TIMEOUT_MS, description: "follow-up prompt echoed by the editor" }))
      tui.terminal.write("\r")
    }
    screen = await signal("notice-rendered", renderer.waitForScreen(showsNotice(MEMORIES.rollout), { timeoutMs: RENDER_TIMEOUT_MS, description: `Kibitzer notice (${NOTICE_TITLE} + ${recalledLine(MEMORIES.rollout)}) rendered and the turn settled` }))
    const titleLines = linesContaining(screen.viewport, NOTICE_TITLE)
    const recalledLines = linesContaining(screen.viewport, recalledLine(MEMORIES.rollout))
    facts.notice = { glyph: NOTICE_GLYPH, title: NOTICE_TITLE, recalledLine: recalledLine(MEMORIES.rollout), titleLines, recalledLines, glyphRendered: titleLines.some((line) => line.includes(`${NOTICE_GLYPH} ${NOTICE_TITLE}`)), pathLine: linesContaining(screen.viewport, MEMORIES.rollout.path) }
    record(RUNTIME_LAYER, "notice-title-rendered", titleLines.length > 0, `lines=${JSON.stringify(titleLines)} glyph=${facts.notice.glyphRendered}`)
    record(RUNTIME_LAYER, "recalled-memory-rendered", recalledLines.length > 0, `lines=${JSON.stringify(recalledLines)}`)
    record(RUNTIME_LAYER, "notice-in-viewport", titleLines.length > 0 && recalledLines.length > 0, `viewportY=${screen.viewportY} rows=${screen.rows} (the PNG frame is the viewport)`)
    const entries = readEntries(state.sessionFile)
    const nudged = entries.filter(isNudged)
    record(RUNTIME_LAYER, "nudge-reached-parent", nudged.length === 1 && nudgedPaths(entries).join(",") === MEMORIES.rollout.path && entries.filter(isRecall).length === 1 && (entries.filter(isRecall)[0]?.content ?? "").includes(MEMORIES.rollout.body), `nudgedEntries=${nudged.length} via=${nudged[0]?.data?.via} paths=${nudgedPaths(entries).join(",")} recallMessages=${entries.filter(isRecall).length}`)
    record(RUNTIME_LAYER, "pending-drained", !existsSync(pendingFile(identity, state.sessionId)), `pending=${existsSync(pendingFile(identity, state.sessionId))}`)
    record(RUNTIME_LAYER, "lease-released", leaseFiles(identity).length === 0, `leases=${leaseFiles(identity).length}`)

    // ---- capture, then shut the TUI down while the sandbox is still observable --------------------------------
    const png = await renderer.screenshot()
    mkdirSync(evidence, { recursive: true })
    writeFileSync(join(evidence, "terminal.png"), png)
    facts.files = {
      png: join(evidence, "terminal.png"),
      text: writeEvidence(evidence, "terminal.txt", `${screen.viewport}\n`),
      buffer: writeEvidence(evidence, "terminal-buffer.txt", `${screen.buffer}\n`),
      ansi: writeEvidence(evidence, "terminal-ansi.txt", raw),
    }
    record(PROBE_LAYER, "evidence-captured", png.length > 0 && existsSync(facts.files.png) && existsSync(facts.files.text), `png=${png.length} bytes text=${screen.viewport.length} chars buffer=${screen.buffer.length} chars`)
    const exit = await quitTui(tui)
    record(RUNTIME_LAYER, "shutdown-clean", leaseFiles(identity).length === 0 && !existsSync(pendingFile(identity, state.sessionId)), `teardown=${exit} leases=${leaseFiles(identity).length} pending=${existsSync(pendingFile(identity, state.sessionId))}`)
    // Counted after the exit: no request can arrive once the TUI is gone, so these are final.
    const finalTranscripts = childTranscripts(lineages[0].dir)
    record(RUNTIME_LAYER, "one-wake-one-lineage", router.state.sidecar === 1 && sidecarDirs(identity).length === 1 && finalTranscripts.length === 1 && finalTranscripts[0].users.length === 1 && (router.state.title ?? 0) >= 1, `sidecarRequests=${router.state.sidecar} generations=${finalTranscripts.length} childUserMessages=${finalTranscripts[0]?.users.length} parentRequests=${router.state.parent - seedRequests} titleRequests=${router.state.title ?? 0}`)
    facts.result = {
      resident: sidecarDirs(identity).length === 1,
      childSessions: sidecarDirs(identity).length,
      childGenerations: finalTranscripts.length,
      wakes: finalTranscripts[0]?.users.length ?? 0,
      nudged: nudgedPaths(entries).length,
      via: nudged[0]?.data?.via,
      sidecarRequests: router.state.sidecar,
      parentRequests: router.state.parent - seedRequests,
      titleRequests: router.state.title ?? 0,
      toolNames: registry,
    }
    return finish()
  } catch (error) {
    record(RUNTIME_LAYER, "uncaught", false, error instanceof Error ? (error.stack ?? error.message) : String(error))
    return finish()
  }

  async function finish() {
    // The raw stream and the last screen are kept even on failure so a red run can be read.
    if (raw.length > 0 && facts.files === undefined) {
      facts.files = { ansi: writeEvidence(evidence, "terminal-ansi.txt", raw) }
      if (screen !== undefined) facts.files.text = writeEvidence(evidence, "terminal.txt", `${screen.viewport}\n`)
    }
    if (identity !== undefined) {
      if (state?.sessionFile !== undefined && existsSync(state.sessionFile)) copyFileSync(state.sessionFile, join(evidence, "tui-parent-session.jsonl"))
      for (const lineage of sidecarDirs(identity)) {
        childTranscripts(lineage.dir).forEach((transcript, index) => copyFileSync(transcript.file, join(evidence, `tui-sidecar-gen${index + 1}.jsonl`)))
      }
    }
    facts.cleanup = await cleanup.run()
    console.log(`cleanup: ${facts.cleanup.join(", ") || "nothing to clean"}`)
    const failures = checks.filter((check) => !check.ok)
    const summary = {
      ok: failures.length === 0 && facts.result !== undefined && interrupted === undefined,
      driver: DRIVER,
      ...(interrupted === undefined ? {} : { interrupted }),
      command: facts.command ?? null,
      sessionId: facts.sessionId ?? null,
      resident: facts.result?.resident ?? false,
      childSessions: facts.result?.childSessions ?? 0,
      nudged: facts.result?.nudged ?? 0,
      via: facts.result?.via ?? null,
      notice: facts.notice === undefined ? null : { title: facts.notice.title, recalledLine: facts.notice.recalledLine, titleLines: facts.notice.titleLines, recalledLines: facts.notice.recalledLines, glyphRendered: facts.notice.glyphRendered },
      signals,
      files: facts.files ?? null,
      checks: checks.length,
      failures: failures.map((check) => ({ layer: check.layer, name: check.name })),
      failureLayers: [...new Set(failures.map((check) => check.layer))],
      cleanup: facts.cleanup,
    }
    const metadata = {
      title: "Resident Kibitzer nudge",
      driver: DRIVER,
      connector: "xterm.js in headless Chrome fed by a Bun.spawn terminal (real PTY)",
      colorPath: "xterm.js (true color; not tmux)",
      source: { kind: "command", command: facts.command ?? null, source: facts.commandSource ?? null, pid: facts.pid ?? null, sessionId: facts.sessionId ?? null },
      interaction: [MEMORIES.rollout.prompt, "{Enter}", ...(facts.deliveredDuringFirstTurn === true ? [] : [FOLLOW_UP_PROMPT, "{Enter}"])],
      dimensions: facts.geometry,
      signals,
      assertion: facts.notice ?? { title: NOTICE_TITLE, recalledLine: recalledLine(MEMORIES.rollout), titleLines: [], recalledLines: [] },
      files: { png: facts.files?.png ?? null, text: facts.files?.text ?? null, buffer: facts.files?.buffer ?? null, ansi: facts.files?.ansi ?? null, metadata: join(evidence, "metadata.json"), summary: join(evidence, `${DRIVER}.json`) },
      sandbox: { root: facts.sandboxRoot ?? null, kept: options.keepSandbox },
      cleanup: facts.cleanup,
      ok: summary.ok,
    }
    writeFileSync(metadata.files.metadata, `${JSON.stringify(metadata, null, 2)}\n`)
    summary.metadata = metadata.files.metadata
    summary.evidence = writeEvidence(evidence, `${DRIVER}.json`, { ...summary, checks, facts })
    console.log(`evidence: ${summary.evidence}`)
    console.log(JSON.stringify(summary))
    process.exit(interrupted !== undefined ? 130 : summary.ok ? 0 : 1)
  }
}

function runSelfTest() {
  const options = parseArgs(["--evidence-dir", "/tmp/x", "--cols", "100", "--rows", "30"])
  if (options.cols !== 100 || options.rows !== 30 || options.evidenceDir !== resolve("/tmp/x")) throw new Error("self-test: argument parsing")
  for (const bad of [[], ["--evidence-dir", "/tmp/x", "--cols", "0"], ["--bogus"]]) {
    let rejected = false
    try { parseArgs(bad) } catch { rejected = true }
    if (!rejected) throw new Error(`self-test: ${bad.join(" ") || "(no arguments)"} must be rejected`)
  }
  if (resolveChrome(process.execPath, {}, "none") !== process.execPath) throw new Error("self-test: an explicit executable wins")
  if (resolveChrome(undefined, { CHROME_BIN: "/definitely/missing" }, "none") !== undefined) throw new Error("self-test: a missing candidate is skipped")
  const html = buildPageHtml({ xtermJs: "/*xterm*/", xtermCss: "/*css*/", unicodeJs: "/*u11*/", cols: 120, rows: 40, fontSize: 15 })
  if (!html.includes("cols: 120, rows: 40") || !html.includes("window.__snapshot") || !html.includes("window.__write")) throw new Error("self-test: page hooks")
  const booting = { viewport: "❯\n… project • 0/200K (0.0%) (auto)       mock-1", buffer: "" }
  if (isReady(booting) !== undefined) throw new Error("self-test: the editor glyph and model footer alone are not ready - submission is still gated")
  const busy = { viewport: `❯ ask\n… mock-1 • Working (0s • ${WORKING_MARKER})\n(😺 OmO Native) mem:project-3bf12e4b just now`, buffer: `${PARENT_ANSWERS[0]}\n❯ ask\n… mock-1 • Working (0s • ${WORKING_MARKER})\n(😺 OmO Native) mem:project-3bf12e4b just now` }
  if (isReady(busy) === undefined || isIdleWith(PARENT_ANSWERS[0])(busy) !== undefined) throw new Error("self-test: a working turn is ready but not idle")
  const settled = { viewport: `  ${NOTICE_GLYPH} ${NOTICE_TITLE}\n  ${recalledLine(MEMORIES.rollout)}\n  ${MEMORIES.rollout.path}\n ${PARENT_ANSWERS[1]}\n❯\n mock-1`, buffer: "" }
  settled.buffer = settled.viewport
  if (showsNotice(MEMORIES.rollout)(settled) === undefined || showsNotice(MEMORIES.helm)(settled) !== undefined) throw new Error("self-test: the notice predicate keys on the recalled memory line")
  if (linesContaining(settled.viewport, NOTICE_TITLE).join() !== `  ${NOTICE_GLYPH} ${NOTICE_TITLE}` || linesContaining(settled.viewport, RECALLED_PREFIX).length !== 1) throw new Error("self-test: line extraction")
  if (recalledLine(MEMORIES.rollout) !== "recalled memory: Drain nodes before a rollout; never roll during an incident.") throw new Error("self-test: recalled line text")
  const lane = titleLane()
  const titleBody = { messages: [{ role: "system", content: `${TITLE_REQUEST_MARKER}\n\nRules:` }, { role: "user", content: MEMORIES.rollout.prompt }] }
  if (!lane.matches(titleBody) || lane.matches({ messages: [{ role: "system", content: "# Kibitzer" }] }) || lane.step(titleBody).text !== `<title>${SESSION_TITLE}</title>`) throw new Error("self-test: the title lane keys on the title system prompt")
  const router = createRouter({ lanes: [lane] })
  router.setParentSteps([{ type: "text", text: "p1" }])
  const titled = router.steps(titleBody)
  const parent = router.steps({ messages: [] })
  if (titled[0]?.text !== `<title>${SESSION_TITLE}</title>` || parent[1]?.text !== "p1" || router.state.title !== 1 || router.state.parent !== 1 || router.classify(titleBody) !== "title") throw new Error("self-test: a title request must not consume the parent script")
  if (findNewSession("/definitely/missing", new Set()) !== undefined) throw new Error("self-test: no session dir, no session")
  console.log(JSON.stringify({ ok: true, driver: DRIVER, selfTest: true }))
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}

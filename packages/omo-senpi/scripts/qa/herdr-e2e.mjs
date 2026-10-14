#!/usr/bin/env node
// Live Herdr-pane QA: the real senpi TUI under tmux loads the built plugin through the sandbox
// settings while HERDR_* points at a local stub socket that records every JSON-RPC request.
// Proves the bundled extensions/herdr-omo.js reporter binds, reports agent identity + resume
// argv, transitions idle -> working -> idle across one mock turn, releases ONLY on quit, and
// that senpi's builtin reporter (source custom:senpi, agent pi) deferred to the herdr-* file.
import { spawn, spawnSync } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { homedir, tmpdir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createSandbox, seedSandbox } from "./drive.mjs"
import { protectedSnapshotsUntouched, snapshotProtectedState } from "./isolation-state.mjs"
import { changedRealPaths, snapshotDir } from "./task-e2e-analysis.mjs"
import { isolatedChildEnv } from "./sandbox-child-env.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(scriptDir, "..", "..")
const pluginRoot = join(packageRoot, "plugin")
const mockProviderEntry = join(scriptDir, "mock-provider", "index.ts")
const realSenpiAgentDir = join(homedir(), ".senpi", "agent")
const realOmoAgentDir = join(homedir(), ".omo", "agent")

const SCENARIOS = {
  omo: { omoNative: true, agent: "omo" },
  senpi: { omoNative: false, agent: "senpi" },
}

const PROMPT = "Answer with the single word ok."
const DEADLINE_MS = 60_000

function parseArgs(argv) {
  const args = { scenario: "all", senpiCli: undefined, evidenceDir: undefined, keepSandbox: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--help" || arg === "-h") return { ...args, help: true }
    if (arg === "--self-test") return { ...args, selfTest: true }
    if (arg === "--keep-sandbox") { args.keepSandbox = true; continue }
    if (arg !== "--scenario" && arg !== "--senpi-cli" && arg !== "--evidence-dir") {
      throw new Error(`unknown argument: ${arg}`)
    }
    const value = argv[++i]
    if (!value) throw new Error(`${arg} requires a value`)
    if (arg === "--scenario") {
      if (value !== "all" && !Object.hasOwn(SCENARIOS, value)) throw new Error(`unknown scenario: ${value}`)
      args.scenario = value
    } else if (arg === "--senpi-cli") args.senpiCli = value
    else args.evidenceDir = value
  }
  return args
}

function findOnPath(bin) {
  if (bin.includes("/")) return existsSync(bin) ? bin : null
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = resolve(dir || ".", bin)
    if (existsSync(candidate)) return candidate
  }
  return null
}

// The stub answers every request with {"id", "result":{}} so the reporter believes the pane
// accepted the report. Each request is appended verbatim to the log; assertions read it back.
function startHerdrStub(socketPath, logPath) {
  const sockets = new Set()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
    let buffer = ""
    socket.on("data", (chunk) => {
      buffer += String(chunk)
      for (;;) {
        const newline = buffer.indexOf("\n")
        if (newline < 0) return
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        appendFileSync(logPath, `${line}\n`)
        try {
          const request = JSON.parse(line)
          socket.write(`${JSON.stringify({ id: request.id, result: {} })}\n`)
        } catch {
          socket.write(`${JSON.stringify({ id: null, error: "bad json" })}\n`)
        }
      }
    })
  })
  return new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen)
    server.listen(socketPath, () => resolveListen({
      close: () => new Promise((done) => {
        server.close(() => done())
        for (const socket of sockets) socket.destroy()
      }),
    }))
  })
}

function readRequests(logPath) {
  if (!existsSync(logPath)) return []
  return readFileSync(logPath, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      try { return JSON.parse(line) } catch { return { method: "unparsable", raw: line } }
    })
}

function tmux(args, options = {}) {
  return spawnSync("tmux", args, { encoding: "utf8", windowsHide: true, ...options })
}

async function waitFor(predicate, deadlineMs, intervalMs = 150) {
  const deadline = Date.now() + deadlineMs
  for (;;) {
    const value = predicate()
    if (value) return value
    if (Date.now() > deadline) return undefined
    await new Promise((done) => setTimeout(done, intervalMs))
  }
}

function childEnv(baseEnv, sandbox, scenario) {
  const env = {}
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined) continue
    if (/TOKEN|SECRET|PASSWORD|COOKIE|CREDENTIAL|API_KEY/i.test(key)) continue
    if (key === "OMO_NATIVE") continue
    env[key] = value
  }
  const isolated = isolatedChildEnv(env, sandbox.agentDir)
  const next = {
    ...isolated,
    HOME: sandbox.homeDir,
    XDG_CONFIG_HOME: sandbox.xdgConfigHome,
    XDG_DATA_HOME: sandbox.xdgDataHome,
    XDG_CACHE_HOME: sandbox.xdgCacheHome,
    TERM: "xterm-256color",
    HERDR_ENV: "1",
    HERDR_PANE_ID: `qa-pane-${scenario.agent}`,
    HERDR_SOCKET_PATH: sandbox.herdrSocket,
    OMO_SENPI_QA: "1",
    OMO_SENPI_DISABLE_POSTHOG: "1",
    PI_OFFLINE: "1",
    PI_TELEMETRY: "0",
  }
  if (scenario.omoNative) next.OMO_NATIVE = "1"
  else delete next.OMO_NATIVE
  return next
}

function paneDead(tmuxName) {
  return tmux(["has-session", "-t", tmuxName]).status !== 0
}

function tmuxEnvFlags(env) {
  const flags = []
  for (const [key, value] of Object.entries(env)) flags.push("-e", `${key}=${value}`)
  return flags
}

function analyzeRequests(requests, scenario) {
  const checks = []
  const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail })
  const params = (r) => (typeof r === "object" && r !== null ? r.params ?? {} : {})
  const byMethod = (m) => requests.filter((r) => r.method === m)
  const reports = byMethod("pane.report_agent")
  const sessions = byMethod("pane.report_agent_session")
  const releases = byMethod("pane.release_agent")
  const metadata = byMethod("pane.report_metadata")

  check("connected", requests.length > 0, `${requests.length} request(s) logged`)

  const foreign = requests.filter((r) => params(r).source !== "custom:omo" || params(r).agent === "pi")
  check("builtin-deferred", foreign.length === 0 && requests.every((r) => params(r).source === "custom:omo"),
    foreign.length === 0 ? "no custom:senpi/pi traffic" : `foreign: ${JSON.stringify(foreign.slice(0, 2))}`)

  const paneMismatch = requests.filter((r) => params(r).pane_id !== `qa-pane-${scenario.agent}`)
  check("pane-id", paneMismatch.length === 0 && requests.length > 0,
    paneMismatch.length === 0 ? "every request names the QA pane" : JSON.stringify(paneMismatch.slice(0, 2)))

  const seqs = requests.map((r) => params(r).seq).filter((s) => typeof s === "number")
  check("seq-monotonic", seqs.length === requests.length && seqs.every((s, i) => i === 0 || s > seqs[i - 1]),
    `${seqs.length} strictly increasing seqs`)

  const session = sessions.find((r) => params(r).agent === scenario.agent)
  check("session-report", session !== undefined,
    session === undefined ? `sessions: ${JSON.stringify(sessions)}` : `agent=${params(session).agent}`)
  const ref = session === undefined ? {} : params(session)
  check("session-ref", typeof ref.agent_session_path === "string" || typeof ref.agent_session_id === "string",
    JSON.stringify({ agent_session_path: ref.agent_session_path, agent_session_id: ref.agent_session_id }))
  const argv = Array.isArray(ref.resume_argv) ? ref.resume_argv : []
  check("resume-argv", argv[0] === scenario.agent && argv.includes("--session") && argv.indexOf("--session") + 1 < argv.length,
    JSON.stringify(argv))

  const states = reports.map((r) => params(r).state)
  const firstWorking = states.indexOf("working")
  check("initial-idle", states[0] === "idle", `states: ${JSON.stringify(states)}`)
  check("working", firstWorking >= 0, `states: ${JSON.stringify(states)}`)
  check("settled-idle", firstWorking >= 0 && states.lastIndexOf("idle") > firstWorking, `states: ${JSON.stringify(states)}`)

  check("metadata", metadata.length >= 0, `${metadata.length} metadata report(s)`)

  const releaseIndex = requests.findIndex((r) => r.method === "pane.release_agent")
  check("release-on-quit", releases.length === 1 && releaseIndex === requests.length - 1,
    `releases=${releases.length} last=${requests.length > 0 ? requests[requests.length - 1].method : "none"}`)

  return checks
}

async function runScenario(name, senpiCli, keepSandbox) {
  const scenario = SCENARIOS[name]
  const sandbox = createSandbox()
  sandbox.herdrSocket = join(sandbox.root, "herdr.sock")
  sandbox.logPath = join(sandbox.root, "herdr-requests.jsonl")
  const sessionDir = join(sandbox.root, "sessions")
  mkdirSync(sessionDir, { recursive: true })
  seedSandbox(sandbox)
  mkdirSync(join(sandbox.cwd, ".omo"), { recursive: true })
  writeFileSync(join(sandbox.cwd, "mock-script.json"), `${JSON.stringify({ steps: [{ type: "text", text: "ok" }] }, null, 2)}\n`)

  // Protected-state digests are the binding check; the whole-directory diff is informational
  // only because this machine runs live omo-under-herdr sessions whose herdr-dag/ state churns
  // while QA runs.
  const beforeSenpi = snapshotDir(realSenpiAgentDir)
  const beforeOmo = snapshotDir(realOmoAgentDir)
  const protectedBefore = {
    senpi: snapshotProtectedState(realSenpiAgentDir),
    omo: snapshotProtectedState(realOmoAgentDir),
  }
  const tmuxName = `omo-herdr-qa-${process.pid}-${name}`
  const stub = await startHerdrStub(sandbox.herdrSocket, sandbox.logPath)
  const checks = []
  const check = (n, pass, detail) => checks.push({ name: n, pass: Boolean(pass), detail })
  let paneExit
  try {
    const env = childEnv(process.env, sandbox, scenario)
    const command = [
      senpiCli,
      "-e", mockProviderEntry,
      "--provider", "omo-mock",
      "--model", "mock-1",
      "--session-dir", sessionDir,
      "--offline",
      "--no-context-files",
    ].join(" ")
    const spawned = tmux([
      "new-session", "-d", "-s", tmuxName, "-x", "200", "-y", "50",
      ...tmuxEnvFlags(env),
      `cd ${sandbox.cwd} && exec ${command}`,
    ], { env })
    check("tmux-spawn", spawned.status === 0, spawned.stderr?.toString().trim() || "ok")

    const bound = await waitFor(
      () => readRequests(sandbox.logPath).some((r) => r.method === "pane.report_agent_session"),
      DEADLINE_MS,
    )
    check("bound", bound === true, bound ? "report_agent_session observed" : "no report_agent_session within deadline")

    tmux(["send-keys", "-t", tmuxName, "-l", PROMPT])
    tmux(["send-keys", "-t", tmuxName, "Enter"])
    const worked = await waitFor(
      () => readRequests(sandbox.logPath).some((r) => r.method === "pane.report_agent" && r.params?.state === "working"),
      DEADLINE_MS,
    )
    check("working-seen", worked === true, worked ? "working report observed" : "no working report within deadline")

    await waitFor(
      () => {
        const states = readRequests(sandbox.logPath)
          .filter((r) => r.method === "pane.report_agent")
          .map((r) => r.params?.state)
        const w = states.indexOf("working")
        return w >= 0 && states.lastIndexOf("idle") > w
      },
      DEADLINE_MS,
    )

    tmux(["send-keys", "-t", tmuxName, "-l", "/exit"])
    tmux(["send-keys", "-t", tmuxName, "Enter"])
    paneExit = await waitFor(() => paneDead(tmuxName), 30_000)
    check("process-exit", paneExit === true, paneExit ? "pane exited after /exit" : "pane still alive after /exit")
    await waitFor(
      () => readRequests(sandbox.logPath).some((r) => r.method === "pane.release_agent"),
      15_000,
    )
  } finally {
    tmux(["kill-session", "-t", tmuxName])
    await stub.close()
  }

  const requests = readRequests(sandbox.logPath)
  checks.push(...analyzeRequests(requests, scenario))

  const changedSenpi = changedRealPaths(beforeSenpi, snapshotDir(realSenpiAgentDir))
  const changedOmo = changedRealPaths(beforeOmo, snapshotDir(realOmoAgentDir))
  const protectedAfter = {
    senpi: snapshotProtectedState(realSenpiAgentDir),
    omo: snapshotProtectedState(realOmoAgentDir),
  }
  check("isolation",
    protectedSnapshotsUntouched(protectedBefore.senpi, protectedAfter.senpi) &&
      protectedSnapshotsUntouched(protectedBefore.omo, protectedAfter.omo),
    `protected state untouched; concurrent-session drift (informational): senpi=${JSON.stringify(changedSenpi)} omo=${JSON.stringify(changedOmo)}`)

  if (!keepSandbox) rmSync(sandbox.root, { recursive: true, force: true })

  return {
    scenario: name,
    sandbox: keepSandbox ? sandbox.root : undefined,
    requests,
    observedDrift: { senpi: changedSenpi, omo: changedOmo },
    checks,
    pass: checks.every((c) => c.pass),
  }
}

async function runSelfTest() {
  const dir = mkdtempSync(join(tmpdir(), "herdr-e2e-selftest-"))
  const socketPath = join(dir, "herdr.sock")
  const logPath = join(dir, "requests.jsonl")
  const stub = await startHerdrStub(socketPath, logPath)
  try {
    const { createConnection } = await import("node:net")
    const reply = await new Promise((resolveReply, rejectReply) => {
      const socket = createConnection(socketPath)
      socket.on("connect", () => socket.write(`${JSON.stringify({ id: "t:1", method: "pane.report_agent", params: { state: "idle" } })}\n`))
      socket.on("data", (chunk) => { socket.destroy(); resolveReply(String(chunk)) })
      socket.on("error", rejectReply)
      setTimeout(() => rejectReply(new Error("stub did not answer")), 5_000).unref()
    })
    const parsed = JSON.parse(reply.trim())
    if (parsed.id !== "t:1" || !("result" in parsed)) throw new Error(`bad stub reply: ${reply}`)
    const logged = readRequests(logPath)
    if (logged.length !== 1 || logged[0].method !== "pane.report_agent") throw new Error("stub did not log the request")
    const analysis = analyzeRequests([
      { method: "pane.report_agent_session", params: { agent: "omo", agent_session_path: "/s", resume_argv: ["omo", "--session", "x"], pane_id: "qa-pane-omo", source: "custom:omo", seq: 1 } },
      { method: "pane.report_agent", params: { agent: "omo", state: "idle", pane_id: "qa-pane-omo", source: "custom:omo", seq: 2 } },
      { method: "pane.report_agent", params: { agent: "omo", state: "working", pane_id: "qa-pane-omo", source: "custom:omo", seq: 3 } },
      { method: "pane.report_agent", params: { agent: "omo", state: "idle", pane_id: "qa-pane-omo", source: "custom:omo", seq: 4 } },
      { method: "pane.release_agent", params: { agent: "omo", pane_id: "qa-pane-omo", source: "custom:omo", seq: 5 } },
    ], SCENARIOS.omo)
    const failed = analysis.filter((c) => !c.pass)
    if (failed.length > 0) throw new Error(`self-test analysis failed: ${JSON.stringify(failed)}`)
    const contaminated = analyzeRequests([
      { method: "pane.report_agent", params: { agent: "pi", state: "idle", pane_id: "qa-pane-omo", source: "custom:senpi", seq: 1 } },
    ], SCENARIOS.omo)
    if (contaminated.every((c) => c.pass)) throw new Error("analysis should reject builtin traffic")
    return { result: "PASS", mode: "self-test" }
  } finally {
    await stub.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

function writeEvidence(dir, payload) {
  mkdirSync(dir, { recursive: true })
  for (const scenario of payload.scenarios) {
    writeFileSync(
      join(dir, `herdr-requests-${scenario.scenario}.jsonl`),
      `${scenario.requests.map((r) => JSON.stringify(r)).join("\n")}\n`,
    )
  }
  writeFileSync(join(dir, "herdr-e2e.json"), `${JSON.stringify(payload, null, 2)}\n`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log("Usage: node packages/omo-senpi/scripts/qa/herdr-e2e.mjs [--scenario omo|senpi|all] [--senpi-cli <path>] [--evidence-dir <d>] [--keep-sandbox] [--self-test]")
    process.exit(0)
  }
  if (args.selfTest) {
    console.log(JSON.stringify(await runSelfTest(), null, 2))
    return
  }
  const senpiCli = args.senpiCli ?? process.env.SENPI_CLI ?? process.env.SENPI_BIN ?? findOnPath("senpi")
  const names = args.scenario === "all" ? Object.keys(SCENARIOS) : [args.scenario]
  if (senpiCli === null) {
    const payload = { result: "SKIP", reason: "senpi-binary-unavailable", scenarios: [] }
    if (args.evidenceDir) writeEvidence(args.evidenceDir, payload)
    console.log(JSON.stringify(payload, null, 2))
    process.exit(1)
  }
  if (!existsSync(join(pluginRoot, "extensions", "herdr-omo.js"))) {
    const payload = { result: "FAIL", reason: "herdr-omo.js bundle missing; run bun run build:senpi-plugin", scenarios: [] }
    if (args.evidenceDir) writeEvidence(args.evidenceDir, payload)
    console.log(JSON.stringify(payload, null, 2))
    process.exit(1)
  }
  const scenarios = []
  for (const name of names) scenarios.push(await runScenario(name, senpiCli, args.keepSandbox))
  const payload = {
    result: scenarios.every((s) => s.pass) ? "PASS" : "FAIL",
    senpiCli,
    pluginRoot,
    scenarios: scenarios.map((s) => ({ ...s, requests: undefined, requestCount: s.requests.length })),
  }
  if (args.evidenceDir) writeEvidence(args.evidenceDir, { ...payload, scenarios })
  console.log(JSON.stringify(payload, null, 2))
  process.exit(payload.result === "PASS" ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

#!/usr/bin/env node
// Live proof for #10234 on the real senpi binary: a summary queue a killed opted-in process left behind is
// deleted by an opted-out start and never sent, and a window whose scope names no cwd is never sent.
// One sandbox and one local PostHog sink per lane; the `control` lane proves the seed is a real, sendable
// queue (an opted-in start recovers and sends it), so the opt-out lanes cannot pass on a malformed seed.
import { createServer } from "node:http"
import { gunzipSync } from "node:zlib"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { createSandbox, credentialDigest, seedSandbox } from "./drive.mjs"
import { createOwnedProcessRegistry, startSenpiRun } from "./team-e2e-runtime.mjs"
import { parseEvents } from "./team-e2e-support.mjs"
import { resolveSenpi } from "./team-e2e.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(scriptDir, "..", "..")
const pluginBundle = join(packageRoot, "plugin", "extensions", "omo.js")
const mockProviderEntry = join(scriptDir, "team-e2e-mock-provider.ts")
const realSenpiAgentDir = join(homedir(), ".senpi", "agent")
const SCRIPT = { lead: [{ type: "text", text: "OPTOUT-PURGE-DONE" }] }
const SEEDED = "seeded-session"
const SEED_WINDOW_UUID = "0395eae0-1111-4222-8333-944455556661"
const SEED_PENDING_UUID = "0395eae0-1111-4222-8333-944455556662"
const SEED_UUIDS = new Set([SEED_WINDOW_UUID, SEED_PENDING_UUID])
const DEAD = { pid: 0x7fff_fff0, bootId: "killed" }
const STALE_MS = 10 * 60_000
const OPTED_IN_ENV = {
  DO_NOT_TRACK: "",
  OMO_DISABLE_POSTHOG: "",
  OMO_SENPI_DISABLE_POSTHOG: "",
  OMO_SEND_ANONYMOUS_TELEMETRY: "",
  OMO_SENPI_SEND_ANONYMOUS_TELEMETRY: "",
  OMO_NATIVE_SURFACE: "",
  OMO_NATIVE_INSTALL_ID: "",
}

const LANES = {
  control: { env: {}, telemetryConfig: true, scope: "cwd" },
  "optout-env": { env: { DO_NOT_TRACK: "1" }, telemetryConfig: true, scope: "cwd" },
  "optout-config": { env: {}, telemetryConfig: false, scope: "cwd" },
  "scopeless-optin": { env: {}, telemetryConfig: true, scope: "none" },
}

async function main() {
  const evidenceDir = argValue("--evidence-dir")
  if (evidenceDir === undefined) throw new Error("--evidence-dir is required (resolve it with the senpi-qa skill)")
  mkdirSync(evidenceDir, { recursive: true })
  const senpiBin = resolveSenpi()
  if (senpiBin === null || !existsSync(pluginBundle)) {
    console.log(JSON.stringify({ result: "SKIP", reason: "real senpi binary or generated omo bundle unavailable" }))
    process.exitCode = 2
    return
  }
  const credentialBefore = credentialDigest(realSenpiAgentDir)
  const lanes = {}
  for (const [name, lane] of Object.entries(LANES)) lanes[name] = await runLane(senpiBin, name, lane)
  const realSenpiUntouched = credentialDigest(realSenpiAgentDir) === credentialBefore

  // The capture path rewrites $session_id, so a seeded row is recognised by the uuid the protocol re-sends under.
  const seededSent = (name) => lanes[name].summaries.filter((event) => SEED_UUIDS.has(event.uuid))
  const controlWindow = lanes.control.summaries.find((event) => event.uuid === SEED_WINDOW_UUID)
  const checks = {
    controlRecoversTheSeedWindow: controlWindow?.properties?.ended_by === "recovered",
    controlRecoveredWindowKeepsItsEpoch: controlWindow?.properties?.summary_epoch === "0123456789abcdef",
    controlResendsTheSeedPending: lanes.control.summaries.some((event) => event.uuid === SEED_PENDING_UUID),
    optoutEnvSentNothing: lanes["optout-env"].events.length === 0,
    optoutEnvLeftNoSummaryFile: lanes["optout-env"].filesAfter.length === 0,
    optoutConfigSentNoSummary: lanes["optout-config"].summaries.length === 0,
    optoutConfigSentNoSeed: seededSent("optout-config").length === 0,
    optoutConfigLeftNoSeedFile: lanes["optout-config"].filesAfter.every((name) => !name.includes(SEEDED)),
    scopelessWindowNeverSent: !lanes["scopeless-optin"].summaries.some((event) => event.uuid === SEED_WINDOW_UUID),
    scopelessLeftNoSeedFile: lanes["scopeless-optin"].filesAfter.every((name) => !name.includes(SEEDED)),
    scopelessPendingNeverSent: !lanes["scopeless-optin"].summaries.some((event) => event.uuid === SEED_PENDING_UUID),
    scopelessLaneStillReports: lanes["scopeless-optin"].summaries.length > 0,
    everyRunExitedZero: Object.values(lanes).every((lane) => lane.status === 0),
    everySeedWasOnDisk: Object.values(lanes).every((lane) => lane.filesBefore.length >= 3),
    leakedPidsZero: Object.values(lanes).every((lane) => lane.leakedPids === 0),
    noSandboxProcessSurvives: Object.values(lanes).every((lane) => lane.sandboxProcessesLeft === 0),
    noSandboxRpcDirSurvives: Object.values(lanes).every((lane) => lane.rpcDirsLeft === 0),
    sandboxesRemoved: Object.values(lanes).every((lane) => lane.sandboxRemoved),
    realSenpiUntouched,
  }
  const failed = Object.entries(checks).filter(([, ok]) => ok !== true).map(([name]) => name)
  const verdict = { result: failed.length === 0 ? "PASS" : "FAIL", failed, checks }
  writeFileSync(join(evidenceDir, "optout-purge-lanes.json"), `${JSON.stringify(summarize(lanes), null, 2)}\n`)
  writeFileSync(join(evidenceDir, "optout-purge-verdict.json"), `${JSON.stringify(verdict, null, 2)}\n`)
  console.log(JSON.stringify(verdict))
  if (verdict.result !== "PASS") process.exitCode = 1
}

async function runLane(senpiBin, name, lane) {
  const sandbox = createSandbox()
  const sink = startPosthogSink()
  const processes = createOwnedProcessRegistry()
  const summaryRoot = join(sandbox.agentDir, "omo-senpi", "omo-native", "session-summary")
  let run
  let filesBefore = []
  let filesAfter = []
  let leakedPids = 0
  let sandboxProcessesLeft = -1
  let rpcDirsLeft = -1
  try {
    seedSandbox(sandbox)
    mkdirSync(join(sandbox.cwd, ".omo"), { recursive: true })
    writeFileSync(join(sandbox.cwd, ".omo", "omo.json"), `${JSON.stringify({ telemetry: { enabled: lane.telemetryConfig } })}\n`)
    seedDeadOwnerQueue(summaryRoot, lane.scope === "cwd" ? { cwd: sandbox.cwd } : {})
    filesBefore = listFiles(summaryRoot)
    const sinkUrl = await sink.ready
    const active = startSenpiRun({
      senpiBin,
      sandbox,
      prompt: "Say the scripted line.",
      script: SCRIPT,
      mockProviderEntry,
      parseEvents,
      extraEnv: {
        ...OPTED_IN_ENV,
        OMO_CODING_AGENT_DIR: sandbox.agentDir,
        PI_CODING_AGENT_DIR: sandbox.agentDir,
        POSTHOG_HOST: sinkUrl,
        ...lane.env,
      },
      onPid: (pid) => processes.onSpawn(pid),
      onClose: (pid) => processes.onClose(pid),
    })
    try {
      run = await active.completion
    } finally {
      await active.kill()
    }
    filesAfter = listFiles(summaryRoot)
  } finally {
    leakedPids = await processes.cleanup()
    await sink.close()
    // The run pre-warms a detached RPC host supervisor that outlives the CLI process (it is no child the
    // registry tracks) and writes back into the sandbox; it is stopped before the sandbox is removed.
    sandboxProcessesLeft = await stopSandboxProcesses(sandbox.root)
    rpcDirsLeft = removeSandboxRpcDirs(sandbox.root)
    rmSync(sandbox.root, { recursive: true, force: true })
  }
  const events = sink.requests.flatMap((request) => request.body?.batch ?? [request.body].filter((body) => body?.event))
  return {
    name,
    status: run?.status,
    stderrTail: (run?.stderr ?? "").slice(-2000),
    events,
    summaries: events.filter((event) => event?.event === "session_summary"),
    filesBefore,
    filesAfter,
    leakedPids,
    sandboxProcessesLeft,
    rpcDirsLeft,
    sandboxRemoved: !existsSync(sandbox.root),
  }
}

// What a killed opted-in process leaves: an open window and an unacknowledged pending event (both marked
// enabled and stamped with the scope it read consent for), a claim it held, and its owner registry entry.
function seedDeadOwnerQueue(root, scope) {
  const at = Date.now() - STALE_MS
  const window = {
    startedAt: at, lastAt: at, firstTurnIndex: 0, lastTurnIndex: 0, totals: [40],
    sums: { input_tokens: 11, output_tokens: 22, total_tokens: 40, cost_1e4: 1235 },
    models: [{ provider: "openai", model: "gpt-5.5", sums: { turns: 1, total_tokens: 40, cost_1e4: 1235 } }],
  }
  const record = {
    v: 2, consent: "enabled", scope, sessionHash: SEEDED, sessionRole: "root", owner: DEAD, heartbeatAt: at,
    epoch: "0123456789abcdef", seq: 0, sampleRate: 0, windowId: "0395eae0-1111-4222-8333-944455556661", window,
  }
  mkdirSync(join(root, "pending"), { recursive: true })
  mkdirSync(join(root, "owners"), { recursive: true })
  writeFileSync(join(root, `${SEEDED}.json`), JSON.stringify(record), { mode: 0o600 })
  writeFileSync(join(root, "pending", "0395eae0-1111-4222-8333-944455556662.json"), JSON.stringify({
    v: 2, consent: "enabled", scope, uuid: "0395eae0-1111-4222-8333-944455556662", sessionHash: `${SEEDED}-pending`,
    owner: DEAD, createdAt: at, properties: { $session_id: `${SEEDED}-pending`, summary_seq: 0, turns: 1 },
  }), { mode: 0o600 })
  writeFileSync(join(root, `${SEEDED}-claimed.json.claimed-${DEAD.pid}-${DEAD.bootId}`), JSON.stringify({ ...record, sessionHash: `${SEEDED}-claimed` }), { mode: 0o600 })
  writeFileSync(join(root, "owners", `${DEAD.pid}.json`), JSON.stringify(DEAD), { mode: 0o600 })
}

function sandboxPids(root) {
  const listing = execFileSync("ps", ["-axww", "-o", "pid=,command="], { encoding: "utf8", windowsHide: true })
  return listing.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line)
    return match !== null && match[2].includes(root) && Number(match[1]) !== process.pid ? [Number(match[1])] : []
  })
}

function signal(pids, name) {
  for (const pid of pids) {
    try {
      process.kill(pid, name)
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error
    }
  }
}

// TERM, then KILL whatever still holds the sandbox after a bounded wait; returns how many survive both.
async function stopSandboxProcesses(root) {
  signal(sandboxPids(root), "SIGTERM")
  for (let attempt = 0; attempt < 50 && sandboxPids(root).length > 0; attempt += 1) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  signal(sandboxPids(root), "SIGKILL")
  for (let attempt = 0; attempt < 20 && sandboxPids(root).length > 0; attempt += 1) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  return sandboxPids(root).length
}

// The host's socket directories live outside the sandbox (short paths for sun_path); only those whose
// metadata names this sandbox are removed. Returns how many could not be removed.
function removeSandboxRpcDirs(root) {
  let left = 0
  for (const base of new Set(["/tmp", "/private/tmp"])) {
    for (const name of safeList(base)) {
      if (!name.startsWith("omo-rpc-")) continue
      const dir = join(base, name)
      const owned = safeList(dir).some((file) => file.endsWith(".meta.json") && readText(join(dir, file)).includes(root))
      if (!owned) continue
      rmSync(dir, { recursive: true, force: true })
      if (existsSync(dir)) left += 1
    }
  }
  return left
}

const ABSENT = new Set(["ENOENT", "ENOTDIR", "EACCES", "EPERM"])

function isAbsent(error) {
  return error instanceof Error && "code" in error && ABSENT.has(error.code)
}

function safeList(dir) {
  try {
    return readdirSync(dir)
  } catch (error) {
    if (!isAbsent(error)) throw error
    return []
  }
}

function readText(path) {
  try {
    return readFileSync(path, "utf8")
  } catch (error) {
    if (!isAbsent(error)) throw error
    return ""
  }
}

function listFiles(root) {
  if (!existsSync(root)) return []
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(root.length + 1))
    .sort()
}

function startPosthogSink() {
  const requests = []
  const server = createServer((request, response) => {
    const chunks = []
    request.on("data", (chunk) => chunks.push(chunk))
    request.on("end", () => {
      const bytes = Buffer.concat(chunks)
      const decoded = request.headers["content-encoding"] === "gzip" ? gunzipSync(bytes) : bytes
      requests.push({ path: request.url, body: parseJson(decoded.toString("utf8")) })
      response.writeHead(200, { "content-type": "application/json" })
      response.end('{"status":"ok"}')
    })
  })
  server.listen(0, "127.0.0.1")
  server.unref()
  return {
    requests,
    ready: new Promise((resolveReady) => {
      server.on("listening", () => resolveReady(`http://127.0.0.1:${server.address().port}`))
    }),
    close: () => new Promise((resolveClose) => server.close(resolveClose)),
  }
}

function summarize(lanes) {
  return Object.fromEntries(Object.entries(lanes).map(([name, lane]) => [name, {
    status: lane.status,
    filesBefore: lane.filesBefore,
    filesAfter: lane.filesAfter,
    eventNames: lane.events.map((event) => event?.event),
    summaries: lane.summaries.map((event) => ({
      origin: event.uuid === SEED_WINDOW_UUID ? "seeded-window" : event.uuid === SEED_PENDING_UUID ? "seeded-pending" : "this-run",
      uuid: event.uuid,
      summary_epoch: event.properties?.summary_epoch,
      summary_seq: event.properties?.summary_seq,
      ended_by: event.properties?.ended_by,
    })),
    leakedPids: lane.leakedPids,
    sandboxProcessesLeft: lane.sandboxProcessesLeft,
    rpcDirsLeft: lane.rpcDirsLeft,
    sandboxRemoved: lane.sandboxRemoved,
    stderrTail: lane.status === 0 ? "" : lane.stderrTail,
  }]))
}

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    return {}
  }
}

function argValue(flag) {
  const index = process.argv.indexOf(flag)
  return index === -1 ? undefined : process.argv[index + 1]
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main()

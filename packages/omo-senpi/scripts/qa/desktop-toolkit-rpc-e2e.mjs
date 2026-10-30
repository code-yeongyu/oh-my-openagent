#!/usr/bin/env node
// Live QA for the desktop toolkit channel (sisyphuslabs/omo-desktop-app#3292) through senpi's REAL multi-session rpc
// host, the BUILT omo plugin (seedSandbox's plugin root; run `bun run build:senpi-plugin` first) and the omo mock provider. This driver plays the desktop: it opens a session with
// `open_session.context.omo_toolkits`, answers the session's `omo.toolkit.request` event with an
// `extension_request omo.toolkit.grant`, and checks what the eval cell got.
//
//   granted      the app offers the browser and answers: the cell gets the grant, and the token in the grant's file
//                never appears on the rpc stream (the grant carries a path, not the token)
//   not-offered  the session context lists no toolkit: the cell is told "unavailable" and the app is never asked
//   app-silent   the app is asked but never answers: the cell gets "timeout"
//
// Usage: node desktop-toolkit-rpc-e2e.mjs [--evidence-dir <dir>]
import { spawn } from "node:child_process"
import { once } from "node:events"
import { createInterface } from "node:readline"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { createSandbox, credentialDigest, seedSandbox } from "./drive.mjs"
import { withTelemetryOptOut } from "./telemetry-opt-out-env.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, "../../../..")
const evidenceDir = process.argv.includes("--evidence-dir") ? process.argv[process.argv.indexOf("--evidence-dir") + 1] : undefined
const senpiCli = process.env.SENPI_QA_CLI ?? join(repo, "node_modules/@code-yeongyu/senpi/dist/cli.js")
const mockProviderEntry = join(here, "mock-provider", "index.ts")
const EVENT_TIMEOUT_MS = 60_000
const TOKEN = `qa-toolkit-token-${process.pid}-${Date.now()}`

const acquireCell = {
  language: "js",
  summary: "acquire the app's browser",
  code: 'const r = await tool.omo_desktop_toolkit({ op: "acquire", toolkit: "browser" }); print("TOOLKIT_RESULT " + JSON.stringify(r.details ?? r))',
}

async function runScenario({ name, context, answer }) {
  const sandbox = createSandbox()
  seedSandbox(sandbox)
  writeFileSync(join(sandbox.cwd, "mock-script.json"), `${JSON.stringify({ steps: [{ type: "tool_call", name: "eval", arguments: acquireCell }, { type: "text", text: "done" }] }, null, 2)}\n`)
  const tokenFile = join(sandbox.root, "browser.token")
  writeFileSync(tokenFile, `${TOKEN}\n`, { mode: 0o600 })
  const grant = { endpoint: "http://127.0.0.1:41234/toolkit/browser", tokenFile }
  const env = withTelemetryOptOut({
    PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, LANG: "en_US.UTF-8",
    HOME: sandbox.homeDir, USERPROFILE: sandbox.homeDir,
    SENPI_CODING_AGENT_DIR: sandbox.agentDir, OMO_CODING_AGENT_DIR: sandbox.agentDir, PI_CODING_AGENT_DIR: sandbox.agentDir,
    XDG_CONFIG_HOME: sandbox.xdgConfigHome, XDG_DATA_HOME: sandbox.xdgDataHome, XDG_CACHE_HOME: sandbox.xdgCacheHome,
    PI_OFFLINE: "1", OMO_SENPI_QA: "1", SENPI_RPC_CLIENT_CAPABILITIES: "extension_events",
  })
  const child = spawn(process.env.BUN_BIN ?? "bun", [
    senpiCli, "--mode", "rpc", "--multi-session", "--session-runtime", "in-process",
    "-e", mockProviderEntry, "--provider", "omo-mock", "--model", "mock-1",
  ], { cwd: sandbox.cwd, env, stdio: ["pipe", "pipe", "pipe"], detached: true })
  const rows = []
  const waiters = new Set()
  let stdoutRaw = ""
  let stderr = ""
  child.stderr.on("data", (chunk) => { stderr += chunk })
  child.stdout.on("data", (chunk) => { stdoutRaw += chunk })
  createInterface({ input: child.stdout }).on("line", (line) => {
    let event
    try { event = JSON.parse(line) } catch { return }
    rows.push(event)
    for (const waiter of waiters) waiter(event)
  })
  const eventWhere = (predicate, label) => {
    const seen = rows.find(predicate)
    if (seen) return Promise.resolve(seen)
    return new Promise((resolveEvent, reject) => {
      const timer = setTimeout(() => { waiters.delete(check); reject(new Error(`${name}: waited ${EVENT_TIMEOUT_MS} ms for ${label}`)) }, EVENT_TIMEOUT_MS)
      const check = (event) => { if (!predicate(event)) return; clearTimeout(timer); waiters.delete(check); resolveEvent(event) }
      waiters.add(check)
    })
  }
  let id = 0
  const send = (record) => child.stdin.write(`${JSON.stringify(record)}\n`)
  const request = async (type, data = {}) => {
    const requestId = `qa-${++id}`
    const response = eventWhere((event) => event.type === "response" && event.id === requestId, type)
    send({ id: requestId, type, ...data })
    const result = await response
    if (result.success !== true) throw new Error(`${name}: ${type} failed: ${JSON.stringify(result)}`)
    return result.data
  }
  const outcome = { name }
  try {
    const opened = await request("open_session", { cwd: sandbox.cwd, ...(context === undefined ? {} : { context }) })
    const sessionId = opened.sessionId
    const ended = eventWhere((event) => event.type === "agent_end" && (event.sessionId === undefined || event.sessionId === sessionId), "agent_end")
    if (answer === true) {
      eventWhere((event) => event.type === "extension_event" && event.name === "omo.toolkit.request", "omo.toolkit.request").then((event) => {
        send({ id: `qa-grant`, type: "extension_request", sessionId, name: "omo.toolkit.grant", data: { requestId: event.data.requestId, grant } })
      }, () => {})
    }
    await request("prompt", { sessionId, message: "acquire the browser" })
    await ended
    const printed = rows.flatMap((event) => {
      const text = JSON.stringify(event)
      const match = /TOOLKIT_RESULT (\{.*?\})(?:\\\\n|\\n|")/.exec(text)
      return match ? [match[1].replace(/\\"/g, '"')] : []
    })
    outcome.cellResult = printed[0] === undefined ? null : JSON.parse(printed[0])
    outcome.requests = rows.filter((event) => event.type === "extension_event" && event.name === "omo.toolkit.request").map((event) => event.data)
    outcome.tokenOnRpcStream = stdoutRaw.includes(TOKEN)
  } catch (error) {
    outcome.error = String(error?.message ?? error)
  } finally {
    try { process.kill(-child.pid, "SIGKILL") } catch {}
    if (child.exitCode === null && child.signalCode === null) await once(child, "exit")
    outcome.stderrTail = stderr.slice(-2000)
    if (evidenceDir !== undefined) writeFileSync(join(evidenceDir, `${name}.json`), `${JSON.stringify({ ...outcome, rows: rows.slice(-200) }, null, 2)}\n`)
    rmSync(sandbox.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
  return outcome
}

const realDirs = [join(homedir(), ".senpi/agent"), join(homedir(), ".omo/agent")]
const before = realDirs.map(credentialDigest)
if (evidenceDir !== undefined) mkdirSync(evidenceDir, { recursive: true })
const granted = await runScenario({ name: "granted", context: { omo_toolkits: "browser" }, answer: true })
const notOffered = await runScenario({ name: "not-offered", context: undefined, answer: false })
const silent = await runScenario({ name: "app-silent", context: { omo_toolkits: "browser" }, answer: false })
const after = realDirs.map(credentialDigest)
const checks = {
  grantedGetsGrant: granted.cellResult?.ok === true && granted.cellResult?.grant?.tokenFile !== undefined && granted.requests.length === 1,
  grantedTokenNeverOnStream: granted.tokenOnRpcStream === false,
  notOfferedUnavailableAndNeverAsked: notOffered.cellResult?.ok === false && notOffered.cellResult?.reason === "unavailable" && notOffered.requests.length === 0,
  silentTimesOut: silent.cellResult?.ok === false && silent.cellResult?.reason === "timeout" && silent.requests.length === 1,
  realCredentialsUntouched: JSON.stringify(before) === JSON.stringify(after),
}
const status = Object.values(checks).every(Boolean) ? "PASS" : "FAIL"
const summary = { status, checks, scenarios: [granted, notOffered, silent].map(({ stderrTail: _s, ...rest }) => rest) }
if (evidenceDir !== undefined) writeFileSync(join(evidenceDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`)
console.log(JSON.stringify(summary, null, 2))
process.exit(status === "PASS" ? 0 : 1)

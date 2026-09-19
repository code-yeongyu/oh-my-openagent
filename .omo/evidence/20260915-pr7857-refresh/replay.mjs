import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import http from "node:http"
import { DatabaseSync } from "node:sqlite"
import { spawn, spawnSync } from "node:child_process"
import { once } from "node:events"
import { fileURLToPath } from "node:url"
import { sendSse, textEvents, toolCallEvents } from "../../../.agents/skills/opencode-qa/scripts/lib/fake-openai-events.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, "../../..")
const { QA_BUN, QA_NODE, QA_OPENCODE, QA_RAW, QA_REAL_DB } = process.env
assert(QA_BUN && QA_NODE && QA_OPENCODE && QA_RAW && QA_REAL_DB, "Set explicit QA_BUN, QA_NODE, QA_OPENCODE, QA_RAW and QA_REAL_DB")
function sessionCount(file) {
  const db = new DatabaseSync(file, { readOnly: true })
  try { return db.prepare("SELECT count(*) AS n FROM session").get().n } finally { db.close() }
}
const qaCase = process.env.QA_CASE ?? "fresh"
assert(["fresh", "attached"].includes(qaCase))
const realSessionCountBefore = sessionCount(QA_REAL_DB)
assert.equal(spawnSync(QA_BUN, ["--version"], { encoding: "utf8" }).stdout.trim(), "1.4.0")
assert.match(spawnSync(QA_NODE, ["--version"], { encoding: "utf8" }).stdout.trim(), /^v24\./)
fs.mkdirSync(QA_RAW, { recursive: true })
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "pr7857-isolated-"))
const home = path.join(sandbox, "home")
const project = path.join(sandbox, "project")
for (const dir of [home, project, "config", "data", "state", "cache", "tmp"].map(p => path.isAbsolute(p) ? p : path.join(sandbox, p))) fs.mkdirSync(dir, { recursive: true })
const env = {
  HOME: home, XDG_CONFIG_HOME: path.join(sandbox, "config"), XDG_DATA_HOME: path.join(sandbox, "data"),
  XDG_STATE_HOME: path.join(sandbox, "state"), XDG_CACHE_HOME: path.join(sandbox, "cache"), TMPDIR: path.join(sandbox, "tmp"),
  PATH: `${path.dirname(QA_BUN)}:${path.dirname(QA_NODE)}:/usr/bin:/bin:/usr/sbin:/sbin`,
  OPENCODE_DISABLE_AUTOUPDATE: "1", OPENCODE_DISABLE_MODELS_FETCH: "1", OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
  OPENCODE_DISABLE_CLAUDE_CODE: "1", OPENCODE_DISABLE_EXTERNAL_SKILLS: "1", OMO_DISABLE_PROCESS_CLEANUP: "1",
  DO_NOT_TRACK: "1", CI: "1",
}
const deadline = AbortSignal.timeout(90000)
let child, server, streamReader
const receipt = { case: qaCase, isolation: { environmentCleared: true, inheritedCredentials: false, inheritedConfig: false, inheritedSkills: false, cwdEmptySandbox: true, envKeys: Object.keys(env).sort() }, events: [], provider: [], passed: false }
let expectedSessionID, expectedTerminalMessage, resolveTerminal
const matchesTerminal = event => expectedSessionID !== undefined &&
  event.properties?.sessionID === expectedSessionID &&
  event.properties?.error?.data?.message === expectedTerminalMessage
const terminalObserved = new Promise(resolve => { resolveTerminal = resolve })
const raw = value => fs.appendFileSync(path.join(QA_RAW, "live.jsonl"), JSON.stringify(value) + "\n")
try {
  const build = spawnSync(QA_BUN, ["build", path.join(here, "terminal-probe.ts"), "--outfile", path.join(sandbox, "probe.js"), "--target", "bun", "--format", "esm"], { cwd: repo, encoding: "utf8" })
  raw({ build: build.stderr, exitCode: build.status })
  assert.equal(build.status, 0, "Probe bundle failed")
  const version = spawnSync(QA_OPENCODE, ["--version"], { env, cwd: project, encoding: "utf8" })
  assert.equal(version.status, 0)
  receipt.opencodeVersion = version.stdout.trim()
  let count = 0
  server = http.createServer(async (req, res) => {
    try {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}")
      raw({ providerRequest: body })
      count++
      const output = (body.input ?? []).find(item => item.type === "function_call_output")
      if (output) {
        receipt.provider.push({ branch: "caller-received", output: output.output })
        sendSse(res, textEvents(count, "PR7857_CALLER_RECEIVED"))
      } else if (JSON.stringify(body).includes("PR7857_PARENT")) {
        receipt.provider.push({ branch: "tool-call" })
        sendSse(res, toolCallEvents(count, "qa_terminal_child", "call_pr7857", { attached: qaCase === "attached" }))
      } else {
        receipt.provider.push({ branch: "auxiliary" })
        sendSse(res, textEvents(count, "PR7857 QA"))
      }
    } catch (error) { raw({ providerError: String(error) }); res.writeHead(500).end(String(error)) }
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening", { signal: deadline })
  const config = {
    plugin: [`file://${sandbox}/probe.js`], model: "openai/gpt-fake", small_model: "openai/gpt-fake",
    provider: { openai: { options: { apiKey: "public-fake-key", baseURL: `http://127.0.0.1:${server.address().port}/v1` }, models: { "gpt-fake": { tool_call: true, limit: { context: 200000, output: 8192 } } } } },
    permission: "allow", mcp: {},
  }
  fs.mkdirSync(path.join(env.XDG_CONFIG_HOME, "opencode"), { recursive: true })
  fs.writeFileSync(path.join(env.XDG_CONFIG_HOME, "opencode", "opencode.json"), JSON.stringify(config))
  child = spawn(QA_OPENCODE, ["serve", "--hostname", "127.0.0.1", "--port", "0"], { env, cwd: project, stdio: ["ignore", "pipe", "pipe"] })
  const ready = new Promise((resolve, reject) => {
    let output = ""
    const abort = () => reject(new Error("Server readiness deadline exceeded"))
    deadline.addEventListener("abort", abort, { once: true })
    for (const stream of [child.stdout, child.stderr]) stream.on("data", data => {
      fs.appendFileSync(path.join(QA_RAW, "server.log"), data)
      output += data.toString()
      const match = output.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/)
      if (match) { deadline.removeEventListener("abort", abort); resolve(match[1]) }
    })
    child.once("error", reject)
    child.once("exit", code => reject(new Error(`OpenCode exited ${code} before readiness`)))
  })
  const url = await ready
  const request = async (route, body) => {
    const response = await fetch(url + route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: deadline })
    const text = await response.text()
    raw({ route, status: response.status, text })
    assert(response.ok, `${route}: ${response.status} ${text}`)
    return JSON.parse(text)
  }
  const eventResponse = await fetch(url + "/event", { signal: deadline })
  assert(eventResponse.ok)
  streamReader = eventResponse.body.getReader()
  let connectedResolve
  const connected = new Promise(resolve => { connectedResolve = resolve })
  const consume = (async () => {
    let buffer = ""
    while (true) {
      const { value, done } = await streamReader.read()
      if (done) break
      buffer += new TextDecoder().decode(value)
      let edge
      while ((edge = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, edge); buffer = buffer.slice(edge + 2)
        for (const line of frame.split("\n")) if (line.startsWith("data: ")) {
          const event = JSON.parse(line.slice(6)); raw({ event })
          if (event.type === "server.connected") connectedResolve()
          if (event.type === "session.error") {
            receipt.events.push(event)
            if (matchesTerminal(event)) resolveTerminal(event)
          }
        }
      }
    }
  })()
  // Subscribe and receive the exact connection signal before creating the child.
  await Promise.race([connected, consume.then(() => { throw new Error("SSE closed before connection") })])
  const parent = await request("/session", { title: "PR7857 synchronous caller" })
  const result = await request(`/session/${parent.id}/message`, { agent: "build", model: { providerID: "openai", modelID: "gpt-fake" }, parts: [{ type: "text", text: "PR7857_PARENT: call qa_terminal_child once." }] })
  raw({ result })
  const caller = receipt.provider.find(item => item.branch === "caller-received")
  assert(caller, "No synchronous tool output returned to caller")
  assert.match(String(caller.output), /pr7857-missing/i, "Caller did not receive terminal child error")
  assert(!String(caller.output).includes("timeout"), "Caller received timeout instead of terminal error")
  const db = new DatabaseSync(path.join(env.XDG_DATA_HOME, "opencode", "opencode.db"), { readOnly: true })
  try {
    const childSession = db.prepare("SELECT id FROM session WHERE parent_id = ?").get(parent.id)
    assert(childSession, "Missing child session in sandbox database")
    expectedSessionID = childSession.id
    expectedTerminalMessage = caller.output
    const capturedError = receipt.events.find(matchesTerminal)
    if (capturedError) resolveTerminal(capturedError)
    await Promise.race([terminalObserved, consume.then(() => { throw new Error("SSE closed before matching error") })])
    const messages = db.prepare("SELECT data FROM message WHERE session_id = ?").all(childSession.id).map(row => JSON.parse(row.data))
    const continuationMessages = messages.slice(-2)
    assert.equal(continuationMessages.length, 2)
    assert(continuationMessages.every(message => message.role === "user"), "An assistant error could bypass the PR callback")
    if (qaCase === "fresh") assert.equal(messages.length, 2)
    else {
      assert.equal(messages.length, 4)
      assert.equal(messages[1].role, "assistant")
      assert.equal(messages[1].finish, "stop")
      assert.equal(messages[1].error, undefined)
    }
    const tool = db.prepare("SELECT data FROM part WHERE session_id = ?").all(parent.id).map(row => JSON.parse(row.data)).find(part => part.type === "tool" && part.tool === "qa_terminal_child")
    assert.equal(tool.state.status, "completed")
    assert.equal(tool.state.output, caller.output)
    assert(receipt.events.some(event => event.properties.sessionID === childSession.id && event.properties.error.data.message === caller.output), "SSE error and caller output differ")
    receipt.database = { childMessageRoles: messages.map(message => message.role), childAssistantCount: messages.filter(message => message.role === "assistant").length, continuationAssistantCount: 0, completedBackgroundBeforeContinuation: qaCase === "attached", toolStatus: tool.state.status, toolDurationMs: tool.state.time.end - tool.state.time.start, callerOutputEqualsSseError: true }
    assert(receipt.database.toolDurationMs >= 10000, "Terminal error bypassed the fallback grace")
  } finally { db.close() }
  receipt.isolation.realSessionCountBefore = realSessionCountBefore
  receipt.isolation.realSessionCountAfter = sessionCount(QA_REAL_DB)
  assert.equal(receipt.isolation.realSessionCountAfter, realSessionCountBefore)
  receipt.passed = true
  await streamReader.cancel(); await consume
} catch (error) {
  receipt.failure = String(error).replaceAll(sandbox, "<sandbox>").replaceAll(repo, "<repo>")
  process.exitCode = 1
} finally {
  if (streamReader) await streamReader.cancel().catch(error => raw({ cleanupError: String(error) }))
  if (child && child.exitCode === null) {
    const exited = once(child, "exit")
    const timer = setTimeout(() => { receipt.cleanupForcedKill = true; child.kill("SIGKILL") }, 10000)
    child.kill("SIGTERM")
    try { await exited } finally { clearTimeout(timer) }
  }
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  fs.writeFileSync(path.join(QA_RAW, "sandbox-path.txt"), sandbox + "\n")
  fs.writeFileSync(path.join(here, `p1-${qaCase}-live-result.json`), JSON.stringify(receipt, null, 2) + "\n")
  console.log(JSON.stringify(receipt, null, 2))
}

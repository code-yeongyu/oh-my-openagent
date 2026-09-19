import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import http from "node:http"
import { DatabaseSync } from "node:sqlite"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { fileURLToPath } from "node:url"
import { sendSse, textEvents, toolCallEvents } from "../../../.agents/skills/opencode-qa/scripts/lib/fake-openai-events.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const qaCase = process.env.QA_CASE
assert(["disabled", "recovery"].includes(qaCase))
const hostDb = process.env.QA_HOST_DB
function hostSessionCount() {
  if (!hostDb) return undefined
  const db = new DatabaseSync(hostDb, { readOnly: true })
  try { return db.prepare("SELECT count(*) AS n FROM session").get().n }
  finally { db.close() }
}
const hostSessionsBefore = hostSessionCount()
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "pr7857-p1-"))
const env = { PATH: process.env.PATH, HOME: `${sandbox}/home`, TMPDIR: `${sandbox}/tmp`,
  XDG_CONFIG_HOME: `${sandbox}/config`, XDG_DATA_HOME: `${sandbox}/data`,
  XDG_STATE_HOME: `${sandbox}/state`, XDG_CACHE_HOME: `${sandbox}/cache`,
  OPENCODE_DISABLE_AUTOUPDATE: "1", OPENCODE_DISABLE_MODELS_FETCH: "1", OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
  OPENCODE_DISABLE_CLAUDE_CODE: "1", OPENCODE_DISABLE_EXTERNAL_SKILLS: "1", OMO_DISABLE_PROCESS_CLEANUP: "1",
  DO_NOT_TRACK: "1", CI: "1", QA_CASE: qaCase,
}
const project = `${sandbox}/project`
for (const dir of [project, env.HOME, env.TMPDIR, env.XDG_CONFIG_HOME, env.XDG_DATA_HOME, env.XDG_STATE_HOME, env.XDG_CACHE_HOME]) fs.mkdirSync(dir, { recursive: true })
const deadline = AbortSignal.timeout(90000)
const receipt = { case: qaCase, passed: false, observations: [], errors: [], provider: [],
  isolation: { cleanEnvironment: true, inheritedConfig: false, inheritedCredentials: false, inheritedSkills: false, sandbox: "<temp>", executionSurface: hostDb ? "isolated-native" : "container", hostSessionsBefore } }
let child, reader, consume, server, heldResponse, releaseRecovery = false, count = 0
const flushRecovery = () => {
  if (heldResponse && releaseRecovery) { sendSse(heldResponse, textEvents(++count, "PR7857_RECOVERED")); heldResponse = undefined }
}
try {
  server = http.createServer(async (req, res) => {
    try {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}")
      if (req.url === "/observation") {
        receipt.observations.push(body)
        assert.equal(body.forwardingCount, 1)
        assert.equal(body.notificationHookDisabled, true)
        if (qaCase === "recovery") {
          assert.equal(body.recoveryPending, true)
          assert.equal(body.futureVisibility, null)
          releaseRecovery = true
        } else assert.match(body.futureVisibility, /pr7857-missing/)
        res.writeHead(200).end("ok"); flushRecovery(); return
      }
      const output = (body.input ?? []).find(item => item.type === "function_call_output")
      if (output) {
        receipt.provider.push({ branch: "caller-received", output: output.output })
        sendSse(res, textEvents(++count, "PR7857_CALLER_RECEIVED"))
      } else if (JSON.stringify(body).includes("PR7857_PARENT")) {
        receipt.provider.push({ branch: "tool-call" })
        sendSse(res, toolCallEvents(++count, "qa_terminal_child", "call_pr7857", {}))
      } else if (JSON.stringify(body).includes("PR7857_CHILD")) {
        receipt.provider.push({ branch: "recovery-model", model: body.model })
        assert.equal(qaCase, "recovery")
        heldResponse = res; flushRecovery()
      } else sendSse(res, textEvents(++count, "PR7857 auxiliary"))
    } catch (error) { receipt.providerFailure = String(error); res.writeHead(500).end("QA assertion failed") }
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening", { signal: deadline })
  env.QA_CONTROL = `http://127.0.0.1:${server.address().port}`
  fs.copyFileSync(process.env.QA_BUNDLE, `${sandbox}/probe.js`)
  fs.cpSync(path.resolve(here, "../../../dist/skills"), `${sandbox}/skills`, { recursive: true })
  receipt.publicSkillAssetsStaged = true
  const config = { plugin: [`file://${sandbox}/probe.js`], model: "openai/gpt-fake", small_model: "openai/gpt-fake",
    provider: { openai: { options: { apiKey: "public-fake-key", baseURL: `${env.QA_CONTROL}/v1` },
      models: { "gpt-fake": { tool_call: true, limit: { context: 200000, output: 8192 } } } } }, permission: "allow", mcp: {} }
  fs.mkdirSync(`${env.XDG_CONFIG_HOME}/opencode`, { recursive: true })
  fs.writeFileSync(`${env.XDG_CONFIG_HOME}/opencode/opencode.json`, JSON.stringify(config))
  env.OPENCODE_CONFIG = `${env.XDG_CONFIG_HOME}/opencode/opencode.json`
  child = spawn("opencode", ["serve", "--print-logs", "--hostname", "127.0.0.1", "--port", "0"], { env, cwd: project, stdio: ["ignore", "pipe", "pipe"] })
  const url = await new Promise((resolve, reject) => {
    let output = ""
    const abort = () => reject(new Error("OpenCode readiness deadline"))
    deadline.addEventListener("abort", abort, { once: true })
    for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => {
      output += chunk.toString()
      fs.appendFileSync(path.join(here, `live-${qaCase}-server.txt`), chunk.toString().replaceAll(sandbox, "<sandbox>"))
      const match = output.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/)
      if (match) { deadline.removeEventListener("abort", abort); resolve(match[1]) }
    })
    child.once("error", reject)
    child.once("exit", code => reject(new Error(`OpenCode exited ${code}: ${output.slice(-1500)}`)))
  })
  const request = async (route, body) => {
    const response = await fetch(url + route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: deadline })
    const text = await response.text()
    assert(response.ok, `${route}: ${response.status} ${text}`)
    return JSON.parse(text)
  }
  const stream = await fetch(url + "/event", { signal: deadline })
  assert(stream.ok)
  reader = stream.body.getReader()
  const connected = Promise.withResolvers()
  consume = (async () => {
    let buffer = ""
    while (true) {
      const { value, done } = await reader.read()
      if (done) return
      buffer += new TextDecoder().decode(value)
      let edge
      while ((edge = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, edge); buffer = buffer.slice(edge + 2)
        for (const line of frame.split("\n")) if (line.startsWith("data: ")) {
          const event = JSON.parse(line.slice(6))
          if (event.type === "server.connected") connected.resolve()
          if (event.type === "session.error") receipt.errors.push(event)
        }
      }
    }
  })()
  await Promise.race([connected.promise, consume.then(() => { throw new Error("SSE ended before connected") })])
  const effectiveConfig = await fetch(url + "/config", { signal: deadline }).then(response => response.json())
  receipt.configuredProbe = effectiveConfig.plugin?.includes(`file://${sandbox}/probe.js`) ?? false
  receipt.pluginOrigins = effectiveConfig.plugin_origins
  assert(receipt.configuredProbe, "Explicit probe missing from effective config")
  const toolIds = await fetch(url + "/experimental/tool/ids", { signal: deadline }).then(response => response.json())
  receipt.probeRegistered = toolIds.includes("qa_terminal_child")
  assert(receipt.probeRegistered, "Probe absent from registered tool IDs")
  const parent = await request("/session", { title: "PR7857 P1 caller" })
  receipt.opencodeVersion = parent.version
  await request(`/session/${parent.id}/message`, { agent: "build", model: { providerID: "openai", modelID: "gpt-fake" }, parts: [{ type: "text", text: "PR7857_PARENT call qa_terminal_child once" }] })
  assert.equal(receipt.providerFailure, undefined)
  const caller = receipt.provider.find(item => item.branch === "caller-received")
  assert(caller, "Caller received no tool result")
  assert(!String(caller.output).includes("timeout"))
  const db = new DatabaseSync(`${env.XDG_DATA_HOME}/opencode/opencode.db`, { readOnly: true })
  try {
    const childSession = db.prepare("SELECT id FROM session WHERE parent_id = ?").get(parent.id)
    assert(childSession)
    const error = receipt.errors.find(event => event.properties.sessionID === childSession.id &&
      (qaCase === "recovery" || event.properties.error.data.message === caller.output))
    assert(error, "Missing child session.error on SSE")
    const observation = receipt.observations.find(item => item.sessionID === childSession.id && item.eventID === error.id)
    assert(observation, "Missing exact child observation")
    assert(receipt.errors.some(event => event.id === observation.eventID), "Observation does not match an SSE event")
    const messages = db.prepare("SELECT data FROM message WHERE session_id = ?").all(childSession.id).map(row => JSON.parse(row.data))
    receipt.database = { childMessageRoles: messages.map(message => message.role), matchingChildErrorObserved: true }
    if (qaCase === "disabled") {
      assert.equal(caller.output, error.properties.error.data.message)
      assert(messages.every(message => message.role === "user"))
      receipt.database.callerOutputEqualsSseError = true
    } else { assert.match(caller.output, /PR7857_RECOVERED/); assert(messages.some(message => message.role === "assistant")) }
    receipt.passed = true
  } finally { db.close() }
} catch (error) { receipt.failure = String(error).replaceAll(sandbox, "<sandbox>"); process.exitCode = 1 }
finally {
  if (reader) { await reader.cancel(); await consume.catch(error => { receipt.streamCleanup = String(error) }) }
  if (child && child.exitCode === null) {
    const exited = once(child, "exit")
    const timer = setTimeout(() => { receipt.forcedKill = true; child.kill("SIGKILL") }, 10000)
    child.kill("SIGTERM")
    try { await exited } finally { clearTimeout(timer) }
  }
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  fs.rmSync(sandbox, { recursive: true, force: true })
  receipt.sandboxRemoved = !fs.existsSync(sandbox)
  receipt.isolation.hostSessionsAfter = hostSessionCount()
  if (hostDb && receipt.isolation.hostSessionsAfter !== hostSessionsBefore) {
    receipt.passed = false
    receipt.isolation.failure = "Host session count changed"
    process.exitCode = 1
  }
  fs.writeFileSync(path.join(here, `live-${qaCase}.json`), JSON.stringify(receipt, null, 2) + "\n")
  console.log(JSON.stringify(receipt, null, 2))
}

#!/usr/bin/env node
// Issue #8020: real Senpi RPC CLI, real OMO task component and children, local HTTP provider.
import assert from "node:assert/strict"
import { spawn, execFileSync } from "node:child_process"
import { createServer } from "node:http"
import { once, EventEmitter } from "node:events"
import { mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createInterface } from "node:readline"
import { createSandbox, seedSandbox, credentialDigest } from "./drive.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, "../../../..")
const ptyMode = process.argv.includes("--pty")
const out = process.argv.slice(2).find((arg) => arg !== "--pty") ?? execFileSync("node", [join(repo, ".agents/skills/senpi-qa/scripts/resolve-evidence-dir.mjs"), "--repo-root", repo, "--slug", "20260909-session-dag-suspend-resume"], { encoding: "utf8" }).trim()
mkdirSync(out, { recursive: true })
const sandbox = createSandbox()
seedSandbox(sandbox)
const realDirs = [join(homedir(), ".senpi/agent"), join(homedir(), ".omo/agent")]
const before = realDirs.map(credentialDigest)
const bus = new EventEmitter()
const rows = []
const requestCounts = { done: 0, live: 0, next: 0, cancel: 0, parent: 0 }
const held = new Set()
let child
let stderr = ""
let id = 0
let releaseLive = false
const report = { issue: 8020, surface: `actual Senpi ${ptyMode ? "PTY" : "RPC"} CLI + source OMO task component`, sandbox, checks: {} }
const deadline = (label) => AbortSignal.timeout(30_000)
function eventWhere(predicate, label) {
  const observed = rows.find(predicate)
  if (observed) return Promise.resolve(observed)
  return new Promise((resolveEvent, reject) => {
    const timer = setTimeout(() => {
      bus.off("event", listener)
      reject(new Error(`Timed out waiting for ${label}`))
    }, 30_000)
    const listener = (event) => {
      if (!predicate(event)) return
      clearTimeout(timer)
      bus.off("event", listener)
      resolveEvent(event)
    }
    bus.on("event", listener)
  })
}
async function request(type, data = {}) {
  const requestId = `qa-${++id}`
  const response = eventWhere((event) => event.type === "response" && event.id === requestId, type)
  child.stdin.write(`${JSON.stringify({ id: requestId, type, ...data })}\n`)
  const result = await response
  assert.equal(result.success, true, JSON.stringify(result))
  return result.data
}
async function switchSession(sessionPath) {
  const mark = rows.length
  const result = await request("switch_session", { sessionPath })
  if (!result.cancelled) await eventWhere((event) => rows.indexOf(event) >= mark && event.type === "extension_event" && event.name === "qa.session", "replacement session ready")
  return result
}
const workflow = (data) => request("extension_request", { name: "qa.workflow", data })
const nodeEvent = (node, to) => eventWhere((event) => event.type === "extension_event" && event.name === "omo.dag.event" && event.data?.nodeId === node && event.data?.to === to, `${node}:${to}`)
const taskRecords = () => {
  const path = join(sandbox.cwd, ".omo/senpi-task/tasks")
  return existsSync(path) ? readdirSync(path).filter((name) => name.endsWith(".json")).map((name) => JSON.parse(readFileSync(join(path, name), "utf8"))) : []
}
function reply(response, step) {
  response.writeHead(200, { "content-type": "text/event-stream" })
  const chunk = (delta, finish_reason = null) => response.write(`data: ${JSON.stringify({ id: "qa-completion", object: "chat.completion.chunk", created: 0, model: "mock-1", choices: [{ index: 0, delta, finish_reason }] })}\n\n`)
  chunk({ role: "assistant" })
  if (step.tool) chunk({ tool_calls: [{ index: 0, id: "qa-read", type: "function", function: { name: "read", arguments: JSON.stringify({ path: join(sandbox.cwd, "witness.txt") }) } }] })
  else chunk({ content: step.text })
  chunk({}, step.tool ? "tool_calls" : "stop")
  response.end("data: [DONE]\n\n")
}
const server = createServer((req, res) => {
  const chunks = []
  req.on("data", (chunk) => chunks.push(chunk))
  req.on("end", () => {
    const body = JSON.parse(Buffer.concat(chunks).toString())
    const text = JSON.stringify(body.messages)
    const lane = ["done", "live", "next", "cancel"].find((name) => text.includes(`QA_NODE_${name.toUpperCase()}`)) ?? "parent"
    requestCounts[lane]++
    bus.emit("request", { lane, count: requestCounts[lane] })
    if (lane === "live" && requestCounts.live === 1) return reply(res, { tool: true })
    if ((lane === "live" && !releaseLive) || lane === "cancel") {
      held.add(res)
      res.on("close", () => held.delete(res))
      bus.emit("held", lane)
      return
    }
    reply(res, { text: `QA_RESULT_${lane.toUpperCase()}` })
  })
})
try {
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`
  writeFileSync(join(sandbox.agentDir, "settings.json"), JSON.stringify({ packages: [], defaultProvider: "omo-mock", defaultModel: "mock-1", defaultProjectTrust: "trust", enableRpcSessionSharing: false }))
  writeFileSync(join(sandbox.agentDir, "auth.json"), JSON.stringify({ "omo-mock": { type: "api_key", key: "local-qa-only" } }))
  writeFileSync(join(sandbox.agentDir, "models.json"), JSON.stringify({ providers: { "omo-mock": { api: "openai-completions", baseUrl, apiKey: "local-qa-only", models: [{ id: "mock-1", name: "QA local", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 4096 }] } } }))
  mkdirSync(join(sandbox.cwd, ".omo"), { recursive: true })
  writeFileSync(join(sandbox.cwd, ".omo/omo.json"), JSON.stringify({ memory: { enabled: false }, task: { resume_children: true }, agents: { "qa-worker": { model: "omo-mock/mock-1" } } }))
  writeFileSync(join(sandbox.cwd, "witness.txt"), "QA durable child transcript witness\n")
  const env = {
    PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, LANG: "en_US.UTF-8",
    HOME: sandbox.homeDir, USERPROFILE: sandbox.homeDir,
    SENPI_CODING_AGENT_DIR: sandbox.agentDir, OMO_CODING_AGENT_DIR: sandbox.agentDir, PI_CODING_AGENT_DIR: sandbox.agentDir,
    XDG_CONFIG_HOME: sandbox.xdgConfigHome, XDG_DATA_HOME: sandbox.xdgDataHome, XDG_CACHE_HOME: sandbox.xdgCacheHome, XDG_STATE_HOME: join(sandbox.root, "xdg-state"),
    OMO_DISABLE_TELEMETRY: "1", DO_NOT_TRACK: "1", PI_OFFLINE: "1", SENPI_RPC_CLIENT_CAPABILITIES: "extension_events",
  }
  const senpiCli = process.env.SENPI_QA_CLI ?? join(repo, "node_modules/@code-yeongyu/senpi/dist/cli.js")
  if (ptyMode) {
    const { runSelectorPty } = await import("./session-dag-selector-pty.mjs")
    report.pty = await runSelectorPty({ sandbox, env, senpiCli, extension: join(here, "session-dag-resume-extension.mjs"), out, bus, requestCounts })
    report.status = "PASS"
  } else {
  child = spawn(process.env.BUN_BIN ?? "bun", [senpiCli, "--mode", "rpc", "--no-extensions", "-e", join(here, "session-dag-resume-extension.mjs"), "--provider", "omo-mock", "--model", "mock-1"], { cwd: sandbox.cwd, env, stdio: ["pipe", "pipe", "pipe"] })
  child.stderr.on("data", (chunk) => { stderr += chunk.toString() })
  createInterface({ input: child.stdout }).on("line", (line) => {
    let event
    try { event = JSON.parse(line) } catch { stderr += `\nNON-JSON: ${line}`; return }
    rows.push(event)
    bus.emit("event", event)
  })
  await eventWhere((event) => event.type === "extension_event" && event.name === "qa.session", "initial session ready")
  const a = await request("get_state")
  report.pid = child.pid
  report.sessionA = a.sessionId
  await request("prompt", { message: "QA seed session A" })
  await eventWhere((event) => event.type === "agent_end", "seed A")
  const pathA = (await request("get_state")).sessionFile
  await request("new_session")
  await eventWhere((event) => event.type === "extension_event" && event.name === "qa.session" && event.data.id !== a.sessionId, "B ready")
  await request("prompt", { message: "QA seed session B" })
  const b = await request("get_state")
  // new_session creates a persisted target after the local model answers.
  await eventWhere((event) => event.type === "message_end" && JSON.stringify(event).includes("QA_RESULT_PARENT") && rows.indexOf(event) > rows.findIndex((entry) => entry.command === "new_session"), "seed B")
  const pathB = (await request("get_state")).sessionFile
  await switchSession(pathA)
  const heldLive = once(bus, "held", { signal: deadline("live request") })
  const completed = nodeEvent("done", "completed")
  const started = await workflow({ action: "start", definition: { key: "qa-roundtrip", name: "QA session roundtrip", nodes: [
    { id: "done", prompt: "QA_NODE_DONE", subagent_type: "qa-worker", model: "omo-mock/mock-1" },
    { id: "live", prompt: "QA_NODE_LIVE", subagent_type: "qa-worker", model: "omo-mock/mock-1" },
    { id: "next", prompt: "QA_NODE_NEXT", subagent_type: "qa-worker", model: "omo-mock/mock-1", dependsOn: ["done", "live"] },
  ] } })
  const runId = started.details.run_id
  report.runId = runId
  await completed
  await heldLive
  const beforeVeto = await workflow({ action: "snapshot", run_id: runId })
  await request("extension_request", { name: "qa.veto" })
  assert.equal((await switchSession(pathB)).cancelled, true)
  assert.deepEqual(await workflow({ action: "snapshot", run_id: runId }), beforeVeto)
  report.checks.vetoPreservesRun = true
  const tasksBefore = taskRecords()
  assert.equal(tasksBefore.length, 2)
  const liveBefore = tasksBefore.find((task) => task.owner?.nodeId === "live")
  assert.equal(liveBefore.status, "running")
  await switchSession(pathB)
  const runPath = join(sandbox.cwd, ".omo/senpi-task/dag/runs", `${runId}.json`)
  const paused = JSON.parse(readFileSync(runPath, "utf8"))
  assert.equal(paused.status, "paused")
  assert.equal(paused.leaseHolderPid, undefined)
  assert.equal(paused.previousLeaseHolderPid, child.pid)
  assert.equal(requestCounts.next, 0)
  report.checks.switchPausesWithoutCancellation = true
  report.suspendedTasks = taskRecords().map(({ task_id, status, residency_state }) => ({ task_id, status, residency_state }))
  assert.ok(report.suspendedTasks.every((task) => task.residency_state === "persisted_only"))
  assert.equal(report.suspendedTasks.find((task) => task.task_id === liveBefore.task_id).status, "running")
  releaseLive = true
  const returning = switchSession(pathA)
  const final = await returning
  assert.equal(final.cancelled, false)
  const result = await workflow({ action: "wait", run_id: runId, detach: false })
  const record = JSON.parse(readFileSync(runPath, "utf8"))
  assert.equal(record.status, "completed")
  assert.deepEqual(record.nodes.map(({ id, state }) => [id, state]), [["done", "completed"], ["live", "completed"], ["next", "completed"]])
  assert.equal(requestCounts.done, 1)
  assert.equal(requestCounts.next, 1)
  const tasksAfter = taskRecords()
  assert.equal(tasksAfter.length, 3)
  for (const task of tasksBefore) assert.ok(tasksAfter.some((next) => next.task_id === task.task_id))
  const liveAfter = tasksAfter.find((task) => task.task_id === liveBefore.task_id)
  assert.equal(liveAfter.status, "completed")
  assert.equal(liveAfter.notification.run_epoch, liveBefore.notification.run_epoch + 1)
  report.childIdentity = { taskId: liveAfter.task_id, childSessionBefore: liveBefore.child_session_id, childSessionAfter: liveAfter.child_session_id, epochBefore: liveBefore.notification.run_epoch, epochAfter: liveAfter.notification.run_epoch }
  const done = tasksAfter.find((task) => task.owner?.nodeId === "done")
  assert.equal(done.final_response, "QA_RESULT_DONE")
  assert.equal(liveAfter.final_response, "QA_RESULT_LIVE")
  const history = readFileSync(join(sandbox.cwd, ".omo/senpi-task/dag/events", `${runId}.jsonl`), "utf8").trim().split("\n").map(JSON.parse)
  assert.equal(history.filter((event) => event.type === "dag.run.cancelled").length, 0)
  assert.equal(history.filter((event) => event.type === "dag.node.task-attached" && event.nodeId === "next").length, 1)
  report.checks.samePidResume = true
  report.checks.completedOutputReused = true
  report.checks.pendingAdmittedOnce = true
  report.checks.runningChildReconciled = true
  report.result = result
  report.requests = requestCounts
  report.sessionB = b.sessionId
  writeFileSync(join(out, "live-dag-events.json"), JSON.stringify(history, null, 2))

  // Deliberate workflow cancellation remains destructive, unlike a session switch.
  const heldCancel = once(bus, "held", { signal: deadline("cancel request") })
  const cancelling = await workflow({ action: "start", definition: { key: "qa-cancel", name: "QA deliberate cancel", nodes: [
    { id: "cancel", prompt: "QA_NODE_CANCEL", subagent_type: "qa-worker", model: "omo-mock/mock-1" },
  ] } })
  await heldCancel
  const cancelId = cancelling.details.run_id
  await workflow({ action: "cancel", run_id: cancelId })
  const cancelled = await workflow({ action: "snapshot", run_id: cancelId })
  assert.equal(cancelled.details.snapshot.status, "cancelled")
  assert.equal(taskRecords().find((task) => task.owner?.runId === cancelId).status, "cancelled")
  report.checks.deliberateWorkflowCancel = true
  report.status = "PASS"
  }
} catch (error) {
  report.status = "FAIL"
  report.error = error.stack ?? String(error)
  report.requests = requestCounts
  process.exitCode = 1
} finally {
  if (child && child.exitCode === null) {
    const exited = once(child, "exit", { signal: AbortSignal.timeout(10_000) })
    child.stdin.end()
    try { await exited } catch (error) {
      report.cleanupEscalation = String(error)
      const killed = once(child, "exit", { signal: AbortSignal.timeout(5000) })
      child.kill("SIGKILL")
      await killed
    }
  }
  for (const response of held) response.destroy()
  server.closeAllConnections()
  await new Promise((resolveClose) => server.close(resolveClose))
  if (!ptyMode) {
    writeFileSync(join(out, "live-cli-events.jsonl"), rows.map((row) => JSON.stringify(row)).join("\n") + "\n")
    writeFileSync(join(out, "live-cli-stderr.txt"), stderr)
  }
  report.realCredentialPathsUnchanged = realDirs.every((path, index) => credentialDigest(path) === before[index])
  report.isolation = "Only sandbox HOME/XDG/agent paths and a credential-free environment passed to child; real credential digests compared. No whole-directory unchanged claim."
  report.limitations = [ptyMode ? "PTY mode covers /session informational display and /resume selector cancel; run RPC mode for actual A->B->A." : "RPC mode covers actual A->B->A; run --pty for informational display and selector cancel.", "External terminal-hosted controllers and arbitrary shell job stacks are outside native DAG ownership."]
  rmSync(sandbox.root, { recursive: true, force: true })
  report.cleaned = !existsSync(sandbox.root) && (!child || child.exitCode !== null || child.signalCode !== null)
  if (!report.realCredentialPathsUnchanged || !report.cleaned) {
    report.status = "FAIL"
    process.exitCode = 1
  }
  writeFileSync(join(out, ptyMode ? "pty-report.json" : "live-report.json"), JSON.stringify(report, null, 2) + "\n")
  console.log(JSON.stringify(report, null, 2))
}

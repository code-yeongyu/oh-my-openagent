import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:http"
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, watch, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createSandbox, seedSandbox, credentialDigest } from "../../packages/omo-senpi/scripts/qa/drive.mjs"

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const args = process.argv.slice(2)
const out = args[args.indexOf("--out") + 1]
const scenario = args[args.indexOf("--case") + 1]
assert.ok(["host-admission", "host-admission-process", "park-batched-yields", "park-batched-yields-process"].includes(scenario))
const batched = scenario.startsWith("park-batched-yields")
const executionMode = scenario.endsWith("-process") ? "process" : "in-process"
assert.ok(out && out.startsWith("/"), "--out must be an absolute JSON path")
const cli = fileURLToPath(new URL("./cli.js", import.meta.resolve("@code-yeongyu/senpi")))
const sandbox = createSandbox()
seedSandbox(sandbox)
writeFileSync(join(sandbox.root, "workpool-qa-owner.json"), JSON.stringify({ out, scenario, source: import.meta.url }))
const state = join(sandbox.cwd, ".omo", "senpi-task")
mkdirSync(join(state, "tasks"), { recursive: true })
const before = credentialDigest(join(homedir(), ".senpi", "agent"))
const beforeOmo = credentialDigest(join(homedir(), ".omo", "agent"))
const events = []
let parentStep = 0
let workerStep = 0
let poolId
let receipt
const keyedYields = []
let blockerRequests = 0
const nextBlocker = Promise.withResolvers()
const parked = Promise.withResolvers()
const revivedTerminal = Promise.withResolvers()
let resolveBlocker
const blocker = new Promise(resolve => { resolveBlocker = resolve })
let resolveTerminal
const terminal = new Promise(resolve => { resolveTerminal = resolve })
const readPool = () => poolId === undefined ? undefined : JSON.parse(readFileSync(join(state, "workpools", `${poolId}.json`), "utf8"))
const watcher = watch(join(state, "tasks"), () => {
  const pool = readPool()
  const id = pool?.workers[0]?.task_id
  if (!id || !existsSync(join(state, "tasks", `${id}.json`))) return
  const record = JSON.parse(readFileSync(join(state, "tasks", `${id}.json`), "utf8"))
  if (record.status === "completed" && record.notification.run_epoch === 0) resolveTerminal(record)
  if (record.residency_state === (executionMode === "process" ? "rpc_detached" : "persisted_only") && record.notification.run_epoch === 0) parked.resolve(record)
  if (record.status === "completed" && record.notification.run_epoch === 1) revivedTerminal.resolve(record)
})
function toolResult(body) {
  const messages = body.messages.filter(message => message.role === "tool")
  const last = messages.at(-1)
  assert.equal(typeof last?.content, "string")
  return JSON.parse(last.content)
}
function send(response, step) {
  response.writeHead(200, { "content-type": "text/event-stream" })
  const delta = typeof step === "string" ? { content: step } : {
    tool_calls: [{ index: 0, id: `fixture-${events.length}`, type: "function", function: { name: step.name, arguments: JSON.stringify(step.args) } }],
  }
  for (const [part, finish] of [[{ role: "assistant" }, null], [delta, null], [{}, typeof step === "string" ? "stop" : "tool_calls"]]) {
    response.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 0, model: "fixture", choices: [{ index: 0, delta: part, finish_reason: finish }] })}\n\n`)
  }
  response.end("data: [DONE]\n\n")
}
async function respond(body, response) {
  const names = (body.tools ?? []).map(tool => tool.function.name)
  const parent = names.includes("task")
  const worker = !parent && names.includes("workpool")
  events.push({ kind: "request", parent, worker, step: parent ? parentStep : workerStep })
  if (!parent && !worker) { await (blockerRequests++ === 0 ? blocker : nextBlocker.promise); send(response, "BLOCKER_DONE"); return }
  if (worker) {
    assert.ok(!names.includes("workflow") && !names.some(name => name.startsWith("task_") || name.startsWith("team_")))
    const step = workerStep++
    if (step === 0 || (batched && step === 2)) {
      const keys = step === 0 ? ["a"] : ["b", "c"]
      const pool = readPool()
      if (step === 2) {
        assert.deepEqual(pool.items.filter(item => item.status === "assigned").map(item => item.key), keys)
        assert.equal(pool.workers[0].run_epoch, 1)
        events.push({ kind: "batched-revive-request", keys, worker: pool.workers[0] })
      }
      send(response, { name: "workpool", args: { op: "yield", results: [...(step === 2 ? [null] : []), ...keys.map(key => ({ key, data: { ok: true, key } }))] } }); return
    }
    const yielded = toolResult(body)
    if (step === 3) assert.deepEqual(yielded.results.map(result => result.status), ["refused", "accepted", "accepted"])
    else assert.ok(yielded.results.every(result => result.status === "accepted"))
    keyedYields.push(yielded)
    send(response, "WORKPOOL_QA_CHILD_DONE")
    return
  }
  if (batched && parentStep >= 5) {
    switch (parentStep++) {
      case 5: send(response, { name: "workpool", args: { op: "push", pool_id: poolId, items: [{ key: "b", input: 2 }] } }); return
      case 6:
        assert.equal(readPool().items.find(item => item.key === "b").status, "queued")
        send(response, { name: "workpool", args: { op: "push", pool_id: poolId, items: [{ key: "c", input: 3 }] } }); return
      case 7:
        assert.deepEqual(readPool().items.filter(item => item.status === "queued").map(item => item.key), ["b", "c"])
        events.push({ kind: "two-pushes-queued", pool: readPool() })
        nextBlocker.resolve()
        const revived = await revivedTerminal.promise
        assert.equal(revived.notification.run_epoch, 1)
        send(response, { name: "workpool", args: { op: "inspect", pool_id: poolId } }); return
      case 8:
        assert.deepEqual(toolResult(body).items.map(item => item.status), ["completed", "completed", "completed"])
        send(response, { name: "workpool", args: { op: "close", pool_id: poolId } }); return
      case 9:
        assert.equal(toolResult(body).status, "closing")
        send(response, { name: "workpool", args: { op: "cancel", pool_id: poolId } }); return
      default:
        assert.equal(toolResult(body).status, "cancelled")
        send(response, "WORKPOOL_QA_PARENT_DONE"); return
    }
  }
  switch (parentStep++) {
    case 0: send(response, { name: "task", args: { category: "fixture", prompt: "Hold the fixture lane", run_in_background: true } }); return
    case 1: send(response, { name: "workpool", args: { op: "create", name: "reserved", agent: { category: "fixture", prompt: "fixture" }, mode: "fresh", tools: [] } }); return
    case 2:
      assert.equal(toolResult(body).error.code, "tools_unavailable")
      send(response, { name: "workpool", args: { op: "create", name: "fixture", agent: { category: "fixture", prompt: "Process assigned fixture" }, mode: "keep_alive" } }); return
    case 3:
      poolId = toolResult(body).pool_id
      assert.match(poolId, /^wp_[0-9a-f]{32}$/)
      send(response, { name: "workpool", args: { op: "push", pool_id: poolId, items: [{ key: "a", input: { n: 1 } }] } }); return
    case 4:
      receipt = toolResult(body)
      assert.equal(receipt.item_ids.length, 1)
      assert.equal(workerStep, 0, "push receipt must arrive before any worker grant")
      assert.equal(readPool().items[0].item_id, receipt.item_ids[0].item_id)
      assert.equal(readPool().items[0].status, "queued")
      events.push({ kind: "push-returned-before-grant", receipt })
      resolveBlocker()
      const record = await terminal
      assert.equal(record.execution_mode, executionMode)
      if (executionMode === "process") assert.equal(typeof record.pid, "number")
      events.push({ kind: "worker-terminal", task_id: record.task_id, run_epoch: record.notification.run_epoch, execution_mode: record.execution_mode, pid: record.pid })
      if (batched) {
        const parkedRecord = await parked.promise
        assert.equal(parkedRecord.task_id, record.task_id)
        events.push({ kind: "worker-parked", record: parkedRecord })
        send(response, { name: "task", args: { category: "fixture", prompt: "Hold the batched-turn lane", run_in_background: true } }); return
      }
      send(response, { name: "workpool", args: { op: "inspect", pool_id: poolId } }); return
    case 5:
      assert.equal(toolResult(body).items[0].status, "completed")
      send(response, { name: "workpool", args: { op: "close", pool_id: poolId } }); return
    case 6:
      assert.equal(toolResult(body).status, "closing")
      send(response, { name: "workpool", args: { op: "cancel", pool_id: poolId } }); return
    default:
      assert.equal(toolResult(body).status, "cancelled")
      send(response, "WORKPOOL_QA_PARENT_DONE")
  }
}
const server = createServer((request, response) => {
  const chunks = []
  request.on("data", chunk => chunks.push(chunk))
  request.on("end", () => {
    void respond(JSON.parse(Buffer.concat(chunks).toString("utf8")), response).catch(error => {
      events.push({ kind: "fixture-error", message: String(error) })
      response.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: String(error) } }))
    })
  })
})
const listening = once(server, "listening")
server.listen(0, "127.0.0.1")
await listening
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`
writeFileSync(join(sandbox.agentDir, "models.json"), JSON.stringify({ providers: { fixture: { baseUrl, api: "openai-completions", apiKey: "fixture", models: [{ id: "fixture", name: "fixture", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }))
writeFileSync(join(sandbox.cwd, ".omo", "omo.json"), JSON.stringify({ task: { global_concurrency: 1, default_concurrency: 1, default_execution_mode: executionMode, ...(batched ? { resident_idle_timeout_ms: 37 } : {}) }, categories: { fixture: { model: "fixture/fixture" } }, memory: { enabled: false } }))
const env = { ...process.env, HOME: sandbox.homeDir, USERPROFILE: sandbox.homeDir, OMO_CODING_AGENT_DIR: sandbox.agentDir, SENPI_CODING_AGENT_DIR: sandbox.agentDir, PI_CODING_AGENT_DIR: sandbox.agentDir, XDG_CONFIG_HOME: sandbox.xdgConfigHome, XDG_DATA_HOME: sandbox.xdgDataHome, XDG_CACHE_HOME: sandbox.xdgCacheHome, XDG_STATE_HOME: join(sandbox.root, "xdg-state"), PI_OFFLINE: "1", OMO_SENPI_QA: "1", OMO_DISABLE_TELEMETRY: "1" }
for (const key of Object.keys(env)) if (key.endsWith("_PACKAGE_DIR") || /API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key)) delete env[key]
let stdout = ""
let stderr = ""
const child = spawn("node", [cli, "-p", "--mode", "json", "--provider", "fixture", "--model", "fixture", "Exercise host workpool admission"], { cwd: sandbox.cwd, env, stdio: ["ignore", "pipe", "pipe"] })
const exited = once(child, "exit")
child.stdout.on("data", chunk => { stdout += chunk })
child.stderr.on("data", chunk => { stderr += chunk })
const deadline = setTimeout(() => child.kill("SIGKILL"), 90000)
let report
try {
  const [code, exitSignal] = await exited
  assert.equal(code, 0, `CLI exit ${code}/${exitSignal}: ${stderr}`)
  assert.ok(stdout.includes("WORKPOOL_QA_PARENT_DONE"))
  assert.equal(events.filter(event => event.kind === "fixture-error").length, 0)
  assert.equal(workerStep, batched ? 4 : 2)
  assert.equal(readdirSync(join(state, "tasks")).filter(name => /^st_.*\.json$/.test(name)).length, batched ? 3 : 2)
  const pool = readPool()
  assert.equal(pool.status, "cancelled")
  report = { status: "PASS", executionMode, scenario, events, pool, keyedYields, provider: "local deterministic HTTP fixture", paidProviderCalls: 0,
    realSenpiUntouched: before === credentialDigest(join(homedir(), ".senpi", "agent")), realOmoProtectedStateUnchanged: beforeOmo === credentialDigest(join(homedir(), ".omo", "agent")),
    isolatedAgentDir: sandbox.agentDir, cli, bundleSha256: createHash("sha256").update(readFileSync(join(repo, "packages/omo-senpi/plugin/extensions/omo-task.js"))).digest("hex") }
  assert.ok(report.realSenpiUntouched && report.realOmoProtectedStateUnchanged)
} catch (error) { report = { status: "FAIL", error: String(error), events }; process.exitCode = 1 }
finally {
  clearTimeout(deadline)
  watcher.close()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  const workerPids = readdirSync(join(state, "tasks")).filter(name => /^st_.*\.json$/.test(name)).flatMap(name => {
    const record = JSON.parse(readFileSync(join(state, "tasks", name), "utf8"))
    return typeof record.pid === "number" ? [record.pid] : []
  })
  const survivingPids = workerPids.filter(pid => {
    try { process.kill(pid, 0); return true } catch (error) { if (error.code === "ESRCH") return false; throw error }
  })
  if (survivingPids.length > 0) { report.status = "FAIL"; report.error = "Owned worker survived parent exit"; process.exitCode = 1 }
  else rmSync(sandbox.root, { recursive: true, force: true })
  report.cleanup = { childExited: child.exitCode !== null || child.signalCode !== null, workerPids, survivingPids, namespaceRemoved: !existsSync(sandbox.root) }
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(report, null, 2))
  writeFileSync(`${out}.stdout.log`, stdout)
  writeFileSync(`${out}.stderr.log`, stderr)
}
console.log(JSON.stringify({ status: report.status, cleanup: report.cleanup }))

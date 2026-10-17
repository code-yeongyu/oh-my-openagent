#!/usr/bin/env bun
// Live QA for the agent toolkit's layer-2 seam (#10316): a real AgentSession with the packaged
// plugin and real eval kernels, one fresh process per phase so a replay is a real restart. A real
// `senpi --mode rpc` host on the sandbox's legacy endpoint holds the session open, so the thread
// address book lists it live and #9551's caller gate resolves the engine's session id, as in use.
//   off     - no `dori` section: the SDK has no namespace properties.
//   prepare - a fake dori host registers reply_mark/send_post; the session file gets its turn.
//   first   - the eleven namespaces and help() appear; one eval cell calls reply.mark.
//   replay  - the same persisted turn runs the same cell: the recorded result, no second dispatch.
//   diverge - the same turn calls send.post at the index that recorded reply.mark: typed stop.
// The supervisor counts dispatches in the gateway store itself, never trusting the cell's answer.
import assert from "node:assert/strict"
import { Database } from "bun:sqlite"
import { spawn } from "node:child_process"
import { createConnection } from "node:net"
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const script = fileURLToPath(import.meta.url)
const packageRoot = resolve(dirname(script), "../..")
const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(name)
  return index < 0 ? fallback : resolve(args[index + 1])
}
const pluginRoot = option("--plugin-root", join(packageRoot, "plugin"))
const fixture = join(packageRoot, "src/components/thread/gateway/testing/dori-layer2-extension.mjs")
const parameters = { type: "object", additionalProperties: false, properties: { note: { type: "string" } } }
const SDK_IMPORT = 'const { agentToolkit } = await import(`${env("OMO_AGENT_TOOLKIT_SDK_ROOT")}/sdk.js`)'
const CELLS = {
  off: `${SDK_IMPORT}; print("QA_KEYS " + JSON.stringify(Object.keys(agentToolkit)))`,
  first: `${SDK_IMPORT}; print("QA_KEYS " + JSON.stringify(Object.keys(agentToolkit))); const help = await agentToolkit.help(); print("QA_HELP " + JSON.stringify(help.result.layer2)); print("QA_RESULT " + JSON.stringify(await agentToolkit.reply.mark({ note: "qa" })))`,
  replay: `${SDK_IMPORT}; print("QA_RESULT " + JSON.stringify(await agentToolkit.reply.mark({ note: "qa" })))`,
  diverge: `${SDK_IMPORT}; try { print("QA_RESULT " + JSON.stringify(await agentToolkit.send.post({ note: "qa" }))) } catch (error) { print("QA_ERROR " + JSON.stringify({ name: error.name, code: error.code, key: error.key, recordedOp: error.recordedOp, attemptedOp: error.attemptedOp, message: error.message })) }`,
}

async function worker(sandbox, phase) {
  const cwd = join(sandbox, "project")
  const agentDir = join(sandbox, "agent")
  const statePath = join(sandbox, "session.json")
  const { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } = await import("@code-yeongyu/senpi")
  if (phase === "prepare") {
    const { createGatewayStore } = await import(pathToFileURL(join(packageRoot, "src/components/thread/gateway/store.ts")).href)
    const store = createGatewayStore({ agentDir })
    const registered = await store.registerStoreExtension({
      name: "dori",
      moduleUrl: pathToFileURL(fixture).href,
      migrations: [["CREATE TABLE dori_calls (id INTEGER PRIMARY KEY, op TEXT NOT NULL, args TEXT NOT NULL)"]],
      sessionCallable: [
        { op: "replyMark", toolName: "reply_mark", description: "Mark a reply debt handled (QA fake host).", parameters },
        { op: "sendPost", toolName: "send_post", description: "Post to a room (QA fake host).", parameters },
      ],
    })
    console.log(`QA_REGISTER ${JSON.stringify(registered)}`)
    assert.equal(registered.kind, "ok")
    await store.dispose()
  }
  let sessionManager
  if (phase === "off") sessionManager = SessionManager.inMemory(cwd)
  else if (phase === "prepare") {
    sessionManager = SessionManager.create(cwd)
    sessionManager.appendMessage({ role: "assistant", content: [{ type: "text", text: "qa turn" }], api: "qa", provider: "qa", model: "qa", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: Date.now() })
    writeFileSync(statePath, JSON.stringify({ file: sessionManager.getSessionFile(), sessionId: sessionManager.getSessionId(), leaf: sessionManager.getLeafId() }))
    console.log(`QA_PREPARED ${readFileSync(statePath, "utf8")}`)
    return
  } else sessionManager = SessionManager.open(JSON.parse(readFileSync(statePath, "utf8")).file)
  console.log(`QA_SESSION ${JSON.stringify({ phase, sessionId: sessionManager.getSessionId(), leaf: sessionManager.getLeafId(), file: sessionManager.getSessionFile?.() ?? null })}`)
  const settingsManager = SettingsManager.inMemory({})
  const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager, additionalExtensionPaths: [pluginRoot] })
  await loader.reload()
  assert.deepEqual(loader.getExtensions().errors, [], "extension load errors")
  const { session } = await createAgentSession({ cwd, agentDir, settingsManager, resourceLoader: loader, sessionManager })
  try {
    await session.bindExtensions({})
    console.log(`QA_GATE OMO_DORI_TOOLKIT=${process.env.OMO_DORI_TOOLKIT ?? "<unset>"}`)
    if (phase !== "off") {
      const until = Date.now() + 15_000
      while (!session.getAllTools().some((tool) => tool.name === "ext_dori_reply_mark")) {
        assert.ok(Date.now() < until, "ext_dori_reply_mark was never registered at session_start")
        await new Promise((next) => setImmediate(next))
      }
    }
    const result = await session.executeTool("eval", { language: "js", code: CELLS[phase], summary: `dori toolkit QA ${phase}` }, { signal: AbortSignal.timeout(60_000) })
    const text = result.content.filter((part) => part.type === "text").map((part) => part.text).join("\n")
    console.log(`QA_CELL_OUTPUT\n${text}`)
    assert.notEqual(result.isError, true, text)
  } finally {
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" })
    session.dispose()
  }
}

function dispatches(agentDir) {
  const path = join(agentDir, "gateway", "gateway.sqlite")
  if (!existsSync(path)) return []
  const db = new Database(path)
  try {
    const table = db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%dori_calls'").get()
    return table === null ? [] : db.query(`SELECT op, args FROM "${table.name}" ORDER BY id`).all()
  } finally {
    db.close()
  }
}

const line = (output, tag) => {
  const found = output.split("\n").find((text) => text.startsWith(`${tag} `))
  return found === undefined ? undefined : JSON.parse(found.slice(tag.length + 1))
}

function rpcClient(socketPath) {
  return new Promise((resolveClient, reject) => {
    const socket = createConnection(socketPath)
    const pending = new Map()
    let buffer = ""
    let sequence = 0
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8")
      for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
        const text = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (text.length === 0) continue
        let record
        try { record = JSON.parse(text) } catch { continue }
        if (record.type === "response" && pending.has(record.id)) {
          pending.get(record.id)(record)
          pending.delete(record.id)
        }
      }
    })
    socket.once("error", reject)
    socket.once("connect", () => resolveClient({
      request: (command) => new Promise((resolveRequest, rejectRequest) => {
        const id = `qa-${++sequence}`
        const timer = setTimeout(() => { pending.delete(id); rejectRequest(new Error(`${command.type} timed out`)) }, 30_000)
        pending.set(id, (record) => { clearTimeout(timer); record.success === true ? resolveRequest(record.data) : rejectRequest(new Error(`${command.type} failed: ${JSON.stringify(record.error ?? record)}`)) })
        socket.write(`${JSON.stringify({ id, ...command })}\n`)
      }),
      close: () => socket.destroy(),
    }))
  })
}

async function supervise() {
  const evidenceDir = option("--evidence-dir", join(process.cwd(), ".omo/evidence/dori-toolkit-replay-qa"))
  mkdirSync(evidenceDir, { recursive: true })
  const transcript = join(evidenceDir, "task-15-dori-extension-v1.txt")
  writeFileSync(transcript, `COMMAND ${JSON.stringify(process.argv)}\nPLUGIN_ROOT ${pluginRoot}\n`)
  const log = (text) => { appendFileSync(transcript, text); process.stdout.write(text) }
  const sandbox = mkdtempSync(join(tmpdir(), "omo-dori-toolkit-qa-"))
  for (const directory of ["agent", "project", "home/.omo", "tmp"]) mkdirSync(join(sandbox, directory), { recursive: true })
  const { isolatedEnvironment, processGroupMembers } = await import("./agent-toolkit-eval-sdk-qa-support.mjs")
  const configPath = join(sandbox, "home/.omo/omo.json")
  const checks = []
  const check = (name, ok, detail) => { checks.push({ name, ok }); log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}\n`) }
  const socketPath = join(sandbox, "agent", "rpc", "rpc.sock")
  mkdirSync(dirname(socketPath), { recursive: true })
  const environment = () => ({ ...isolatedEnvironment(sandbox, packageRoot), SENPI_RPC_SOCKET: socketPath, OMO_RPC_SOCKET: socketPath })
  const run = (phase) => new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [script, "--worker", sandbox, phase, "--plugin-root", pluginRoot], { cwd: join(sandbox, "project"), env: environment(), detached: true, stdio: ["ignore", "pipe", "pipe"] })
    let output = ""
    const collect = (chunk) => { output += chunk.toString(); log(chunk.toString()) }
    child.stdout.on("data", collect)
    child.stderr.on("data", collect)
    const deadline = setTimeout(() => { log(`FAIL ${phase} deadline\n`); process.kill(-child.pid, "SIGKILL") }, 120_000)
    child.once("error", reject)
    child.once("close", (code) => {
      clearTimeout(deadline)
      const survivors = processGroupMembers(child.pid)
      log(`PHASE ${phase} exit=${code} survivors=${JSON.stringify(survivors)}\n`)
      if (survivors.length > 0) process.kill(-child.pid, "SIGKILL")
      resolveRun({ code, output, survivors })
    })
  })
  let exitCode = 1
  let host
  let client
  const startHost = () => new Promise((resolveHost, reject) => {
    const cli = join(packageRoot, "../../node_modules/@code-yeongyu/senpi/dist/cli.js")
    const child = spawn(process.execPath, [cli, "--mode", "rpc", "--multi-session", "--listen", `unix://${socketPath}`], { cwd: join(sandbox, "project"), env: environment(), detached: true, stdio: ["ignore", "pipe", "pipe"] })
    let seen = ""
    const timer = setTimeout(() => reject(new Error(`rpc host not ready: ${seen.slice(-2000)}`)), 60_000)
    const onChunk = (chunk) => {
      seen += chunk.toString()
      if (seen.includes(`listening on unix://${socketPath}`)) { clearTimeout(timer); resolveHost(child) }
    }
    child.stdout.on("data", onChunk)
    child.stderr.on("data", onChunk)
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`rpc host exited ${code}: ${seen.slice(-2000)}`)) })
  })
  try {
    const agentDir = join(sandbox, "agent")
    writeFileSync(configPath, JSON.stringify({}))
    const off = await run("off")
    const offKeys = line(off.output, "QA_KEYS") ?? []
    check("off: no dori section means no namespace properties", off.code === 0 && offKeys.length > 0 && !offKeys.includes("reply") && !offKeys.includes("work"), JSON.stringify(offKeys))

    writeFileSync(configPath, JSON.stringify({ dori: {} }))
    const prepare = await run("prepare")
    const prepared = line(prepare.output, "QA_PREPARED")
    check("prepare: the fake dori host registered and the session has its turn", prepare.code === 0 && typeof prepared?.file === "string" && typeof prepared?.leaf === "string", JSON.stringify(prepared))
    host = await startHost()
    log(`HOST pid=${host.pid} socket=${socketPath}\n`)
    client = await rpcClient(socketPath)
    const opened = await client.request({ type: "open_session", sessionPath: prepared.file, cwd: join(sandbox, "project") })
    const listed = await client.request({ type: "list_sessions" })
    log(`HOST_OPEN ${JSON.stringify(opened)}\nHOST_LIST ${JSON.stringify(listed)}\n`)
    check("host: the real rpc host lists the session live", (listed.sessions ?? []).some((session) => (session.durableSessionId ?? session.sessionId) === prepared.sessionId), `durable=${prepared.sessionId}`)
    const first = await run("first")
    const firstKeys = line(first.output, "QA_KEYS") ?? []
    const namespaces = ["route", "reply", "room", "send", "thread", "describe", "file", "rules", "iam", "call", "work"]
    check("first: the dori section adds all eleven namespaces", namespaces.every((name) => firstKeys.includes(name)), JSON.stringify(firstKeys))
    const help = line(first.output, "QA_HELP")
    check("first: help() lists the registered functions with signatures", help?.functions?.map((fn) => fn.signature).join(" | ") === "reply.mark(args: { note?: string }): Promise<StoreExtensionResult> | send.post(args: { note?: string }): Promise<StoreExtensionResult>", JSON.stringify(help))
    const firstResult = line(first.output, "QA_RESULT")
    const afterFirst = dispatches(agentDir)
    check("first: reply.mark dispatched once with the engine-stamped caller", firstResult?.kind === "ok" && firstResult.value?.dispatch_number === 1 && typeof firstResult.value?.caller === "string" && afterFirst.length === 1, `result=${JSON.stringify(firstResult)} store=${JSON.stringify(afterFirst)}`)

    const replay = await run("replay")
    const replayResult = line(replay.output, "QA_RESULT")
    const afterReplay = dispatches(agentDir)
    check("replay: the same turn returns the recorded result without a second dispatch", JSON.stringify(replayResult) === JSON.stringify(firstResult) && afterReplay.length === 1, `result=${JSON.stringify(replayResult)} store_rows=${afterReplay.length}`)

    const diverge = await run("diverge")
    const stopped = line(diverge.output, "QA_ERROR")
    const afterDiverge = dispatches(agentDir)
    check("diverge: send.post where reply.mark was recorded stops with the typed divergence", stopped?.name === "ToolkitReplayStopError" && stopped.code === "toolkit_replay_divergence" && stopped.recordedOp === "reply.mark" && stopped.attemptedOp === "send.post" && afterDiverge.length === 1, `error=${JSON.stringify(stopped)} store_rows=${afterDiverge.length}`)

    const journal = new Database(join(agentDir, "gateway", "toolkit-replay.sqlite"))
    try {
      log(`JOURNAL ${JSON.stringify(journal.query("SELECT replay_key, op, state FROM toolkit_replay").all())}\n`)
    } finally {
      journal.close()
    }
    check("no phase left a process behind", [off, prepare, first, replay, diverge].every((phase) => phase.survivors.length === 0), "process groups empty")
    exitCode = checks.every((entry) => entry.ok) ? 0 : 1
  } finally {
    client?.close()
    if (host?.pid) {
      try { process.kill(-host.pid, "SIGTERM") } catch {}
      await new Promise((done) => (host.exitCode !== null || host.signalCode !== null ? done() : host.once("exit", done)))
      const survivors = processGroupMembers(host.pid)
      if (survivors.length > 0) process.kill(-host.pid, "SIGKILL")
      log(`HOST_STOP pid=${host.pid} survivors=${JSON.stringify(survivors)}\n`)
    }
    rmSync(sandbox, { recursive: true, force: true })
    log(`CLEANUP sandbox=${sandbox} removed=${!existsSync(sandbox)}\n`)
  }
  log(`${checks.filter((entry) => entry.ok).length}/${checks.length} checks passed\n`)
  return exitCode
}

if (args[0] === "--worker") await worker(resolve(args[1]), args[2])
else process.exitCode = await supervise()

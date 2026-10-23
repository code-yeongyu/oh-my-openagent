#!/usr/bin/env bun
// Live QA for the agent toolkit's layer-2 seam (#10316). A real `senpi --mode rpc` host loads the
// built plugin and a scripted mock model, so the first turn is a real model turn: its assistant entry
// holds an `eval` tool call with a known id, the real kernel runs the cell, and the SDK must read that
// cell from the stack for the engine to accept the call. The host keeps the sessions live, so the
// thread address book lists them and #9551's caller gate resolves them as in use. Every later phase
// runs in a fresh worker process (a replay is a restart) and sends exactly what the kernel carries.
//   off     - no `dori` section: the SDK has no namespace properties.
//   first   - real turn: reply.mark, then two concurrent send.post calls in one cell.
//   replay  - the same three calls in the same cell: recorded results, no new dispatch.
//   diverge - same index with other arguments, then another op: typed divergence naming what differed.
//   forged  - a cell the engine did not issue (an eval cell outside any turn, a foreign id): refused.
//   expired - a turn written eight days ago: typed expired stop, no dispatch.
// The supervisor counts dispatches in the gateway store itself and reads the journal keys.
import assert from "node:assert/strict"
import { Database } from "bun:sqlite"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createConnection } from "node:net"
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
const mockProvider = join(packageRoot, "scripts/qa/task-e2e-mock-provider.ts")
const parameters = { type: "object", additionalProperties: false, properties: { note: { type: "string" } } }
const SDK_IMPORT = 'const { agentToolkit } = await import(`${env("OMO_AGENT_TOOLKIT_SDK_ROOT")}/sdk.js`)'
const FIRST_CELL = `${SDK_IMPORT}; print("QA_KEYS " + JSON.stringify(Object.keys(agentToolkit))); const help = await agentToolkit.help(); print("QA_HELP " + JSON.stringify(help.result.layer2)); const mark = await agentToolkit.reply.mark({ note: "qa" }); const posts = await Promise.all([agentToolkit.send.post({ note: "p1" }), agentToolkit.send.post({ note: "p2" })]); print("QA_FIRST " + JSON.stringify({ mark, posts }))`
const OFF_CELL = `${SDK_IMPORT}; print("QA_KEYS " + JSON.stringify(Object.keys(agentToolkit))); print("QA_TOOLS " + JSON.stringify((await tool_schema()).tools.filter(name => name.startsWith("ext_dori_"))))`
const FORGED_CELL = `${SDK_IMPORT}; try { print("QA_EVAL_RESULT " + JSON.stringify(await agentToolkit.reply.mark({ note: "qa" }))) } catch (error) { print("QA_EVAL_ERROR " + JSON.stringify({ name: error.name, code: error.code })) }`
const QA_CELL = "cell-qa-1"
const OLD_CELL = "cell-qa-old"

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value === null || typeof value !== "object") return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
}
const argsHash = (value) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")

async function worker(sandbox, phase) {
  const cwd = join(sandbox, "project")
  const agentDir = join(sandbox, "agent")
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
    await store.dispose()
    const old = SessionManager.create(cwd)
    old.appendMessage({ role: "assistant", content: [{ type: "toolCall", id: OLD_CELL, name: "eval", arguments: {} }], api: "qa", provider: "qa", model: "qa", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "toolUse", timestamp: Date.now() })
    const file = old.getSessionFile()
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
    const lines = readFileSync(file, "utf8").trim().split("\n").map((text) => JSON.parse(text))
    for (const entry of lines) if (entry.type === "message") entry.timestamp = eightDaysAgo
    writeFileSync(file, `${lines.map((entry) => JSON.stringify(entry)).join("\n")}\n`)
    console.log(`QA_PREPARED ${JSON.stringify({ registered, oldFile: file, oldSessionId: old.getSessionId() })}`)
    return
  }
  const plan = phase === "off" ? { calls: [], cell: OFF_CELL } : JSON.parse(readFileSync(join(sandbox, `${phase}.json`), "utf8"))
  const sessionManager = plan.file === undefined ? SessionManager.inMemory(cwd) : SessionManager.open(plan.file)
  const settingsManager = SettingsManager.inMemory({})
  const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager, additionalExtensionPaths: [pluginRoot] })
  await loader.reload()
  assert.deepEqual(loader.getExtensions().errors, [], "extension load errors")
  const { session } = await createAgentSession({ cwd, agentDir, settingsManager, resourceLoader: loader, sessionManager })
  try {
    await session.bindExtensions({})
    console.log(`QA_GATE OMO_DORI_TOOLKIT=${process.env.OMO_DORI_TOOLKIT ?? "<unset>"} session=${sessionManager.getSessionId()}`)
    if (plan.calls.length > 0) {
      const until = Date.now() + 15_000
      while (!session.getAllTools().some((tool) => tool.name === "ext_dori_reply_mark")) {
        assert.ok(Date.now() < until, "ext_dori_reply_mark was never registered at session_start")
        await new Promise((next) => setImmediate(next))
      }
    }
    for (const [index, call] of plan.calls.entries()) {
      const result = await session.executeTool(call.tool, call.args, { signal: AbortSignal.timeout(60_000) })
      console.log(`QA_CALL ${index} ${JSON.stringify(result.details?.result ?? result)}`)
    }
    if (plan.cell !== undefined) {
      const result = await session.executeTool("eval", { language: "js", code: plan.cell, summary: `dori toolkit QA ${phase}` }, { signal: AbortSignal.timeout(60_000) })
      console.log(`QA_CELL_OUTPUT\n${result.content.filter((part) => part.type === "text").map((part) => part.text).join("\n")}`)
    }
  } finally {
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" })
    session.dispose()
  }
}

function rpcClient(socketPath) {
  return new Promise((resolveClient, reject) => {
    const socket = createConnection(socketPath)
    const records = []
    const waiters = new Set()
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
        records.push(record)
        for (const waiter of [...waiters]) if (waiter.match(record)) { waiters.delete(waiter); waiter.done(record) }
      }
    })
    const waitFor = (match, timeoutMs = 120_000) => new Promise((resolveWait, rejectWait) => {
      const found = records.find(match)
      if (found !== undefined) return resolveWait(found)
      const waiter = { match, done: (record) => { clearTimeout(timer); resolveWait(record) } }
      const timer = setTimeout(() => { waiters.delete(waiter); rejectWait(new Error("rpc wait timed out")) }, timeoutMs)
      waiters.add(waiter)
    })
    socket.once("error", reject)
    socket.once("connect", () => resolveClient({
      request: async (command) => {
        const id = `qa-${++sequence}`
        socket.write(`${JSON.stringify({ id, ...command })}\n`)
        const record = await waitFor((entry) => entry.type === "response" && entry.id === id, 60_000)
        if (record.success !== true) throw new Error(`${command.type} failed: ${JSON.stringify(record.error ?? record)}`)
        return record.data
      },
      waitFor,
      close: () => socket.destroy(),
    }))
  })
}

function storeRows(agentDir) {
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

function journalRows(agentDir) {
  const path = join(agentDir, "gateway", "gateway.sqlite")
  if (!existsSync(path)) return []
  const db = new Database(path, { readonly: true })
  try {
    return db.query("SELECT replay_key, op, args_sha256 FROM toolkit_replay_receipts ORDER BY replay_key").all()
  } finally {
    db.close()
  }
}

const tagged = (output, tag) => output.split("\n").filter((text) => text.startsWith(`${tag} `)).map((text) => JSON.parse(text.slice(tag.length + 1).replace(/^\d+ /, "")))

async function supervise() {
  const evidenceDir = option("--evidence-dir", join(process.cwd(), ".omo/evidence/dori-toolkit-replay-qa"))
  mkdirSync(evidenceDir, { recursive: true })
  const transcript = join(evidenceDir, "task-15-dori-extension-v1.txt")
  writeFileSync(transcript, `COMMAND ${JSON.stringify(process.argv)}\nPLUGIN_ROOT ${pluginRoot}\n`)
  const log = (text) => { appendFileSync(transcript, text); process.stdout.write(text) }
  const sandbox = mkdtempSync(join(tmpdir(), "omo-dori-toolkit-qa-"))
  for (const directory of ["agent/rpc", "project", "home/.omo", "tmp"]) mkdirSync(join(sandbox, directory), { recursive: true })
  const { isolatedEnvironment, processGroupMembers } = await import("./agent-toolkit-eval-sdk-qa-support.mjs")
  const agentDir = join(sandbox, "agent")
  const socketPath = join(agentDir, "rpc", "rpc.sock")
  const configPath = join(sandbox, "home/.omo/omo.json")
  const mockScript = join(sandbox, "mock-script.json")
  const steps = [{ type: "tool_call", id: QA_CELL, name: "eval", arguments: { language: "js", code: FIRST_CELL, summary: "dori toolkit QA first turn" } }, { type: "text", text: "qa turn done" }]
  // The mock serves `childSteps` to every session of a `--mode rpc` process.
  writeFileSync(mockScript, JSON.stringify({ parentSteps: steps, childSteps: steps }))
  const environment = () => ({ ...isolatedEnvironment(sandbox, packageRoot), SENPI_RPC_SOCKET: socketPath, OMO_RPC_SOCKET: socketPath, MOCK_SCRIPT_PATH: mockScript })
  const checks = []
  const check = (name, ok, detail) => { checks.push({ name, ok }); log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}\n`) }
  const run = (phase, plan) => new Promise((resolveRun, reject) => {
    if (plan !== undefined) writeFileSync(join(sandbox, `${phase}.json`), JSON.stringify(plan))
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
  let host
  let client
  const startHost = () => new Promise((resolveHost, reject) => {
    const cli = join(packageRoot, "../../node_modules/@code-yeongyu/senpi/dist/cli.js")
    const child = spawn(process.execPath, [cli, "--mode", "rpc", "--multi-session", "--listen", `unix://${socketPath}`, "--extension", join(pluginRoot, "extensions", "omo.js"), "--extension", mockProvider, "--provider", "omo-mock", "--model", "mock-1"], { cwd: join(sandbox, "project"), env: environment(), detached: true, stdio: ["ignore", "pipe", "pipe"] })
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
  const phases = []
  let exitCode = 1
  try {
    writeFileSync(configPath, JSON.stringify({}))
    const off = await run("off")
    phases.push(off)
    const offKeys = tagged(off.output, "QA_KEYS")[0] ?? []
    const offTools = tagged(off.output, "QA_TOOLS")[0] ?? []
    check("off: no dori section means no namespace properties and no dori tools at all", off.code === 0 && offKeys.length > 0 && !offKeys.includes("reply") && !offKeys.includes("work") && offTools.length === 0, `keys=${JSON.stringify(offKeys)} tools=${JSON.stringify(offTools)}`)

    writeFileSync(configPath, JSON.stringify({ dori: {} }))
    const prepare = await run("prepare")
    phases.push(prepare)
    const prepared = tagged(prepare.output, "QA_PREPARED")[0]
    check("prepare: the fake dori host registered and an eight-day-old turn exists", prepare.code === 0 && prepared?.registered?.kind === "ok", JSON.stringify(prepared))

    host = await startHost()
    log(`HOST pid=${host.pid} socket=${socketPath}\n`)
    client = await rpcClient(socketPath)
    const opened = await client.request({ type: "open_session", cwd: join(sandbox, "project") })
    const routing = opened.sessionId
    await client.request({ type: "open_session", sessionPath: prepared.oldFile, cwd: join(sandbox, "project") })
    await client.request({ type: "set_model", sessionId: routing, provider: "omo-mock", modelId: "mock-1" })
    await client.request({ type: "prompt", sessionId: routing, message: "Run the dori toolkit cell." })
    await client.waitFor((record) => record.type === "agent_settled" && record.sessionId === routing)
    const state = await client.request({ type: "get_state", sessionId: routing })
    const messages = (await client.request({ type: "get_messages", sessionId: routing })).messages ?? []
    const result = messages.find((message) => message.role === "toolResult" && message.toolCallId === QA_CELL)
    const resultText = (Array.isArray(result?.content) ? result.content : []).map((part) => part.text ?? "").join("\n")
    log(`FIRST_TURN_MESSAGES ${JSON.stringify(messages.map((message) => ({ role: message.role, id: message.toolCallId, stop: message.stopReason, error: message.errorMessage, model: message.model, parts: Array.isArray(message.content) ? message.content.map((part) => part.type === "toolCall" ? `toolCall:${part.id}:${part.name}` : `${part.type}:${String(part.text ?? "").slice(0, 120)}`) : String(message.content).slice(0, 120) })))}\nFIRST_TURN_RESULT\n${resultText}\n`)
    const keys = tagged(resultText, "QA_KEYS")[0] ?? []
    const help = tagged(resultText, "QA_HELP")[0]
    const first = tagged(resultText, "QA_FIRST")[0]
    const sessionId = state.sessionId
    const namespaces = ["route", "reply", "room", "send", "thread", "describe", "file", "rules", "iam", "call", "work"]
    check("first: the dori section adds all eleven namespaces in the real kernel", namespaces.every((name) => keys.includes(name)), JSON.stringify(keys))
    check("first: help() lists the registered functions with signatures", help?.functions?.map((fn) => fn.signature).join(" | ") === "reply.mark(args: { note?: string }): Promise<StoreExtensionResult> | send.post(args: { note?: string }): Promise<StoreExtensionResult>", JSON.stringify(help))
    const afterFirst = storeRows(agentDir)
    check("first: the real turn dispatched three calls with the engine-stamped caller", first?.mark?.kind === "ok" && first.mark.value?.caller === sessionId && afterFirst.length === 3, `first=${JSON.stringify(first)} store=${afterFirst.length}`)
    const journal = journalRows(agentDir)
    const turn = `${sessionId}:`
    const byIndex = Object.fromEntries(journal.map((row) => [JSON.parse(row.replay_key)[2], row]))
    check("first: concurrent calls are journaled in program order under the cell's turn", journal.length === 3 && journal.every((row) => JSON.parse(row.replay_key)[1].startsWith(turn) && JSON.parse(row.replay_key)[1].endsWith(`/${QA_CELL}`)) && byIndex[0]?.op === "reply.mark" && byIndex[1]?.args_sha256 === argsHash({ note: "p1" }) && byIndex[2]?.args_sha256 === argsHash({ note: "p2" }), JSON.stringify(journal))

    const carried = (index, extra) => ({ ...extra, omo_toolkit_replay: { cell: QA_CELL, index } })
    const replay = await run("replay", { file: state.sessionFile, calls: [
      { tool: "ext_dori_reply_mark", args: carried(0, { note: "qa" }) },
      { tool: "ext_dori_send_post", args: carried(1, { note: "p1" }) },
      { tool: "ext_dori_send_post", args: carried(2, { note: "p2" }) },
    ] })
    phases.push(replay)
    const replayed = tagged(replay.output, "QA_CALL")
    check("replay: a fresh process replaying the cell gets every recorded result with no new dispatch", JSON.stringify(replayed[0]) === JSON.stringify(first?.mark) && JSON.stringify(replayed.slice(1)) === JSON.stringify(first?.posts) && storeRows(agentDir).length === 3, `replayed=${JSON.stringify(replayed)} store=${storeRows(agentDir).length}`)

    const diverge = await run("diverge", { file: state.sessionFile, calls: [
      { tool: "ext_dori_reply_mark", args: carried(0, { note: "DIFFERENT" }) },
      { tool: "ext_dori_send_post", args: carried(0, { note: "qa" }) },
    ] })
    phases.push(diverge)
    const [argsStop, opStop] = tagged(diverge.output, "QA_CALL")
    check("diverge: same op with other arguments stops naming the arguments", argsStop?.code === "toolkit_replay_divergence" && JSON.stringify(argsStop.differs) === '["args"]', JSON.stringify(argsStop))
    check("diverge: another op at a recorded index stops naming the op", opStop?.code === "toolkit_replay_divergence" && JSON.stringify(opStop.differs) === '["op"]' && storeRows(agentDir).length === 3, JSON.stringify(opStop))

    const forged = await run("forged", { file: state.sessionFile, calls: [{ tool: "ext_dori_reply_mark", args: { note: "qa", omo_toolkit_replay: { cell: "cell-of-another-session", index: 0 } } }], cell: FORGED_CELL })
    phases.push(forged)
    const forgedCall = tagged(forged.output, "QA_CALL")[0]
    const forgedCell = tagged(forged.output, "QA_EVAL_ERROR")[0]
    check("forged: a carried cell the engine did not issue is refused before dispatch", forgedCall?.code === "toolkit_replay_turn_unknown", JSON.stringify(forgedCall))
    check("forged: a kernel cell outside any recorded turn is refused and thrown as ToolkitReplayStopError", forgedCell?.name === "ToolkitReplayStopError" && forgedCell.code === "toolkit_replay_turn_unknown" && storeRows(agentDir).length === 3, JSON.stringify(forgedCell))

    const expired = await run("expired", { file: prepared.oldFile, calls: [{ tool: "ext_dori_reply_mark", args: { note: "qa", omo_toolkit_replay: { cell: OLD_CELL, index: 0 } } }] })
    phases.push(expired)
    const expiredCall = tagged(expired.output, "QA_CALL")[0]
    check("expired: a turn older than seven days stops as expired without dispatching", expiredCall?.code === "toolkit_replay_expired" && storeRows(agentDir).length === 3, JSON.stringify(expiredCall))

    log(`JOURNAL ${JSON.stringify(journalRows(agentDir))}\n`)
    check("no worker phase left a process behind", phases.every((phase) => phase.survivors.length === 0), "process groups empty")
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

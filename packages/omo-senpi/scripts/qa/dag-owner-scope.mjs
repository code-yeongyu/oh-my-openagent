#!/usr/bin/env node
// allow: SIZE_OK - selection scenarios and their control share one isolated CLI and cleanup lifecycle.
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createSandbox, seedSandbox, credentialDigest } from "./drive.mjs"
import { SESSION_A, SESSION_B, seedRun, snapshot } from "./dag-owner-scope-fixture.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, "../../../..")
const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex")
const json = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`) }
const entries = (path) => readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))

export function parseArgs(args) {
  const options = { scenario: "unrelated", pluginRoot: join(root, "packages/omo-senpi/plugin"),
    senpiCli: join(root, "node_modules/@code-yeongyu/senpi/dist/cli.js") }
  const keys = { "--scenario": "scenario", "--plugin-root": "pluginRoot", "--senpi-cli": "senpiCli", "--evidence-dir": "evidenceDir" }
  for (let i = 0; i < args.length; i++) {
    if (!keys[args[i]] || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`Invalid option: ${args[i]}`)
    options[keys[args[i]]] = args[++i]
  }
  if (!["unrelated", "fork", "reopen", "control"].includes(options.scenario)) throw new Error("Expected unrelated, fork, reopen, or control")
  if (!options.evidenceDir) throw new Error("--evidence-dir is required")
  for (const key of ["pluginRoot", "senpiCli", "evidenceDir"]) options[key] = resolve(options[key])
  return options
}

function launch(options, sandbox, env, sessionFile, phase, processes) {
  const config = JSON.parse(env.OMO_DAG_SCOPE_FIXTURE)
  const args = [options.senpiCli, "--mode", "rpc", "--no-extensions", "--no-skills", "--no-prompt-templates",
    "-e", join(sandbox.root, "extension.mjs"), "--session", sessionFile, "--session-dir", join(sandbox.agentDir, "sessions")]
  const child = spawn(process.execPath, args, { cwd: sandbox.cwd,
    env: { ...env, OMO_DAG_SCOPE_FIXTURE: JSON.stringify({ ...config, phase, readyFd: 3 }) },
    detached: process.platform !== "win32", windowsHide: true, stdio: ["pipe", "pipe", "pipe", "pipe"] })
  const pending = new Map()
  const ready = new Map()
  const readyWaiters = new Map()
  let stderr = "", sequence = 0
  const close = new Promise((done) => child.once("close", (code, signal) => done({ pid: child.pid, code, signal })))
  const rejectAll = (error) => {
    for (const waiters of [pending, readyWaiters]) {
      for (const waiter of waiters.values()) waiter.reject(error)
      waiters.clear()
    }
  }
  child.on("error", rejectAll)
  child.on("close", () => rejectAll(new Error(`CLI closed: ${stderr.slice(-2000)}`)))
  child.stderr.on("data", (chunk) => { stderr += chunk })
  for (const stream of [child.stdout, child.stdio[3]]) {
    let buffer = ""
    stream.on("data", (chunk) => {
      buffer += chunk
      let newline
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1)
        if (!line.startsWith("{")) continue
        let event
        try { event = JSON.parse(line) } catch (error) { rejectAll(new Error(`Invalid CLI JSON: ${error.message}`)); continue }
        if (event.type === "qa_scope_ready") {
          ready.set(event.phase, event)
          readyWaiters.get(event.phase)?.resolve(event)
          readyWaiters.delete(event.phase)
        }
        const waiter = pending.get(event.id)
        if (event.type === "response" && waiter) {
          pending.delete(event.id)
          if (event.success) waiter.resolve(event.data)
          else waiter.reject(new Error(JSON.stringify(event)))
        }
      }
    })
  }
  const runtime = {
    child, close, args, stderr: () => stderr,
    whenReady(phase) {
      if (ready.has(phase)) return Promise.resolve(ready.get(phase))
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { readyWaiters.delete(phase); reject(new Error(`${phase} recovery barrier deadline`)) }, 30_000)
        readyWaiters.set(phase, { resolve: (value) => { clearTimeout(timer); resolve(value) }, reject: (error) => { clearTimeout(timer); reject(error) } })
      })
    },
    request(type, fields = {}) {
      const id = `scope-${++sequence}`
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${type} deadline: ${stderr.slice(-2000)}`)) }, 30_000)
        pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value) }, reject: (error) => { clearTimeout(timer); reject(error) } })
        child.stdin.write(`${JSON.stringify({ id, type, ...fields })}\n`)
      })
    },
    async stop() {
      if (child.exitCode === null && child.signalCode === null) signalTree(child.pid, "SIGTERM")
      const timer = setTimeout(() => signalTree(child.pid, "SIGKILL"), 5000)
      try { return await close } finally { clearTimeout(timer) }
    },
  }
  processes.push(runtime)
  return runtime
}

export function signalTree(pid, signal) {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", signal === "SIGKILL" ? "/F" : "/T"], { stdio: "ignore" })
    return
  }
  try { process.kill(-pid, signal) } catch (error) { if (error.code !== "ESRCH") throw error }
}

export function isAlive(pid) {
  try { process.kill(pid, 0); return true } catch (error) { return error.code === "EPERM" }
}

export function scanSurvivors(pids, marker) {
  const owned = pids.filter(isAlive).map((pid) => `pid ${pid}`)
  if (process.platform === "win32") return { exit: 0, survivors: owned }
  const ps = spawnSync("ps", ["-axo", "pid=,args="], { encoding: "utf8" })
  const referenced = (ps.stdout ?? "").split("\n").filter((line) => line.includes(marker))
  return { exit: ps.status, survivors: [...owned, ...referenced] }
}

export function seedSession(path, id, cwd) {
  const timestamp = "2026-09-06T00:00:00.000Z"
  const history = [
    { type: "session", version: 3, id, timestamp, cwd },
    { type: "message", id: "11111111", parentId: null, timestamp, message: { role: "user", content: [{ type: "text", text: `Synthetic history ${id === SESSION_B ? "B" : "A"}` }], timestamp: Date.parse(timestamp) } },
    { type: "message", id: "22222222", parentId: "11111111", timestamp, message: { role: "assistant", content: [{ type: "text", text: "Synthetic saved response." }], api: "openai-completions", provider: "synthetic", model: "offline", stopReason: "stop", timestamp: Date.parse(timestamp), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } },
  ]
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, history.map((entry) => JSON.stringify(entry)).join("\n") + "\n")
}

export function evaluate(before, after, expectedSelected) {
  const selected = [], excluded = [], changedPaths = []
  for (const path of new Set([...Object.keys(before.state.files), ...Object.keys(after.state.files)])) {
    if (before.state.files[path] !== after.state.files[path]) changedPaths.push(path)
  }
  for (const id of before.ids) {
    const paths = [`dag/runs/${id}.json`, `dag/events/${id}.jsonl`, `dag/results/${id}/`]
    const changed = changedPaths.some((path) => paths.some((prefix) => path === prefix || path.startsWith(prefix + (prefix.endsWith("/") ? "" : "/"))))
    ;(changed ? selected : excluded).push(id)
  }
  const forbiddenMutations = selected.filter((id) => !expectedSelected.includes(id))
  const healthyOwnRecovery = expectedSelected.every((id) => {
    const run = after.state.runs.find((entry) => entry.runId === id)
    return selected.includes(id) && run?.status === "completed" && run.parentSessionId === before.current && run.rootSessionId === before.current
  })
  const taskChanges = changedPaths.filter((path) => !path.startsWith("dag/"))
  return { ok: forbiddenMutations.length === 0 && healthyOwnRecovery && taskChanges.length === 0,
    expectedSelected, selected, excluded, forbiddenMutations, healthyOwnRecovery, taskChanges, changedPaths }
}

export async function run(options) {
  assert.ok(existsSync(options.senpiCli), "Pinned CLI is missing")
  const taskBundle = join(options.pluginRoot, "extensions/omo-task.js")
  assert.ok(existsSync(taskBundle), "Build the task bundle with the official build script first")
  const protectedDirs = [join(homedir(), ".senpi/agent"), join(homedir(), ".omo/agent")]
  const credentialsBefore = protectedDirs.map((dir) => credentialDigest(dir))
  const sandbox = createSandbox()
  const processes = [], receipts = []
  const facts = { scenario: options.scenario, startedAt: new Date().toISOString(), surface: "real Senpi CLI RPC; not TUI key driving",
    invocation: [process.execPath, fileURLToPath(import.meta.url), "--scenario", options.scenario, "--plugin-root", options.pluginRoot, "--senpi-cli", options.senpiCli, "--evidence-dir", options.evidenceDir],
    node: process.version, senpiVersion: JSON.parse(readFileSync(resolve(options.senpiCli, "../../package.json"), "utf8")).version,
    taskBundleSha256: sha(taskBundle), driverSha256: sha(fileURLToPath(import.meta.url)),
    fixtureSha256: sha(join(here, "dag-owner-scope-fixture.mjs")), sandbox: sandbox.root, agentDir: sandbox.agentDir }
  let env
  try {
    seedSandbox(sandbox)
    const stateDir = join(sandbox.root, "state")
    const receipt = join(sandbox.root, "lifecycle.jsonl")
    json(join(sandbox.agentDir, "settings.json"), { packages: [], defaultProjectTrust: "allow", autoTitleSessions: false })
    json(join(sandbox.cwd, ".omo/omo.json"), { task: { state_dir: stateDir }, memory: { enabled: false } })
    const dead = spawnSync(process.execPath, ["-e", ""], { env: { PATH: process.env.PATH }, encoding: "utf8" })
    assert.equal(dead.status, 0)
    assert.throws(() => process.kill(dead.pid, 0), { code: "ESRCH" })
    facts.holders = { deadPid: dead.pid, deadExit: dead.status, deadSignalZero: "ESRCH", livePid: process.pid }
    writeFileSync(join(sandbox.root, "extension.mjs"), `import { createTaskComponent } from ${JSON.stringify(taskBundle)};\nimport { registerFixture } from ${JSON.stringify(join(here, "dag-owner-scope-fixture.mjs"))};\nexport default (pi) => registerFixture(pi, createTaskComponent);\n`)
    env = { PATH: process.env.PATH, HOME: sandbox.homeDir, XDG_CONFIG_HOME: sandbox.xdgConfigHome,
      XDG_DATA_HOME: sandbox.xdgDataHome, XDG_CACHE_HOME: sandbox.xdgCacheHome, XDG_STATE_HOME: join(sandbox.root, "xdg-state"),
      SENPI_CODING_AGENT_DIR: sandbox.agentDir, PI_CODING_AGENT_DIR: sandbox.agentDir, OMO_AGENT_DIR: sandbox.agentDir,
      OMO_DISABLE_TELEMETRY: "1", DO_NOT_TRACK: "1", TERM: "xterm-256color",
      OMO_DAG_SCOPE_FIXTURE: JSON.stringify({ stateDir, receipt, deadPid: dead.pid, livePid: process.pid }) }
    const initial = join(sandbox.agentDir, "sessions", "synthetic.jsonl")
    const ordinary = ["unrelated", "control"].includes(options.scenario)
    seedSession(initial, ordinary ? SESSION_B : SESSION_A, sandbox.cwd)
    const phase = ordinary ? options.scenario : "initial"
    let cli = launch(options, sandbox, env, initial, phase, processes)
    await cli.whenReady(phase)
    facts.initial = await cli.request("get_state")
    if (!ordinary) {
      const forkReady = cli.whenReady("fork")
      ;[facts.forkResponse] = await Promise.all([cli.request("fork", { entryId: "22222222", position: "at" }), forkReady])
      assert.equal(facts.forkResponse.cancelled, false)
      facts.forkState = await cli.request("get_state")
      facts.forkHeader = entries(facts.forkState.sessionFile)[0]
      assert.equal(facts.forkHeader.parentSession, initial)
      if (options.scenario === "reopen") {
        receipts.push(await cli.stop())
        cli = launch(options, sandbox, env, facts.forkState.sessionFile, "reopen", processes)
        await cli.whenReady("reopen")
        facts.reopenState = await cli.request("get_state")
      }
    }
    facts.lifecycle = entries(receipt)
    const expected = ordinary ? ["b-own"] : options.scenario === "fork" ? ["source-dead", "source-self", "c-own"] : ["c-reopen-own"]
    const before = facts.lifecycle.findLast((entry) => entry.kind === "before" && entry.phase === options.scenario)
    const after = facts.lifecycle.findLast((entry) => entry.kind === "after" && entry.phase === options.scenario)
    assert.ok(before && after, "Real component startup did not reach the after-recovery barrier")
    facts.selection = evaluate(before, after, expected)
    facts.finalState = snapshot(stateDir)
  } catch (error) {
    facts.error = error.stack
  } finally {
    for (const cli of processes) {
      if (!receipts.some((entry) => entry.pid === cli.child.pid)) receipts.push(await cli.stop())
    }
    const receipt = join(sandbox.root, "lifecycle.jsonl")
    if (existsSync(receipt)) facts.lifecycle = entries(receipt)
    facts.stderr = processes.map((cli) => cli.stderr())
    facts.commands = processes.map((cli) => [process.execPath, ...cli.args])
    const scan = scanSurvivors(processes.map((cli) => cli.child.pid), sandbox.root)
    const survivors = scan.survivors
    const credentialsAfter = protectedDirs.map((dir) => credentialDigest(dir))
    rmSync(sandbox.root, { recursive: true, force: true })
    facts.cleanup = { exits: receipts, processScanExit: scan.exit, survivors, sandboxRemoved: !existsSync(sandbox.root),
      ownedTransport: "stdio pipes only, including fixture readiness fd 3; no driver server or socket",
      survivorCheck: process.platform === "win32" ? "owned pid liveness (taskkill /T tree termination)" : "owned pid liveness plus ps scan for the sandbox root",
      protectedCredentialsUnchanged: credentialsAfter.every((digest, i) => digest === credentialsBefore[i]),
      observationLimit: "Protected credential/config digest only; no claim of a whole-home audit." }
    facts.ok = !facts.error && facts.selection?.ok === true && scan.exit === 0 && survivors.length === 0 && facts.cleanup.sandboxRemoved && facts.cleanup.protectedCredentialsUnchanged
    facts.exitCode = facts.ok ? 0 : 1
    // All runtime data is synthetic; replace machine-specific roots before writing public receipts.
    const publicFacts = JSON.parse(JSON.stringify(facts).replaceAll(sandbox.root, "<sandbox>").replaceAll(root, "<repo>").replaceAll(homedir(), "<home>"))
    json(join(options.evidenceDir, "result.json"), publicFacts)
    return publicFacts
  }
}

export function selfTest() {
  assert.throws(() => parseArgs(["--scenario", "invalid", "--evidence-dir", "."]))
  const sandbox = createSandbox()
  try {
    seedRun(sandbox.root, "a", SESSION_A, 999999)
    const before = { ids: ["a"], current: SESSION_B, state: snapshot(sandbox.root) }
    assert.deepEqual(evaluate(before, { state: snapshot(sandbox.root) }, []).excluded, ["a"])
    seedRun(sandbox.root, "a", SESSION_B, 999999)
    const result = evaluate(before, { state: snapshot(sandbox.root) }, [])
    assert.equal(result.ok, false)
    assert.deepEqual(result.forbiddenMutations, ["a"])
  } finally { rmSync(sandbox.root, { recursive: true, force: true }) }
  return { ok: true }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = process.argv.includes("--self-test") ? selfTest() : await run(parseArgs(process.argv.slice(2)))
  console.log(JSON.stringify(result, null, 2))
  process.exitCode = result.ok ? 0 : 1
}

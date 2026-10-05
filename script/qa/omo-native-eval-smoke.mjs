#!/usr/bin/env bun
import { execFile, spawn } from "node:child_process"
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, realpathSync, renameSync, rmSync, writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { evalSmokeProviderSource } from "./omo-native-eval-smoke-provider.mjs"

const sourceTree = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), "../.."))
const exec = promisify(execFile)

function parseArgs(argv) {
  if (argv.length === 1) return resolve(argv[0])
  if (argv.length === 2 && argv[0] === "--binary") return resolve(argv[1])
  throw new Error("usage: bun script/qa/omo-native-eval-smoke.mjs <binary>")
}

function isolatedEnvironment(sandbox) {
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (/^(SENPI_|OMO_|PI_|NODE_PATH|NODE_OPTIONS)/.test(key)) continue
    if (/CODING_AGENT_(DIR|SESSION_DIR)$|TOKEN|SECRET|PASSWORD|COOKIE|CREDENTIAL|API_KEY/i.test(key)) continue
    env[key] = value
  }
  return {
    ...env, HOME: sandbox.home, USERPROFILE: sandbox.home,
    XDG_CONFIG_HOME: join(sandbox.home, "config"), XDG_DATA_HOME: join(sandbox.home, "data"),
    XDG_STATE_HOME: join(sandbox.home, "state"), XDG_CACHE_HOME: join(sandbox.home, "cache"),
    TMPDIR: sandbox.root, TMP: sandbox.root, TEMP: sandbox.root,
    OMO_CODING_AGENT_DIR: sandbox.agentDir, SENPI_CODING_AGENT_SESSION_DIR: sandbox.sessionDir,
    PI_OFFLINE: "1", PI_TELEMETRY: "0",
  }
}

function createSandbox(binary) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "omo-eval-smoke-")))
  const sandbox = {
    root, home: join(root, "home"), cwd: join(root, "project"),
    agentDir: join(root, "agent"), sessionDir: join(root, "sessions"),
    providerPath: join(root, "provider.ts"), receiptPath: join(root, "read.jsonl"),
    binary: join(root, process.platform === "win32" ? "omo.exe" : "omo"),
    marker: crypto.randomUUID(),
  }
  for (const directory of [sandbox.home, sandbox.cwd, sandbox.agentDir, sandbox.sessionDir]) {
    mkdirSync(directory, { recursive: true })
  }
  copyFileSync(binary, sandbox.binary)
  chmodSync(sandbox.binary, 0o755)
  mkdirSync(join(sandbox.agentDir, "omo-senpi", "omo-native"), { recursive: true })
  writeFileSync(join(sandbox.agentDir, "omo-senpi", "omo-native", "onboarding-completed"), '{"version":1}\n')
  writeFileSync(join(sandbox.agentDir, "trust.json"), JSON.stringify({ [sandbox.cwd]: true }))
  writeFileSync(join(sandbox.agentDir, "settings.json"), JSON.stringify({
    defaultProjectTrust: "ask", defaultProvider: "openai", defaultModel: "gpt-5.6-sol",
  }))
  writeFileSync(join(sandbox.agentDir, "models.json"), JSON.stringify({
    providers: { openai: { models: [
      { id: "gpt-5.6-sol", name: "Eval Smoke", contextWindow: 200000, maxTokens: 4096 },
    ] } },
  }))
  writeFileSync(join(sandbox.cwd, "fixture.txt"), `${sandbox.marker}\n`)
  writeFileSync(sandbox.providerPath, evalSmokeProviderSource(sandbox.receiptPath))
  return sandbox
}

async function ownedProcesses(root) {
  if (process.platform === "win32") {
    const { stdout } = await exec("powershell.exe", ["-NoProfile", "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"],
    { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 })
    return JSON.parse(stdout).filter((entry) =>
      entry.ProcessId !== process.pid && entry.CommandLine?.includes(root))
      .map((entry) => ({ pid: entry.ProcessId, command: entry.CommandLine }))
  }
  const { stdout } = await exec("ps", ["-axo", "pid=,args="], {
    timeout: 30_000, maxBuffer: 16 * 1024 * 1024,
  })
  return stdout.split("\n").filter((line) => line.includes(root)).map((line) => {
    const [pid, ...args] = line.trim().split(/\s+/)
    return { pid: Number(pid), command: args.join(" ") }
  }).filter((entry) => entry.pid !== process.pid)
}

async function drive(sandbox, signal) {
  const child = spawn(sandbox.binary, [
    "--mode", "rpc", "--offline", "--approve", "--no-context-files",
    "--session-dir", sandbox.sessionDir, "-e", sandbox.providerPath,
    "--provider", "openai", "--model", "gpt-5.6-sol",
  ], {
    cwd: sandbox.cwd, env: isolatedEnvironment(sandbox), signal,
    stdio: ["pipe", "pipe", "pipe"],
  })
  let stdout = ""
  let stderr = ""
  let pending = ""
  const result = await new Promise((resolveRun, rejectRun) => {
    const watchdog = setTimeout(() => {
      child.kill("SIGKILL")
      rejectRun(new Error("eval smoke timed out after 120000ms"))
    }, 120_000)
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8")
      stdout += text
      pending += text
      const lines = pending.split("\n")
      pending = lines.pop() ?? ""
      for (const line of lines) {
        if (!line.startsWith("{")) continue
        if (JSON.parse(line).type === "agent_settled") child.stdin.end()
      }
    })
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8") })
    child.stdin.on("error", (error) => {
      if (error.code !== "EPIPE") rejectRun(error)
    })
    child.once("error", (error) => { clearTimeout(watchdog); rejectRun(error) })
    child.once("close", (code, signal) => {
      clearTimeout(watchdog)
      resolveRun({ code, signal })
    })
    child.stdin.write(`${JSON.stringify({ type: "prompt", message: "Run the packaged eval smoke." })}\n`)
  })
  return { ...result, stdout, stderr }
}

function readEvalResults(sessionDir) {
  return readdirSync(sessionDir).filter((name) => name.endsWith(".jsonl"))
    .flatMap((name) => readFileSync(join(sessionDir, name), "utf8").split("\n"))
    .filter(Boolean).map((line) => JSON.parse(line))
    .filter((record) => record.type === "message").map((record) => record.message)
    .filter((message) => message.role === "toolResult" && message.toolName === "eval")
}

function textOf(message) {
  return message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n")
}

async function main() {
  const sandbox = createSandbox(parseArgs(process.argv.slice(2)))
  const previousCwd = process.cwd()
  // Windows shells hold the checkout root open; hide every original entry there.
  const trees = process.platform === "win32"
    ? readdirSync(sourceTree).map((name) => join(sourceTree, name))
    : [sourceTree]
  const hiddenTrees = []
  const hostSockets = []
  const controller = new AbortController()
  const interrupt = () => controller.abort()
  process.once("SIGINT", interrupt)
  process.once("SIGTERM", interrupt)
  try {
    process.chdir(sandbox.root)
    for (const tree of trees) {
      const hidden = `${tree}.eval-hidden-${sandbox.marker}`
      renameSync(tree, hidden)
      hiddenTrees.push({ tree, hidden })
    }
    if (trees.some(existsSync)) throw new Error("source checkout remains accessible")
    const result = await drive(sandbox, controller.signal)
    if (process.platform !== "win32") {
      const shutdown = await exec(sandbox.binary, ["daemon", "stop", "--all", "--wait", "--timeout", "30"], {
        cwd: sandbox.cwd, env: isolatedEnvironment(sandbox), timeout: 60_000, signal: controller.signal,
      })
      process.stderr.write(`SHUTDOWN ${shutdown.stdout.trim()}\n`)
      for (const line of shutdown.stdout.split("\n")) {
        const socket = line.match(/^(.+\.sock): drained/)?.[1]
        if (socket) hostSockets.push(socket)
      }
    }
    if (result.code !== 0) throw new Error(`binary exited code=${result.code}\n${result.stderr.slice(-4000)}`)
    const results = readEvalResults(sandbox.sessionDir)
    const failure = results.find((message) => message.isError)
    if (failure) throw new Error(`packaged eval failed: ${textOf(failure)}\n${result.stderr.slice(-4000)}`)
    if (/Cannot find|ENOENT|missing.*asset|Failed to load extension/i.test(result.stderr)) {
      throw new Error(`missing packaged asset: ${result.stderr.slice(-4000)}`)
    }
    if (results.length !== 3) throw new Error(`expected js, py, list results, got ${results.length}`)
    const [js, py, list] = results
    if (!textOf(js).includes("JS_OK 42") || !textOf(js).includes(sandbox.marker)) {
      throw new Error(`JavaScript/read receipt missing: ${textOf(js)}`)
    }
    if (!textOf(py).includes("PY_OK 42")) throw new Error(`Python receipt missing: ${textOf(py)}`)
    const pythonPid = Number(textOf(py).match(/PY_PID (\d+)/)?.[1])
    if (!Number.isSafeInteger(pythonPid) || pythonPid <= 0) throw new Error("Python PID receipt missing")
    try {
      process.kill(pythonPid, 0)
      throw new Error(`Python interpreter survived shutdown: ${pythonPid}`)
    } catch (error) {
      if (!(error instanceof Error) || error.code !== "ESRCH") throw error
    }
    if (list.details?.action !== "list" || !["js", "py"].every((language) =>
      list.details.cells.some((cell) => cell.language === language && cell.state === "completed"))) {
      throw new Error(`cell list receipt missing: ${textOf(list)}`)
    }
    const receipts = readFileSync(sandbox.receiptPath, "utf8").trim().split("\n").map((line) => JSON.parse(line))
    if (receipts.length !== 2 || receipts[0].kind !== "tool_call" ||
        receipts[1].kind !== "tool_result" || receipts[0].id !== receipts[1].id ||
        receipts[1].isError || !JSON.stringify(receipts[1].content).includes(sandbox.marker)) {
      throw new Error("expected exactly one real host read through before/after hooks")
    }
    const survivors = await ownedProcesses(sandbox.root)
    const sockets = readdirSync(sandbox.root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isSocket())
    if (survivors.length || sockets.length || hostSockets.some(existsSync)) {
      throw new Error(`shutdown leaked owned processes/sockets: ${JSON.stringify(survivors)} sockets=${sockets.length}`)
    }
    process.stdout.write(`PASS JS_OK 42 marker=${sandbox.marker} through one permission/hook read\n`)
    process.stdout.write("PASS PY_OK 42\n")
    process.stdout.write("PASS eval list contains JavaScript and Python cells\n")
    process.stdout.write("PASS renamed source tree; owned workers/interpreters=0 sockets=0\n")
  } finally {
    for (const { tree, hidden } of hiddenTrees.reverse()) renameSync(hidden, tree)
    process.chdir(previousCwd)
    process.removeListener("SIGINT", interrupt)
    process.removeListener("SIGTERM", interrupt)
    const survivors = await ownedProcesses(sandbox.root)
    for (const { pid } of survivors) process.kill(pid, "SIGKILL")
    for (const namespace of new Set(hostSockets.map(dirname))) {
      if (basename(namespace).startsWith("omo-rpc-")) rmSync(namespace, { recursive: true, force: true })
    }
    rmSync(sandbox.root, { recursive: true, force: true })
    process.stderr.write(`CLEANUP source restored; sandbox removed; owned survivors terminated=${survivors.length}\n`)
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})

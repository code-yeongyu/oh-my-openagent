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
import { createHash } from "node:crypto"
import { evalSmokeProviderSource } from "./omo-native-eval-smoke-provider.mjs"

const sourceTree = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), "../.."))
const exec = promisify(execFile)
// OMO_SMOKE_JS_ISOLATION=process runs the JavaScript cells in the process-isolated kernel.
const processIsolation = process.env.OMO_SMOKE_JS_ISOLATION === "process"
const LARGE_ITEM = "x".repeat(4194304)

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
    ...(processIsolation ? { SENPI_CODEMODE_JS_ISOLATION: "process" } : {}),
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
  // Sandbox cells on. Every cell gets 10 s before it detaches (room for a cold QuickJS boot on a slow runner). The
  // large sandbox cell blocks until a later cell releases it, so its detach and the peek after it never race its end.
  mkdirSync(join(sandbox.cwd, ".senpi"), { recursive: true })
  writeFileSync(join(sandbox.cwd, ".senpi", "codemode.json"), JSON.stringify({
    sandbox: { enabled: true }, cellTimeoutSeconds: 10, foregroundWindowSeconds: 12,
  }))
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

const RENAME_RETRY_CODES = new Set(["EBUSY", "EPERM", "EACCES"])
const RENAME_RETRY_DELAYS_MS = [250, 500, 1_000, 2_000, 2_000, 2_000, 2_000, 2_000]

/**
 * Windows processes whose image or a loaded module lives under `tree`, or whose command line names
 * it: the ones that keep it from being renamed (#9618). The smoke's own process is excluded.
 */
async function treeHolders(tree) {
  const script = [
    "$tree = $env:OMO_SMOKE_TREE.ToLowerInvariant()",
    "Get-CimInstance Win32_Process | ForEach-Object {",
    "  $p = $_; $hit = $false",
    "  if ($p.ExecutablePath -and $p.ExecutablePath.ToLowerInvariant().StartsWith($tree)) { $hit = $true }",
    "  if ($p.CommandLine -and $p.CommandLine.ToLowerInvariant().Contains($tree)) { $hit = $true }",
    "  if (-not $hit) { try { $hit = @((Get-Process -Id $p.ProcessId -ErrorAction Stop).Modules | Where-Object { $_.FileName -and $_.FileName.ToLowerInvariant().StartsWith($tree) }).Count -gt 0 } catch {} }",
    "  if ($hit) { [pscustomobject]@{ pid = $p.ProcessId; parent = $p.ParentProcessId; image = $p.ExecutablePath; command = $p.CommandLine } }",
    "} | ConvertTo-Json -Compress",
  ].join("\n")
  const { stdout } = await exec("powershell.exe", ["-NoProfile", "-Command", script], {
    timeout: 60_000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, OMO_SMOKE_TREE: tree },
  })
  const parsed = stdout.trim() === "" ? [] : JSON.parse(stdout)
  return (Array.isArray(parsed) ? parsed : [parsed]).filter((entry) => entry.pid !== process.pid)
}

/**
 * Renames `tree` aside. On Windows anything that still holds a handle under it makes the rename fail
 * with EBUSY/EPERM/EACCES. In CI no smoke process was found holding `.omo` (#9618); a scan of the
 * freshly written release binary is the likely holder, so only those codes are retried with a short
 * bounded backoff, and a rename that still fails names the holders it can see.
 */
async function renameAside(tree, hidden) {
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tree, hidden)
      return
    } catch (error) {
      const retryable = process.platform === "win32" && RENAME_RETRY_CODES.has(error?.code)
      if (!retryable) throw error
      if (attempt >= RENAME_RETRY_DELAYS_MS.length) {
        const holders = await treeHolders(tree).catch((query) => [{ query: String(query) }])
        const named = holders.length > 0
          ? `by: ${JSON.stringify(holders)}`
          : "by no process whose image, module or command line is under it (a file scanner or indexer holding a handle)"
        throw new Error(`${error.message}\nstill held after ${attempt + 1} attempts ${named}`)
      }
      await new Promise((settle) => setTimeout(settle, RENAME_RETRY_DELAYS_MS[attempt]))
    }
  }
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

// The large cell's completion notification names the file holding its full output. Records are decoded as JSON
// first, so a Windows path keeps its backslashes, and the path runs to the end of its line (it may contain spaces).
function largeCellSpill(sessionDir) {
  const texts = readdirSync(sessionDir).filter((name) => name.endsWith(".jsonl"))
    .flatMap((name) => readFileSync(join(sessionDir, name), "utf8").split("\n"))
    .filter(Boolean).flatMap((line) => stringsOf(JSON.parse(line)))
  const notice = texts.find((text) => text.includes("eval-smoke-5") && /[Ff]ull output: /u.test(text))
  const path = notice?.match(/[Ff]ull output: (.+?)\]?[ \t]*$/mu)?.[1]
  if (path === undefined) throw new Error("no completion notification with a full-output path for the large sandbox cell")
  return readFileSync(path, "utf8")
}

function stringsOf(value) {
  if (typeof value === "string") return [value]
  if (value === null || typeof value !== "object") return []
  return Object.values(value).flatMap(stringsOf)
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
      await renameAside(tree, hidden)
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
    if (results.length !== 9) {
      throw new Error(`expected js, py, list, sandbox probe, sandbox store, large cell, peek, release, after; got ${results.length}`)
    }
    const [js, py, list, isolated, stored, large, peek, release, after] = results
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
    if (processIsolation && js.details?.runtime?.isolation !== "process") {
      throw new Error(`process-isolated kernel not used: ${JSON.stringify(js.details?.runtime)}`)
    }
    // A positive read alone is no sandbox proof: the persistent kernel has process and fetch, the QuickJS VM has neither.
    if (!textOf(isolated).includes(JSON.stringify(["undefined", "undefined", sandbox.marker]))) {
      throw new Error(`sandbox probe: expected no ambient process/fetch and the marker, got ${textOf(isolated)}`)
    }
    // An isolated cell's own error is a settled cell result (status "error"), not a failed tool call.
    if (stored.details?.cells?.[0]?.status !== "error" || !textOf(stored).includes("eval_isolate_no_state")) {
      throw new Error(`sandbox store() was not refused with eval_isolate_no_state: ${textOf(stored)}`)
    }
    if (large.isError || peek.isError) throw new Error(`large sandbox cell: ${textOf(large)} / ${textOf(peek)}`)
    if (!textOf(release).includes("RELEASED") || !textOf(after).includes("AFTER_LARGE")) {
      throw new Error(`release/after cells: ${textOf(release)} / ${textOf(after)}`)
    }
    if (!textOf(peek).includes("x".repeat(256)) || textOf(peek).includes("BIG_DONE")) {
      throw new Error(`peek did not show the streamed 4 MiB item before the cell settled: ${textOf(peek).slice(0, 400)}`)
    }
    const spill = largeCellSpill(sandbox.sessionDir)
    const expected = createHash("sha256").update(LARGE_ITEM).digest("hex")
    const actual = createHash("sha256").update(spill.match(/x{1024,}/u)?.[0] ?? "").digest("hex")
    if (actual !== expected) throw new Error(`large item spill sha256 ${actual} != source ${expected}`)
    const receipts = readFileSync(sandbox.receiptPath, "utf8").trim().split("\n").map((line) => JSON.parse(line))
    const reads = receipts.length / 2
    if (receipts.length !== 4 || [0, 2].some((index) =>
        receipts[index].kind !== "tool_call" || receipts[index + 1].kind !== "tool_result" ||
        receipts[index].id !== receipts[index + 1].id || receipts[index + 1].isError ||
        !JSON.stringify(receipts[index + 1].content).includes(sandbox.marker))) {
      throw new Error(`expected two real host reads (kernel cell, sandbox cell) through before/after hooks, got ${reads}`)
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
    process.stdout.write(`PASS sandbox cell: no process, no fetch, marker read through the host hook${processIsolation ? "; kernel cells ran process-isolated" : ""}\n`)
    process.stdout.write("PASS sandbox store() refused with eval_isolate_no_state\n")
    process.stdout.write(`PASS 4 MiB sandbox item visible through peek before settling; spill sha256=${expected}\n`)
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

#!/usr/bin/env bun
// Behavioural parity gate: drives the standalone binary and the npm launcher through the same
// scripted session, omo doctor and omo setup --dry-run in isolated sandboxes, then fails on any
// difference that is not an expected distribution line.
import { spawn, spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"
import { binaryOnlyFailures, compareRuns, normalizeText, PARITY_STEPS } from "./omo-native-parity-compare.mjs"
import { parityProviderSource } from "./omo-native-parity-provider.mjs"

const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP4z8DAwMDAxMDAAAAR8QIDrWHbdwAAAABJRU5ErkJggg=="
const SESSION_BUDGET_MS = 240_000
const COMMAND_BUDGET_MS = 120_000

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 2) {
    const [flag, value] = [argv[index], argv[index + 1]]
    if (value === undefined) throw new Error(`missing value for ${flag}`)
    if (flag === "--binary") options.binary = resolve(value)
    else if (flag === "--npm-omo") options.npm = value
    else if (flag === "--evidence-dir") options.evidence = resolve(value)
    else throw new Error(`unknown flag ${flag}`)
  }
  if (!options.binary) {
    throw new Error("usage: bun script/qa/omo-native-parity-smoke.mjs --binary <omo binary> [--npm-omo <omo launcher command>] [--evidence-dir <dir>]")
  }
  return options
}

function scrubbedEnv(overrides) {
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (/^(SENPI_|OMO_|PI_|CLAUDE_|ANTHROPIC_|OPENAI_)/.test(key)) continue
    if (/TOKEN|SECRET|PASSWORD|COOKIE|CREDENTIAL|API_KEY/i.test(key)) continue
    env[key] = value
  }
  return { ...env, PI_OFFLINE: "1", PI_TELEMETRY: "0", OMO_SEND_ANONYMOUS_TELEMETRY: "0", ...overrides }
}

function sandbox(root, label) {
  const base = join(root, label)
  const dirs = { base, home: join(base, "home"), cwd: join(base, "project"), sessions: join(base, "sessions"), tmp: join(base, "tmp") }
  for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true })
  const agentDir = join(dirs.home, ".omo", "agent")
  mkdirSync(join(agentDir, "extensions"), { recursive: true })
  mkdirSync(join(agentDir, "omo-senpi", "omo-native"), { recursive: true })
  writeFileSync(join(agentDir, "omo-senpi", "omo-native", "onboarding-completed"), '{"version":1}\n')
  writeFileSync(join(agentDir, "trust.json"), JSON.stringify({ [realpathSync(dirs.cwd)]: true }))
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ defaultProjectTrust: "ask", defaultProvider: "openai", defaultModel: "gpt-5.6-sol" }))
  writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: { openai: { models: [{ id: "gpt-5.6-sol", name: "Parity", contextWindow: 200000, maxTokens: 4096 }] } } }))
  writeFileSync(join(agentDir, "extensions", "parity-provider.ts"), parityProviderSource())
  writeFileSync(join(dirs.cwd, "notes.txt"), "alpha\nomo-parity-needle\nomega\n")
  writeFileSync(join(dirs.cwd, "sample.ts"), "export const value: number = 1\n")
  writeFileSync(join(dirs.cwd, "pixel.png"), Buffer.from(PNG_1X1, "base64"))
  return dirs
}

function runCommand(argv, dirs, env, stdinText) {
  return new Promise((resolveRun, rejectRun) => {
    const [command, ...args] = argv
    const child = spawn(command, args, { cwd: dirs.cwd, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true })
    let stdout = ""
    let stderr = ""
    const budget = stdinText === undefined ? COMMAND_BUDGET_MS : SESSION_BUDGET_MS
    const watchdog = setTimeout(() => {
      child.kill("SIGKILL")
      rejectRun(new Error(`${argv.join(" ")} exceeded ${budget}ms\n${stderr.slice(-2000)}`))
    }, budget)
    child.stdout.on("data", (chunk) => {
      stdout += chunk
      if (stdinText !== undefined && stdout.includes('"type":"agent_settled"')) child.stdin.end()
    })
    child.stderr.on("data", (chunk) => { stderr += chunk })
    child.once("error", (error) => { clearTimeout(watchdog); rejectRun(error) })
    child.once("close", (code) => { clearTimeout(watchdog); resolveRun({ code, stdout, stderr }) })
    if (stdinText === undefined) child.stdin.end()
    else child.stdin.write(stdinText)
  })
}

function toolResults(sessionDir) {
  const files = readdirSync(sessionDir, { recursive: true }).map(String).filter((name) => name.endsWith(".jsonl"))
  const records = files.flatMap((name) => readFileSync(join(sessionDir, name), "utf8").split("\n")).filter(Boolean).map((line) => JSON.parse(line))
  return records.filter((record) => record?.type === "message" && record.message?.role === "toolResult").map((record) => record.message)
}

function resultText(message) {
  if (!Array.isArray(message.content)) return ""
  return message.content.map((part) => (part?.type === "text" ? part.text : `<${part?.type}>`)).join("\n")
}

// A user runs a release binary from wherever it was downloaded, next to nothing it could read
// beside itself (#7485), so the binary is copied alone into an empty folder before it runs.
function downloadedCopy(binary, dirs) {
  const download = join(dirs.base, "download")
  mkdirSync(download, { recursive: true })
  const copy = join(download, basename(binary))
  copyFileSync(binary, copy)
  return copy
}

async function collect(label, launcher, root, pageUrl, dirs = sandbox(root, label)) {
  mkdirSync(dirs.sessions, { recursive: true })
  const log = join(dirs.base, "provider.jsonl")
  const stepsFile = join(dirs.base, "steps.json")
  writeFileSync(log, "")
  const steps = PARITY_STEPS.map((step) => ({ ...step, arguments: JSON.parse(JSON.stringify(step.arguments).replace("{{PAGE_URL}}", pageUrl)) }))
  writeFileSync(stepsFile, JSON.stringify(steps))
  const env = scrubbedEnv({ HOME: dirs.home, USERPROFILE: dirs.home, TMPDIR: dirs.tmp, TEMP: dirs.tmp, TMP: dirs.tmp, OMO_PARITY_STEPS: stepsFile, OMO_PARITY_LOG: log })
  const argv = launcher.split(" ")
  const roots = [dirs.base, realpathSync(dirs.base)]
  const session = await runCommand([...argv, "--mode", "rpc", "--approve", "--no-context-files", "--session-dir", dirs.sessions, "--provider", "openai", "--model", "gpt-5.6-sol"], dirs, env, `${JSON.stringify({ type: "prompt", message: "Run the parity scenario." })}\n`)
  const messages = toolResults(dirs.sessions)
  const results = {}
  steps.forEach((step, index) => {
    const message = messages[index]
    if (message !== undefined) results[step.id] = { isError: message.isError === true, text: normalizeText(resultText(message), roots) }
  })
  const firstRequest = readFileSync(log, "utf8").split("\n").find(Boolean)
  const doctor = await runCommand([...argv, "doctor"], dirs, env)
  const setup = await runCommand([...argv, "setup", "--dry-run"], dirs, env)
  const extensionFailures = session.stderr.split("\n").filter((line) => line.includes("Failed to load extension")).map((line) => normalizeText(line, roots))
  return {
    label,
    tools: firstRequest === undefined ? [] : JSON.parse(firstRequest).tools,
    results,
    doctor: normalizeText(doctor.stdout + doctor.stderr, roots).split("\n"),
    setup: normalizeText(setup.stdout + setup.stderr, roots).split("\n"),
    extensionFailures,
    exitCodes: { session: session.code, doctor: doctor.code, setup: setup.code },
  }
}

// Hosts, LSP daemons and language servers a session starts detach from the launcher, so they are
// found by the sandbox HOME in their environment (ps -E / ps e) and stopped before the sandbox goes.
function reapSandbox(root) {
  if (process.platform === "win32") return reapWindowsSandbox(root)
  const args = process.platform === "darwin" ? ["-A", "-E", "-ww", "-o", "pid=,command="] : ["-A", "-ww", "e", "-o", "pid=,command="]
  const roots = [root, realpathSync(root)]
  const listed = spawnSync("ps", args, { encoding: "utf8" }).stdout ?? ""
  const pids = listed.split("\n")
    .map((line) => /^\s*(\d+)\s+(.*)$/.exec(line))
    .filter((match) => match !== null && Number(match[1]) !== process.pid && roots.some((path) => match[2].includes(path)))
    .map((match) => Number(match[1]))
  for (const pid of pids) {
    try { process.kill(pid, "SIGKILL") } catch { /* already exited */ }
  }
  return pids.length
}

// Windows has no `ps e`: a process belongs to the sandbox when its executable (the binary's
// provisioned runtime lives under the sandbox HOME) or its command line names the sandbox.
function reapWindowsSandbox(root) {
  const roots = [...new Set([root, realpathSync(root), realpathSync.native(root)])]
  const filter = roots.map((path) => `$_.ExecutablePath -like '${path.replaceAll("'", "''")}*' -or $_.CommandLine -like '*${path.replaceAll("'", "''")}*'`).join(" -or ")
  const script = `Get-CimInstance Win32_Process | Where-Object { ${filter} } | ForEach-Object { $_.ProcessId }`
  const listed = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true }).stdout ?? ""
  const pids = listed.split(/\r?\n/).map((line) => Number(line.trim())).filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid)
  for (const pid of pids) {
    try { process.kill(pid) } catch { /* already exited */ }
  }
  return pids.length
}

function servePage() {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" })
    response.end("<html><head><title>Parity</title></head><body><h1>omo parity 42</h1><p>hello <b>world</b></p></body></html>")
  })
  return new Promise((resolveServer) => server.listen(0, "127.0.0.1", () => resolveServer(server)))
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const root = mkdtempSync(join(tmpdir(), "omo-parity-"))
  const server = await servePage()
  try {
    const pageUrl = `http://127.0.0.1:${server.address().port}/page`
    const binaryDirs = sandbox(root, "binary")
    const downloaded = downloadedCopy(options.binary, binaryDirs)
    const binary = await collect("binary", downloaded, root, pageUrl, binaryDirs)
    if (options.npm === undefined) {
      // The second run starts the same download against the runtime the first run provisioned.
      const again = await collect("binary-again", downloaded, root, pageUrl, { ...binaryDirs, sessions: join(binaryDirs.base, "sessions-again") })
      const failures = [...binaryOnlyFailures("first run", binary), ...binaryOnlyFailures("second run", again)]
      if (options.evidence) {
        mkdirSync(options.evidence, { recursive: true })
        writeFileSync(join(options.evidence, "binary-runs.json"), JSON.stringify({ binary, again, failures }, null, 2))
      }
      if (failures.length > 0) {
        process.stderr.write(`FAIL binary from a download folder: ${failures.length} failure(s)\n${failures.map((line) => `  - ${line}`).join("\n")}\n`)
        process.exitCode = 1
        return
      }
      process.stdout.write(`PASS binary from a download folder: first and second run, ${binary.tools.length} tools, eval and pty steps ok\n`)
      return
    }
    const npm = await collect("npm", options.npm, root, pageUrl)
    const differences = compareRuns(binary, npm)
    if (options.evidence) {
      mkdirSync(options.evidence, { recursive: true })
      writeFileSync(join(options.evidence, "parity-runs.json"), JSON.stringify({ binary, npm, differences }, null, 2))
    }
    if (differences.length > 0) {
      process.stderr.write(`FAIL binary/npm parity: ${differences.length} difference(s)\n${differences.map((line) => `  - ${line}`).join("\n")}\n`)
      process.exitCode = 1
      return
    }
    process.stdout.write(`PASS binary/npm parity: ${PARITY_STEPS.length} tool steps, ${binary.tools.length} tools, doctor and setup sections match\n`)
  } finally {
    server.close()
    const reaped = reapSandbox(root)
    rmSync(root, { recursive: true, force: true })
    process.stdout.write(`cleanup: stopped ${reaped} sandbox process(es), removed the sandbox\n`)
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})

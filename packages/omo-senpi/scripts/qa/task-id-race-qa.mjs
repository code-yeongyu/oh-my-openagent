#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, watch, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const COLLISION_TEXT = "Task record already exists"
const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(scriptDir, "..", "..")
const pluginRoot = join(packageRoot, "plugin")
const pluginEntry = join(pluginRoot, "extensions", "omo.js")
const mockProviderEntry = join(scriptDir, "task-id-race-mock-provider.mjs")

async function main() {
  const options = parseArgs(process.argv.slice(2))
  mkdirSync(options.evidenceDir, { recursive: true })
  const generated = regeneratePlugin()
  try {
    const senpiBin = resolveSenpi(process.env.SENPI_BIN?.trim() || "senpi")
    const metadata = {
      worktree_sha: git("rev-parse", "HEAD"),
      worktree_root: resolve(packageRoot, "..", ".."),
      resolved_plugin_entry: realpathSync(pluginEntry),
      senpi_binary: senpiBin,
      senpi_version: senpiBin === null ? "unavailable" : versionOf(senpiBin),
    }
    writeJson(join(options.evidenceDir, "environment.json"), metadata)
    if (senpiBin === null) throw new Error("senpi binary unavailable")
    if (!existsSync(pluginEntry)) throw new Error(`plugin entry missing: ${pluginEntry}`)

    let last
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      last = await runAttempt({ ...options, senpiBin, attempt, metadata })
      if (last.bucketStable) break
    }
    const reasons = last.reasons
    const pass = last.bucketStable && reasons.length === 0
    writeJson(join(options.evidenceDir, "verdict.json"), {
      result: pass ? "PASS" : "FAIL",
      attempts: last.attempt,
      bucketStable: last.bucketStable,
      buckets: last.buckets,
      taskIds: last.taskIds,
      reasons,
      ...metadata,
    })
    console.log(JSON.stringify({ result: pass ? "PASS" : "FAIL", reasons, taskIds: last.taskIds, buckets: last.buckets }))
    if (!pass) process.exitCode = 1
  } finally {
    restorePlugin(generated)
  }
}

function regeneratePlugin() {
  const paths = [pluginEntry, join(pluginRoot, "extensions", "omo-member.js")]
  const originals = paths.map((path) => ({ path, content: existsSync(path) ? readFileSync(path) : undefined }))
  const result = spawnSync(process.execPath, [join(pluginRoot, "scripts", "build-extension.mjs")], {
    cwd: resolve(packageRoot, "..", ".."),
    encoding: "utf8",
    timeout: 120_000,
  })
  if (result.status !== 0 && !existsSync(pluginEntry)) throw new Error(`plugin build failed:\n${result.stdout}${result.stderr}`)
  return originals
}

function restorePlugin(originals) {
  for (const original of originals) {
    if (original.content !== undefined) writeFileSync(original.path, original.content)
  }
}

async function runAttempt(input) {
  const attemptDir = join(input.evidenceDir, `attempt-${input.attempt}`)
  mkdirSync(attemptDir, { recursive: true })
  const root = mkdtempSync(join(tmpdir(), "omo-senpi-task-id-race-"))
  const projectDir = join(root, "project")
  seedProject(projectDir)
  const parents = ["parent-a", "parent-b"].map((name) => createParent(root, name, projectDir, input.timeoutMs))
  const runs = []
  let cleanup = { pids: [], terminated: [], verified_dead: [], sandbox_removed: false }
  let before = ""
  let after = ""
  let buckets = { before: null, after: null }
  let taskIds = []
  const reasons = []
  try {
    before = lsTasks(projectDir)
    for (const parent of parents) runs.push(startSenpi(input.senpiBin, parent, projectDir, input.timeoutMs))
    await Promise.all(parents.map((parent) => waitForFile(parent.readyFile, input.timeoutMs)))
    buckets.before = Math.floor(Date.now() / 65_536)
    for (const parent of parents) writeFileSync(parent.goFile, "go\n", { flag: "wx" })
    const completions = await Promise.all(runs.map((run) => waitForCompletion(run, input.timeoutMs, attemptDir, "post-go")))
    buckets.after = Math.floor(Date.now() / 65_536)
    after = lsTasks(projectDir)
    taskIds = taskIdsFromListing(after)
    for (let index = 0; index < completions.length; index += 1) {
      writeFileSync(join(attemptDir, `${parents[index].name}.stdout.jsonl`), completions[index].stdout)
      writeFileSync(join(attemptDir, `${parents[index].name}.stderr.log`), completions[index].stderr)
      writeJson(join(attemptDir, `${parents[index].name}.exit.json`), { status: completions[index].status, signal: completions[index].signal })
      copySessionTranscript(parents[index].sessionDir, join(attemptDir, `${parents[index].name}.sessions`))
      if (completions[index].status !== 0) reasons.push(`${parents[index].name} senpi exited ${completions[index].status ?? completions[index].signal ?? "unknown"}`)
    }
    const transcript = completions.map((completion) => `${completion.stdout}\n${completion.stderr}`).join("\n")
    if (transcript.includes(COLLISION_TEXT)) reasons.push(`transcript contains ${JSON.stringify(COLLISION_TEXT)}`)
    if (taskIds.length !== 2) reasons.push(`expected exactly 2 task records, observed ${taskIds.length}`)
    if (new Set(taskIds).size !== taskIds.length) reasons.push("task ids are not unique")
    if (buckets.before !== buckets.after) reasons.push(`bucket changed from ${buckets.before} to ${buckets.after}`)
    writeFileSync(join(attemptDir, "tasks-before.ls.txt"), before)
    writeFileSync(join(attemptDir, "tasks-after.ls.txt"), after)
    writeJson(join(attemptDir, "run.json"), { buckets, taskIds, reasons, ...input.metadata })
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error)
    reasons.push(message)
    writeFileSync(join(attemptDir, "driver-error.log"), `${message}\n`)
    writeFileSync(join(attemptDir, "tasks-before.ls.txt"), before)
    writeFileSync(join(attemptDir, "tasks-after.ls.txt"), after || lsTasks(projectDir))
  } finally {
    cleanup = await cleanupRuns(runs, root, input.timeoutMs, attemptDir)
    writeJson(join(attemptDir, "cleanup-receipt.json"), cleanup)
    writeJson(join(input.evidenceDir, "cleanup-receipt.txt"), cleanup)
  }
  return { attempt: input.attempt, bucketStable: buckets.before !== null && buckets.before === buckets.after, buckets, taskIds, reasons }
}

function createParent(root, name, projectDir, timeoutMs) {
  const parentRoot = join(root, name)
  const home = join(parentRoot, "home")
  const agentDir = join(parentRoot, "agent")
  const sessionDir = join(parentRoot, "sessions")
  const gates = join(parentRoot, "gates")
  mkdirSync(home, { recursive: true })
  mkdirSync(agentDir, { recursive: true })
  mkdirSync(sessionDir, { recursive: true })
  mkdirSync(gates, { recursive: true })
  const canonicalProject = realpathSync(projectDir)
  writeJson(join(agentDir, "settings.json"), { defaultProjectTrust: "ask", packages: [pluginRoot] })
  writeJson(join(agentDir, "trust.json"), { [canonicalProject]: true })
  const script = {
    steps: [
      { type: "tool_call", name: "task", arguments: { category: "mockcat", prompt: `race task from ${name}`, run_in_background: true, name: `${name}-race` } },
      { type: "text", text: `${name} parent complete` },
    ],
  }
  const scriptPath = join(parentRoot, "mock-script.json")
  writeJson(scriptPath, script)
  return {
    name,
    home,
    agentDir,
    sessionDir,
    scriptPath,
    readyFile: join(gates, "ready"),
    goFile: join(gates, "go"),
    timeoutMs,
  }
}

function seedProject(projectDir) {
  mkdirSync(join(projectDir, ".omo"), { recursive: true })
  writeJson(join(projectDir, ".omo", "omo.json"), {
    categories: { mockcat: { description: "local QA-only mock category", model: "omo-mock/mock-1" } },
  })
}

function startSenpi(senpiBin, parent, projectDir, timeoutMs) {
  const child = spawn(senpiBin, [
    "-e", mockProviderEntry, "-p", "--mode", "json", "--provider", "omo-mock", "--model", "mock-1",
    "--session-dir", parent.sessionDir, `launch the ${parent.name} background race task`,
  ], {
    cwd: projectDir,
    env: {
      ...process.env,
      HOME: parent.home,
      SENPI_CODING_AGENT_DIR: parent.agentDir,
      SENPI_CODING_AGENT_SESSION_DIR: parent.sessionDir,
      SENPI_QA_MOCK_SCRIPT: parent.scriptPath,
      SENPI_QA_READY_FILE: parent.readyFile,
      SENPI_QA_GO_FILE: parent.goFile,
      SENPI_QA_GATE_TIMEOUT_MS: String(timeoutMs),
      OMO_SENPI_QA: "1",
    },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  })
  let stdout = ""
  let stderr = ""
  child.stdout.on("data", (chunk) => { stdout += chunk })
  child.stderr.on("data", (chunk) => { stderr += chunk })
  const completion = new Promise((resolve) => {
    child.on("close", (status, signal) => resolve({ status, signal, stdout, stderr }))
    child.on("error", (error) => resolve({ status: null, signal: null, stdout, stderr: `${stderr}\n${error.message}` }))
  })
  return { name: parent.name, pid: child.pid, completion }
}

function waitForCompletion(run, timeoutMs, artifactDir, phase) {
  let timer
  return Promise.race([
    run.completion,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        killProcessGroup(run.pid)
        const timeout = { phase, name: run.name, pid: run.pid, timeout_ms: timeoutMs }
        writeJson(join(artifactDir, `${run.name}.${phase}.timeout.json`), timeout)
        reject(new Error(`timed out after ${timeoutMs}ms waiting for ${run.name} during ${phase}`))
      }, timeoutMs)
    }),
  ]).finally(() => clearTimeout(timer))
}

function killProcessGroup(pid) {
  if (!Number.isInteger(pid)) return false
  try {
    process.kill(-pid, "SIGKILL")
    return true
  } catch (error) {
    if (isMissingProcess(error)) return false
    throw error
  }
}

function waitForFile(path, timeoutMs) {
  if (existsSync(path)) return Promise.resolve()
  return new Promise((resolvePromise, reject) => {
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      watcher.close()
      if (error === undefined) resolvePromise()
      else reject(error)
    }
    const watcher = watch(dirname(path), (_event, filename) => {
      if (filename === null || filename.toString() === basename(path)) {
        if (existsSync(path)) finish()
      }
    })
    const timer = setTimeout(() => finish(new Error(`timed out after ${timeoutMs}ms waiting for ${path}`)), timeoutMs)
    if (existsSync(path)) finish()
  })
}

async function cleanupRuns(runs, root, timeoutMs, artifactDir) {
  const pids = runs.map((run) => run.pid).filter((pid) => Number.isInteger(pid))
  const terminated = []
  for (const pid of pids) {
    if (killProcessGroup(pid)) terminated.push(pid)
  }
  await Promise.all(runs.map((run) => waitForCompletion(run, timeoutMs, artifactDir, "teardown")))
  const verified_dead = pids.filter((pid) => !isAlive(pid))
  if (verified_dead.length !== pids.length) throw new Error(`cleanup could not terminate process groups: ${pids.filter((pid) => isAlive(pid)).join(", ")}`)
  rmSync(root, { recursive: true, force: true })
  return { pids, terminated, verified_dead, sandbox_removed: !existsSync(root) }
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true } catch (error) { if (isMissingProcess(error)) return false; throw error }
}

function isMissingProcess(error) {
  return error instanceof Error && "code" in error && error.code === "ESRCH"
}

function lsTasks(projectDir) {
  const tasksDir = join(projectDir, ".omo", "senpi-task", "tasks")
  if (!existsSync(tasksDir)) return "<absent>\n"
  const result = spawnSync("ls", ["-la", tasksDir], { encoding: "utf8", timeout: 30_000 })
  return `${result.stdout}${result.stderr}`
}

function taskIdsFromListing(listing) {
  return listing.split(/\r?\n/).map((line) => line.trim().split(/\s+/).at(-1) ?? "").filter((entry) => /^st_[0-9a-f]{8}\.json$/.test(entry)).map((entry) => entry.slice(0, -5))
}

function copySessionTranscript(from, to) {
  if (existsSync(from)) cpSync(from, to, { recursive: true })
}

function parseArgs(args) {
  let evidenceDir
  let timeoutMs = 120_000
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--evidence-dir") evidenceDir = args[++index]
    else if (args[index] === "--timeout-ms") timeoutMs = Number(args[++index])
    else throw new Error(`unknown argument: ${args[index]}`)
  }
  if (typeof evidenceDir !== "string" || evidenceDir.length === 0) throw new Error("usage: node task-id-race-qa.mjs --evidence-dir <dir> [--timeout-ms 120000]")
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("--timeout-ms must be a positive number")
  return { evidenceDir: resolve(evidenceDir), timeoutMs }
}

function resolveSenpi(bin) {
  if (bin.includes("/")) return existsSync(bin) ? resolve(bin) : null
  for (const entry of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = resolve(entry || ".", bin)
    if (existsSync(candidate)) return candidate
  }
  return null
}

function versionOf(bin) {
  const result = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 30_000 })
  return `${result.stdout}${result.stderr}`.trim() || "unknown"
}

function git(...args) {
  const result = spawnSync("git", args, { cwd: resolve(packageRoot, "..", ".."), encoding: "utf8", timeout: 30_000 })
  return result.status === 0 ? result.stdout.trim() : "unknown"
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
})

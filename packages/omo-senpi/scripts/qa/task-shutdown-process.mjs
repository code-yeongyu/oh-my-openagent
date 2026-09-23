#!/usr/bin/env bun
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { isolatedEnvironment } from "./agent-toolkit-eval-sdk-qa-support.mjs"

const script = fileURLToPath(import.meta.url)
const packageRoot = resolve(dirname(script), "../..")
const worktree = resolve(packageRoot, "../..")
const pluginRoot = join(worktree, "packages/omo-native/plugin")
const mockProvider = join(packageRoot, "scripts/qa/mock-provider/index.ts")

function alive(pid) {
  try { process.kill(pid, 0); return true } catch (error) {
    if (error.code === "ESRCH") return false
    throw error
  }
}

async function worker(sandbox) {
  const cwd = join(sandbox, "project")
  const agentDir = join(sandbox, "agent")
  const { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } = await import("@code-yeongyu/senpi")
  const settingsManager = SettingsManager.inMemory({ defaultProvider: "omo-mock", defaultModel: "mock-1" })
  const loader = new DefaultResourceLoader({
    cwd, agentDir, settingsManager, additionalExtensionPaths: [pluginRoot, mockProvider],
  })
  let session
  let childPid
  let watcher
  let deadline
  try {
    await loader.reload()
    assert.deepEqual(loader.getExtensions().errors, [])
    ;({ session } = await createAgentSession({
      cwd, agentDir, settingsManager, resourceLoader: loader, sessionManager: SessionManager.inMemory(cwd),
    }))
    await session.bindExtensions({})
    const tasksDir = join(cwd, ".omo/senpi-task/tasks")
    mkdirSync(tasksDir, { recursive: true })
    const completed = new Promise((resolveRecord, reject) => {
      const inspect = () => {
        for (const file of readdirSync(tasksDir).filter(name => name.endsWith(".json"))) {
          const record = JSON.parse(readFileSync(join(tasksDir, file), "utf8"))
          if (record.pid) childPid = record.pid
          if (record.status === "completed") resolveRecord(record)
          if (record.status === "error" || record.status === "lost") reject(new Error(JSON.stringify(record)))
        }
      }
      watcher = watch(tasksDir, inspect)
      deadline = setTimeout(() => reject(new Error("task completion deadline exceeded")), 60000)
    })
    completed.catch(() => {})
    const task = await session.executeTool("task", {
      category: "shutdown-qa", prompt: "Reply TASK_7_CHILD_COMPLETE.", run_in_background: true,
    }, { signal: AbortSignal.timeout(60000) })
    console.log("TASK_RESULT", JSON.stringify(task))
    assert.notEqual(task.isError, true)
    const record = await completed
    clearTimeout(deadline)
    watcher.close()
    assert.equal(record.execution_mode, "process")
    assert.ok(record.pid && alive(record.pid))
    assert.equal(record.residency_state, "resident")
    console.log("BEFORE", JSON.stringify({ pid: record.pid, status: record.status, residency: record.residency_state, alive: true }))
    console.log("ARTIFACTS", JSON.stringify({ pluginRoot, mockProvider, engine: import.meta.resolve("@code-yeongyu/senpi"), sandbox }))
    const getSessionId = session.sessionManager.getSessionId
    session.sessionManager.getSessionId = () => undefined
    const shutdownStarted = performance.now()
    try {
      await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" })
    } finally {
      session.sessionManager.getSessionId = getSessionId
    }
    const after = JSON.parse(readFileSync(join(tasksDir, `${record.task_id}.json`), "utf8"))
    const shutdownMs = performance.now() - shutdownStarted
    console.log("AFTER", JSON.stringify({ pid: record.pid, status: after.status, residency: after.residency_state, alive: alive(record.pid), shutdownMs }))
    assert.equal(alive(record.pid), false)
    assert.ok(shutdownMs < 7000, "child must exit within orphanKillDelayMs + 2 seconds (shared host, non-quiet)")
    assert.equal(after.status, "completed")
    assert.equal(after.residency_state, "rpc_detached")
    assert.notEqual(after.killed, true)
    console.log("PASS built-plugin missing-session shutdown reclaims completed process")
  } finally {
    clearTimeout(deadline)
    watcher?.close()
    session?.dispose()
    if (childPid && alive(childPid)) {
      process.kill(process.platform === "win32" ? childPid : -childPid, "SIGKILL")
      console.log(`CLEANUP forced child pid=${childPid}`)
    }
    console.log(`CLEANUP worker=${process.pid} child=${childPid} alive=${childPid ? alive(childPid) : false}`)
  }
}

async function supervise() {
  const sandbox = mkdtempSync(join(worktree, ".omo-task7-qa-"))
  for (const dir of ["agent", "project/.omo", "home", "tmp"]) mkdirSync(join(sandbox, dir), { recursive: true })
  writeFileSync(join(sandbox, "project/.omo/omo.json"), JSON.stringify({
    task: { default_execution_mode: "process", process_runner: "child-process" },
    memory: { enabled: false },
    categories: { "shutdown-qa": { model: "omo-mock/mock-1" } },
  }))
  writeFileSync(join(sandbox, "agent/settings.json"), JSON.stringify({ packages: [pluginRoot, mockProvider] }))
  writeFileSync(join(sandbox, "project/mock-script.json"), JSON.stringify({ steps: [{ type: "text", text: "TASK_7_CHILD_COMPLETE" }] }))
  const child = spawn(process.execPath, [script, "--worker", sandbox], {
    cwd: join(sandbox, "project"), env: isolatedEnvironment(sandbox, packageRoot),
    stdio: "inherit", detached: process.platform !== "win32", windowsHide: true,
  })
  const exit = once(child, "exit")
  const deadline = setTimeout(() => child.kill("SIGKILL"), 120000)
  try {
    const [code] = await exit
    assert.equal(code, 0)
  } finally {
    clearTimeout(deadline)
    if (alive(child.pid)) child.kill("SIGKILL")
    rmSync(sandbox, { recursive: true, force: true })
    console.log(`CLEANUP supervisor child=${child.pid} alive=${alive(child.pid)} sandboxRemoved=${!existsSync(sandbox)}`)
  }
}

if (process.argv[2] === "--worker") await worker(process.argv[3])
else await supervise()

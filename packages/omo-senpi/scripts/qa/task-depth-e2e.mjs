#!/usr/bin/env node
// Live proof for #9036: the REAL senpi binary with the built omo plugin, a mock model that always
// delegates, and a `worker` agent that runs as its own process. The tree must stop at max_depth:
// the depth-1 child's own `task` call is refused, it answers instead, and the whole run makes a
// bounded number of model requests. Usage:
//   SENPI_BIN="$(command -v senpi)" node task-depth-e2e.mjs --out <dir> [--timeout-ms 120000] [--keep-sandbox]
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { createSandbox, seedSandbox } from "./drive.mjs"
import { engineStateDir, isolatedChildEnv } from "./sandbox-child-env.mjs"
import { isAlive, killTree } from "./task-e2e-process.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const mockProviderEntry = join(scriptDir, "task-depth-e2e-mock-provider.ts")
const TASK_TREE_ENV_NAMES = ["OMO_SENPI_TASK_RPC_CHILD", "OMO_SENPI_TASK_DEPTH", "OMO_SENPI_TASK_ROOT_SESSION_ID"]
// Each level's delegate, answer and follow-up turns; an unbounded tree passes this in seconds.
const MAX_REQUESTS_PER_LEVEL = 5

function argValue(name, fallback) {
  const index = process.argv.indexOf(name)
  return index === -1 ? fallback : process.argv[index + 1]
}

function readJsonLines(path) {
  if (!existsSync(path)) return []
  return readFileSync(path, "utf8").split(/\r?\n/).filter((line) => line.length > 0).map((line) => JSON.parse(line))
}

function readTaskRecords(stateDir) {
  const tasksDir = join(stateDir, "tasks")
  if (!existsSync(tasksDir)) return []
  return readdirSync(tasksDir)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => JSON.parse(readFileSync(join(tasksDir, entry), "utf8")))
}

function main() {
  const senpiBin = process.env.SENPI_BIN
  const outDir = argValue("--out", undefined)
  const timeoutMs = Number(argValue("--timeout-ms", "120000"))
  if (senpiBin === undefined || senpiBin.length === 0 || !existsSync(senpiBin)) {
    console.log(JSON.stringify({ status: "SKIP", reason: "SENPI_BIN is not an existing senpi binary" }))
    return
  }
  if (outDir === undefined) throw new Error("--out <dir> is required")
  mkdirSync(outDir, { recursive: true })

  const sandbox = createSandbox()
  seedSandbox(sandbox)
  const sessionDir = join(sandbox.root, "sessions")
  mkdirSync(sessionDir, { recursive: true })
  mkdirSync(join(sandbox.cwd, ".omo"), { recursive: true })
  const maxDepth = argValue("--max-depth", undefined)
  const omoConfig = {
    task: { process_runner: "child-process", ...(maxDepth === undefined ? {} : { max_depth: Number(maxDepth) }) },
    agents: { worker: { description: "Delegating worker.", model: "omo-mock/mock-1", execution_mode: "process" } },
  }
  writeFileSync(join(sandbox.cwd, ".omo", "omo.json"), `${JSON.stringify(omoConfig, null, 2)}\n`)

  const env = {
    ...isolatedChildEnv(process.env, sandbox.agentDir),
    HOME: sandbox.homeDir,
    XDG_CONFIG_HOME: sandbox.xdgConfigHome,
    XDG_DATA_HOME: sandbox.xdgDataHome,
    XDG_CACHE_HOME: sandbox.xdgCacheHome,
    SENPI_CODING_AGENT_SESSION_DIR: sessionDir,
    OMO_SENPI_QA: "1",
  }
  for (const name of TASK_TREE_ENV_NAMES) delete env[name]

  const startedAt = Date.now()
  const run = spawnSync(
    senpiBin,
    ["-e", mockProviderEntry, "-p", "--mode", "json", "--provider", "omo-mock", "--model", "mock-1", "--session-dir", sessionDir, "delegate this"],
    { cwd: sandbox.cwd, env, encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 },
  )
  const elapsedMs = Date.now() - startedAt

  const requests = readJsonLines(join(sandbox.cwd, "depth-requests.jsonl"))
  const records = readTaskRecords(engineStateDir(sandbox.cwd, env))
  const pids = [...new Set([run.pid, ...requests.map((request) => request.pid)].filter((pid) => typeof pid === "number"))]
  const limit = maxDepth === undefined ? 1 : Number(maxDepth)
  // The deepest session allowed to exist is the one whose spawn gets refused; at limit 0 that is the root.
  const deepestEnv = limit === 0 ? null : String(limit)
  const refusal = requests.find((request) => request.depth_env === deepestEnv && typeof request.tool_result === "string" && request.tool_result.includes("max_depth"))
  const recordDepths = records.map((record) => record.depth)
  const checks = {
    run_exited_cleanly: run.status === 0 && run.error === undefined ? "PASS" : "FAIL",
    tree_stops_at_max_depth: records.length === limit && recordDepths.every((depth) => depth >= 1 && depth <= limit) && new Set(recordDepths).size === limit ? "PASS" : "FAIL",
    each_child_saw_its_real_depth: Array.from({ length: limit }, (_, index) => String(index + 1)).every((depth) => requests.some((request) => request.rpc && request.depth_env === depth)) ? "PASS" : "FAIL",
    deepest_spawn_refused_with_reason: refusal !== undefined ? "PASS" : "FAIL",
    no_request_below_max_depth: requests.every((request) => request.depth_env === null || Number(request.depth_env) <= limit) ? "PASS" : "FAIL",
    delegations_bounded: requests.filter((request) => request.action === "delegate").length <= limit + 1 ? "PASS" : "FAIL",
    requests_bounded: requests.length <= MAX_REQUESTS_PER_LEVEL * (limit + 1) ? "PASS" : "FAIL",
  }

  // Persist what the run produced BEFORE teardown: an unbounded tree keeps writing into the sandbox.
  writeFileSync(join(outDir, "depth-requests.jsonl"), requests.map((request) => JSON.stringify(request)).join("\n"))
  writeFileSync(join(outDir, "senpi-stdout.jsonl"), run.stdout ?? "")
  writeFileSync(join(outDir, "senpi-stderr.txt"), run.stderr ?? "")

  const leaked = []
  for (const pid of pids) {
    if (isAlive(pid)) {
      leaked.push(pid)
      killTree(pid)
    }
  }
  const stillAlive = pids.filter((pid) => isAlive(pid))
  const keep = process.argv.includes("--keep-sandbox")
  let removeError = null
  if (!keep) {
    try {
      rmSync(sandbox.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    } catch (error) {
      removeError = error instanceof Error ? error.message : String(error)
    }
  }

  const status = Object.values(checks).every((value) => value === "PASS") ? "PASS" : "FAIL"
  const result = {
    status,
    checks,
    elapsed_ms: elapsedMs,
    exit: { status: run.status, signal: run.signal ?? null, error: run.error?.message ?? null },
    request_count: requests.length,
    requests,
    task_records: records.map((record) => ({ task_id: record.task_id, depth: record.depth, root_session_id: record.root_session_id, status: record.status, execution_mode: record.execution_mode })),
    refusal_text: refusal?.tool_result ?? null,
    sandbox: sandbox.root,
    cleanup: { pids, killed_leftovers: leaked, still_alive: stillAlive, sandbox_removed: !keep && !existsSync(sandbox.root), remove_error: removeError },
  }
  writeFileSync(join(outDir, "task-depth-e2e.json"), `${JSON.stringify(result, null, 2)}\n`)
  console.log(JSON.stringify({ status, checks, request_count: requests.length, elapsed_ms: elapsedMs, cleanup: result.cleanup }))
  if (status !== "PASS") process.exitCode = 1
}

main()

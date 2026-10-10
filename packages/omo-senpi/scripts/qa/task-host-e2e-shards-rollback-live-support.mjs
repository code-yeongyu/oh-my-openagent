import { createHash } from "node:crypto"
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { observeState, stopParent } from "./task-host-e2e-events.mjs"
import { lastJsonLine, runBin } from "./task-host-e2e-process.mjs"
import {
  addProject, awaitParent, mainProject, newSandbox, statusAll, taskConfig,
  taskRecords, teardownSandbox,
} from "./task-host-e2e-shard-cost-support.mjs"
import { sandboxEnv } from "./task-host-e2e-sandbox.mjs"

function config(stateDir) {
  const value = taskConfig({ default_execution_mode: "process", process_runner: "host",
    ...(stateDir === undefined ? {} : { state_dir: stateDir }) })
  value.categories.proc.model = "omo-http/mock-1"
  return value
}

function spawnParent(sandbox, project, prompt, session) {
  const args = ["-p", "--mode", "json", "--provider", "omo-http", "--model", "mock-1",
    "--session-dir", sandbox.sessionDir, prompt]
  if (session !== undefined) args.unshift("--session", session)
  const child = spawn(sandbox.bin, args, {
    cwd: project.cwd, env: sandboxEnv(sandbox), detached: true, stdio: ["ignore", "pipe", "pipe"],
  })
  const events = []
  let buffer = ""
  child.stdout.setEncoding("utf8")
  child.stdout.on("data", (chunk) => {
    buffer += chunk
    for (let index = buffer.indexOf("\n"); index >= 0; index = buffer.indexOf("\n")) {
      const line = buffer.slice(0, index)
      buffer = buffer.slice(index + 1)
      try { events.push(JSON.parse(line)) } catch {}
    }
  })
  const closed = new Promise((resolve) => child.once("close", (status, signal) => resolve({ status, signal })))
  return { child, closed, events, sessionId: () => events.find((event) => event.type === "session")?.id }
}

const rows = (projects) =>
  projects.flatMap((project) => taskRecords(project).map((record) => ({ project, record })))

function sessionFile(sandbox, parent) {
  const id = parent.sessionId()
  const name = id && readdirSync(sandbox.sessionDir).find((entry) => entry.endsWith(".jsonl") && entry.includes(id))
  if (name === undefined) throw new Error(`parent session file missing for ${id ?? "unknown"}`)
  return join(sandbox.sessionDir, name)
}

function recordDigests(projects) {
  return Object.fromEntries(projects.flatMap((project) => {
    const dir = join(project.stateDir, "tasks")
    if (!existsSync(dir)) return []
    return readdirSync(dir).filter((name) => name.endsWith(".json")).sort().map((name) => {
      const path = join(dir, name)
      return [path, createHash("sha256").update(readFileSync(path)).digest("hex")]
    })
  }))
}

function migratedEvents(project, taskId) {
  const path = join(project.stateDir, "logs", `${taskId}.jsonl`)
  if (!existsSync(path)) return []
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map(JSON.parse).filter(
    (event) => event.type === "host_session_migrated")
}

async function startInterrupted(sandbox, projects, provider) {
  const parents = projects.map((project) =>
    spawnParent(sandbox, project, `rollback parent ${project.name}`))
  const running = await observeState(sandbox.root, () => {
    const current = rows(projects)
    return current.length === projects.length && current.every(({ record }) =>
      record.status === "running" &&
      typeof record.host_session?.socket === "string" &&
      typeof record.host_session?.session_path === "string") &&
      Object.keys(provider.arrivals).length === projects.length ? current : undefined
  }, { timeoutMs: 240_000 })
  if (running === undefined) throw new Error("rollback text streams did not reach mid-turn")
  const sessions = parents.map((parent) => sessionFile(sandbox, parent))
  return { running, sessions, parents }
}

async function drainNormally(sandbox, provider, parents) {
  const requested = runBin(sandbox, ["daemon", "stop", "--drain", "--all"], { timeoutMs: 60_000 })
  const ownership = statusAll(sandbox).endpoints.map((endpoint) => ({
    socket: endpoint.socket,
    alive: endpoint.generations?.some((generation) => generation.alive) ?? false,
    claims_live: endpoint.claims_live ?? 0,
  }))
  const waiting = spawn(sandbox.bin,
    ["daemon", "stop", "--drain", "--all", "--wait", "--timeout", "120"],
    { cwd: sandbox.cwd, env: sandboxEnv(sandbox), stdio: ["ignore", "pipe", "pipe"] })
  let stdout = ""
  let stderr = ""
  waiting.stdout.setEncoding("utf8")
  waiting.stderr.setEncoding("utf8")
  waiting.stdout.on("data", (chunk) => { stdout += chunk })
  waiting.stderr.on("data", (chunk) => { stderr += chunk })
  let settled = false
  const closed = new Promise((resolve) => waiting.once("close",
    (status, signal) => { settled = true; resolve({ status, signal }) }))
  await new Promise((resolve, reject) => {
    waiting.once("spawn", resolve)
    waiting.once("error", reject)
  })
  if (!ownership.every((row) => row.alive && row.claims_live >= 1) || settled) {
    throw new Error(`drain ownership gate missing: ${JSON.stringify({ ownership, settled })}`)
  }
  provider.releaseRequested = true
  await Promise.all(Object.values(provider.interruptReady).map((entry) => entry.promise))
  await Promise.all(parents.map((parent) => parent.closed))
  let timer
  const result = await Promise.race([
    closed,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        waiting.kill("SIGKILL")
        reject(new Error("drain --wait timed out after 180000 ms"))
      }, 180_000)
    }),
  ])
  clearTimeout(timer)
  const after = statusAll(sandbox).endpoints.map((endpoint) => ({
    socket: endpoint.socket,
    alive: endpoint.generations?.some((generation) => generation.alive) ?? false,
    claims_live: endpoint.claims_live ?? 0,
  }))
  const stream_ms = Object.fromEntries(Object.keys(provider.arrivals).map((label) =>
    [label, (provider.released[label] ?? 0) - provider.arrivals[label]]))
  return { requested_exit: requested.status, requested_stdout: requested.stdout, ownership,
    wait_exit: result.status, wait_stdout: stdout, wait_stderr: stderr, after, stream_ms,
    parents_closed: true }
}

function interruptCompletedRecord(project, record) {
  const sessionPath = record.host_session.session_path
  const lines = readFileSync(sessionPath, "utf8").split("\n").filter(Boolean)
  let lastUser = -1
  for (let index = 0; index < lines.length; index += 1) {
    const row = JSON.parse(lines[index])
    if (row.type === "message" && row.message?.role === "user") lastUser = index
  }
  if (lastUser < 0) throw new Error(`rollback transcript has no user turn: ${sessionPath}`)
  writeFileSync(sessionPath, `${lines.slice(0, lastUser + 1).join("\n")}\n`)
  const recordPath = join(project.stateDir, "tasks", `${record.task_id}.json`)
  const current = JSON.parse(readFileSync(recordPath, "utf8"))
  const interrupted = {
    ...current,
    status: "running",
    residency_state: "rpc_detached",
    updated_at: new Date().toISOString(),
  }
  for (const key of [
    "terminal_at",
    "error_message",
    "failure_kind",
    "failure_reason",
    "suspension_reason",
  ]) {
    delete interrupted[key]
  }
  writeFileSync(recordPath, `${JSON.stringify(interrupted, null, 2)}\n`)
  return { sessionPath, keptLines: lastUser + 1 }
}

function makeSandbox(current, name, count) {
  const sandbox = newSandbox(current, name, { omoConfig: config() })
  const projects = [mainProject(sandbox)]
  if (count === 1) return { sandbox, projects }
  projects.push(addProject(sandbox, "project-b", {
    omoConfig: config(), script: { parentSteps: [], childSteps: [] },
  }))
  const custom = join(current.root, "rollback-custom-store")
  mkdirSync(custom, { recursive: true })
  projects.push({ ...addProject(sandbox, "project-c", {
    omoConfig: config(custom), script: { parentSteps: [], childSteps: [] },
  }), stateDir: custom })
  return { sandbox, projects, custom }
}

async function resumeOnR0(sandbox, r0, projects, sessions, original, provider) {
  const control = { ...sandbox, bin: r0.bin }
  const daemon = runBin(control, ["daemon", "run", "--json"], { timeoutMs: 120_000 })
  if (daemon.status !== 0) throw new Error(`R0 daemon run failed: ${daemon.stderr || daemon.stdout}`)
  provider.resumeRelease = false
  const parents = projects.map((project, index) =>
    spawnParent(control, project, `resume-parent task=${original[index].record.task_id}`, sessions[index]))
  const rpc = join(sandbox.agentDir, "rpc", "rpc.sock")
  const expectedWorkers = rows(projects).filter(({ record }) =>
    record.status === "running" || record.status === "pending").length
  const status = await observeState(sandbox.root, () => {
    const endpoint = statusAll(sandbox).endpoints.find((row) => row.socket === rpc)
    return (endpoint?.sessions?.worker ?? 0) >= expectedWorkers ? endpoint : undefined
  }, { timeoutMs: 180_000 })
  provider.resumeChildRelease = true
  // The mid-turn child must finish its continuation under its live parent. The other two finished
  // while no parent was attached; R0 reopens them on rpc.sock (the worker count above) but predates
  // adopting such a finished turn, so their records are reported as observed, not required settled.
  const midTurn = { project: original[0].project.name, task_id: original[0].record.task_id }
  const midTurnDone = await observeState(sandbox.root, () =>
    rows(projects).find(({ project, record }) =>
      project.name === midTurn.project && record.task_id === midTurn.task_id)?.record.status === "completed" ? true : undefined,
  { timeoutMs: 180_000 })
  const completed = midTurnDone === true ? rows(projects) : undefined
  provider.resumeRelease = true
  await Promise.all(parents.map((parent) => awaitParent(parent, 60_000)))
  const summary = ({ project, record }) => ({
    project: project.name, task_id: record.task_id, status: record.status, socket: record.host_session?.socket,
    residency_state: record.residency_state, suspension_reason: record.suspension_reason ?? null,
    error_message: record.error_message ?? null,
  })
  return { daemon: lastJsonLine(daemon.stdout), status, mid_turn: midTurn, expected_workers: expectedWorkers,
    records: completed?.map(summary) ?? [],
    ...(completed === undefined ? { unsettled: rows(projects).map(summary) } : {}) }
}

export async function runRollbackScenario(current, r0, prepare, createProvider) {
  const { sandbox, projects, custom } = makeSandbox(
    current, prepare ? "rollback-live" : "rollback-no-prepare", prepare ? 3 : 1)
  const provider = createProvider(sandbox)
  let resumeProvider
  let parents = []
  let facts = {}
  try {
    await provider.ready
    const interrupted = await startInterrupted(sandbox, projects, provider)
    parents = interrupted.parents
    const beforeSockets = interrupted.running.map(({ record }) => record.host_session.socket)
    const beforeDigests = recordDigests(projects)
    if (prepare) {
      const customRow = interrupted.running.find(({ project }) => project.name === "project-c")
      const metaPath = customRow.record.host_session.socket.replace(/\.sock$/, ".meta.json")
      const meta = JSON.parse(readFileSync(metaPath, "utf8"))
      delete meta.stores
      writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`)
      facts.custom_store = { path: custom, sidecar: metaPath, sidecar_stores_removed: true }
    }
    const refused = prepare
      ? runBin(sandbox, ["daemon", "rollback-prepare", "--json"], { timeoutMs: 120_000 })
      : undefined
    const afterDigests = recordDigests(projects)
    // Read the recorded sockets right after the refusal, before the drain and the real prepare
    // rewrite them to rpc.sock.
    const socketsAfterRefusal = rows(projects).map(({ record }) => record.host_session?.socket)
    const drain = await drainNormally(sandbox, provider, parents)
    parents = []
    const interruptedFixture = interruptCompletedRecord(
      projects[0],
      taskRecords(projects[0]).find((record) =>
        record.task_id === interrupted.running[0].record.task_id),
    )
    if (prepare) {
      const migration = runBin(sandbox, ["daemon", "rollback-prepare", "--json"], { timeoutMs: 120_000 })
      facts = { ...facts, interrupted_fixture: interruptedFixture,
        refused: { exit: refused.status, stderr: refused.stderr,
        beforeSockets, socketsAfterRefusal,
        beforeDigests, afterDigests }, drain,
        migration: { exit: migration.status, payload: lastJsonLine(migration.stdout),
          index: JSON.parse(readFileSync(join(sandbox.agentDir, "rpc", "task-stores.json"), "utf8")),
          records: rows(projects).map(({ project, record }) => ({ project: project.name,
            task_id: record.task_id, socket: record.host_session?.socket,
            events: migratedEvents(project, record.task_id) })) },
        resumed: await (async () => {
          resumeProvider = createProvider(sandbox)
          await resumeProvider.ready
          resumeProvider.resumePhase = true
          return resumeOnR0(
            sandbox, r0, projects, interrupted.sessions, interrupted.running, resumeProvider,
          )
        })() }
    } else {
      const control = { ...sandbox, bin: r0.bin }
      const daemon = runBin(control, ["daemon", "run", "--json"], { timeoutMs: 120_000 })
      if (daemon.status !== 0) throw new Error(`R0 daemon run failed: ${daemon.stderr || daemon.stdout}`)
      resumeProvider = createProvider(sandbox)
      await resumeProvider.ready
      resumeProvider.resumePhase = true
      resumeProvider.resumeRelease = false
      const parent = spawnParent(control, projects[0],
        `resume-parent task=${interrupted.running[0].record.task_id}`, interrupted.sessions[0])
      parents = [parent]
      const parked = await observeState(sandbox.root, () => {
        const record = taskRecords(projects[0])[0]
        return record?.suspension_reason === "daemon_unavailable" ? record : undefined
      }, { timeoutMs: 180_000 })
      resumeProvider.resumeRelease = true
      await awaitParent(parent, 60_000)
      parents = []
      facts = { interrupted_fixture: interruptedFixture,
        original_socket: beforeSockets[0], drain_wait_exit: drain.wait_exit,
        r0_daemon_exit: daemon.status, parked: parked === undefined ? null : {
          status: parked.status, suspension_reason: parked.suspension_reason,
          socket: parked.host_session?.socket } }
    }
  } catch (error) {
    facts = { ...facts, error: String(error?.stack ?? error) }
  } finally {
    provider.server.close()
    resumeProvider?.server.close()
    facts = { ...facts, cleanup: await teardownSandbox(sandbox, parents) }
  }
  return facts
}

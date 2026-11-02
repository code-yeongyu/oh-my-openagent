import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"

import { stopParent } from "./task-host-e2e-events.mjs"
import { pidAlive, runBin } from "./task-host-e2e-process.mjs"
import { newSocket, reachable, until } from "./task-host-e2e-shard-cost-observe.mjs"
import {
  CHILD_TEXT,
  awaitParent,
  childRequests,
  childTask,
  endpointSockets,
  heldChild,
  holdStep,
  mainProject,
  newSandbox,
  processTable,
  release,
  startParent,
  stopEndpoint,
  supervisorPid,
  taskConfig,
  taskStep,
  teardownSandbox,
  treePids,
} from "./task-host-e2e-shard-cost-support.mjs"
import { REQUIRED_SAMPLES, summarizeSamples } from "./task-host-e2e-shard-cost-eval.mjs"
import { userFirstChild } from "./task-host-e2e-shard-cost-user-latency.mjs"

const MAX_EXTRA_ATTEMPTS = 5

async function firstChildScenario(run, name, prewarm, samples, cleanup, log) {
  const gated = prewarm !== "off"
  const script = {
    parentSteps: [...(gated ? [holdStep("warm-go", 300)] : []), taskStep(childTask("first child")), { type: "text", text: "latency parent done" }],
    childSteps: CHILD_TEXT,
  }
  const sandbox = newSandbox(run.sharded, name, { omoConfig: taskConfig({ host_shard_prewarm: prewarm }), script })
  const project = mainProject(sandbox, script)
  const values = []
  const detail = []
  try {
    for (let index = 0; values.length < samples && index < samples + MAX_EXTRA_ATTEMPTS; index += 1) {
      const known = new Set(endpointSockets(sandbox))
      const seen = childRequests(project).length
      const parent = startParent(sandbox, project, `${name} sample ${index}`)
      let readyAt
      if (gated) {
        const socket = await newSocket(sandbox, known)
        if (socket !== undefined && (await reachable(sandbox, socket))) readyAt = Date.now()
        release(project, "warm-go")
      }
      const exit = await awaitParent(parent, 180_000)
      const taskAt = parent.taskCallAt()
      const first = childRequests(project).slice(seen)[0]
      const sockets = endpointSockets(sandbox).filter((socket) => !known.has(socket))
      const valid = taskAt !== undefined && first !== undefined && (!gated || (readyAt !== undefined && readyAt <= taskAt))
      if (valid) values.push(first.atMs - taskAt)
      detail.push({ ms: valid ? first.atMs - taskAt : "invalid", valid, prewarmed_before_task_call: gated ? readyAt !== undefined && readyAt <= taskAt : false, parent_exit: exit.status, new_endpoints: sockets.length })
      if (gated) rmSync(join(project.cwd, ".omo", "warm-go"), { force: true })
      for (const socket of sockets) cleanup.push(await stopEndpoint(sandbox, socket))
    }
  } finally {
    cleanup.push(await teardownSandbox(sandbox))
  }
  log(`(e) ${name}: ${values.length}/${samples} valid samples`)
  return summarizeSamples(values, { definition: "parent task tool_execution_start (driver clock) -> first child provider request (mock clock)", prewarm, invalid_samples: detail.filter((entry) => !entry.valid).length, detail })
}

async function reattachScenario(run, samples, cleanup, log) {
  const script = {
    parentSteps: [taskStep(childTask("held child", { run_in_background: true })), holdStep("parent-release", 900), { type: "text", text: "reattach parent done" }],
    childSteps: heldChild(600_000),
  }
  const sandbox = newSandbox(run.sharded, "lr", { script })
  const project = mainProject(sandbox, script)
  const values = []
  const detail = []
  try {
    for (let index = 0; values.length < samples && index < samples + MAX_EXTRA_ATTEMPTS; index += 1) {
      const known = new Set(endpointSockets(sandbox))
      const seen = childRequests(project).length
      const parent = startParent(sandbox, project, `reattach sample ${index}`)
      const midTurn = await until(sandbox, () => childRequests(project).slice(seen)[0], 180_000)
      const socket = endpointSockets(sandbox).find((candidate) => !known.has(candidate))
      const supervisor = socket === undefined ? undefined : supervisorPid(sandbox, socket)
      const table = processTable()
      const host = supervisor === undefined ? undefined : treePids(supervisor, table).find((pid) => table.get(pid)?.args.includes("--mode rpc"))
      let ms = null
      let replacement
      if (midTurn !== undefined && host !== undefined) {
        const killedAt = Date.now()
        process.kill(host, "SIGSEGV")
        const continuation = await until(sandbox, () => childRequests(project).slice(seen).find((request) => request.atMs > killedAt), 120_000)
        replacement = supervisorPid(sandbox, socket)
        if (continuation !== undefined) ms = continuation.atMs - killedAt
      }
      if (ms !== null) values.push(ms)
      detail.push({ ms: ms ?? "invalid", valid: ms !== null, killed_host_pid: host ?? "none", old_supervisor: supervisor ?? "none", new_supervisor: replacement ?? "none", new_generation: replacement !== undefined && replacement !== supervisor })
      await stopParent(parent)
      for (const pid of [supervisor, host].filter((pid) => pid !== undefined && pidAlive(pid))) {
        try {
          process.kill(pid, "SIGKILL")
        } catch {
          // gone
        }
      }
      if (socket !== undefined) cleanup.push(await stopEndpoint(sandbox, socket))
    }
  } finally {
    cleanup.push(await teardownSandbox(sandbox))
  }
  log(`(e) reattach_after_crash: ${values.length}/${samples} valid samples`)
  return summarizeSamples(values, { definition: "SIGSEGV to the shard's host process (driver clock) -> the child's first provider request after it (mock clock); includes the fresh-generation ensure and reopen", invalid_samples: detail.filter((entry) => !entry.valid).length, detail })
}

async function ensureScenario(run, liveHosts, samples, cleanup) {
  const sandbox = newSandbox(run.sharded, `le${liveHosts}`, { script: { parentSteps: [], childSteps: [] } })
  const dir = join(sandbox.agentDir, "rpc", "e")
  mkdirSync(dir, { recursive: true })
  const ensure = (socket) => {
    const started = performance.now()
    const result = runBin(sandbox, ["host", "ensure", "--socket", socket, "--launch-spec", run.sharded.specPath, "--policy", "never", "--json"], { timeoutMs: 120_000 })
    return { ms: performance.now() - started, exit: result.status }
  }
  const values = []
  const overhead = []
  try {
    for (let index = 0; index < liveHosts - 1; index += 1) {
      const bystander = ensure(join(dir, `b${index}.sock`))
      if (bystander.exit !== 0) throw new Error(`bystander host ${index} did not start`)
    }
    for (let index = 0; index < samples; index += 1) {
      const socket = join(dir, `s${index}.sock`)
      const started = performance.now()
      runBin(sandbox, ["host", "status", "--socket", join(dir, "absent.sock"), "--json"], { timeoutMs: 30_000 })
      overhead.push(performance.now() - started)
      const sample = ensure(socket)
      if (sample.exit === 0) values.push(sample.ms)
      cleanup.push(await stopEndpoint(sandbox, socket))
    }
  } finally {
    for (let index = 0; index < liveHosts - 1; index += 1) cleanup.push(await stopEndpoint(sandbox, join(dir, `b${index}.sock`)))
    cleanup.push(await teardownSandbox(sandbox))
  }
  return summarizeSamples(values, {
    definition: `wall time of \`omo host ensure --socket <fresh> --policy never\` with ${liveHosts - 1} other live host(s) in the agent dir (CLI process start included)`,
    live_hosts: liveHosts,
    cli_overhead_p50_ms: summarizeSamples(overhead).p50_ms,
  })
}

export async function latency(run, samples, cleanup, log) {
  const scenarios = {}
  scenarios.cold_first_child = await firstChildScenario(run, "lc", "off", samples, cleanup, log)
  scenarios.warm_first_turn = await firstChildScenario(run, "lw", "first-turn", samples, cleanup, log)
  scenarios.warm_session_start = await firstChildScenario(run, "ls", "session-start", samples, cleanup, log)
  scenarios.reattach_after_crash = await reattachScenario(run, samples, cleanup, log)
  scenarios.ensure_n1 = await ensureScenario(run, 1, samples, cleanup)
  scenarios.ensure_n4 = await ensureScenario(run, 4, samples, cleanup)
  Object.assign(scenarios, await userFirstChild(run, samples, cleanup, log))
  return { percentile: "nearest-rank", required_samples: REQUIRED_SAMPLES, scenarios }
}

import { join } from "node:path"

import { runBin } from "./task-host-e2e-process.mjs"
import { newSocket, reachable, sampleAll, settled, until } from "./task-host-e2e-shard-cost-observe.mjs"
import {
  CHILD_TEXT,
  childTask,
  endpointSockets,
  holdStep,
  hostStatus,
  mainProject,
  newSandbox,
  release,
  sampleEndpoint,
  settle,
  startParent,
  statusAll,
  supervisorPid,
  taskConfig,
  taskStep,
  teardownSandbox,
  totalOf,
} from "./task-host-e2e-shard-cost-support.mjs"

const IDLE_SETTLE_MS = 30_000
export const TURN_SETTLE_MS = 15_000

export async function idleAndMarginal(run, cleanup, log) {
  const script = {
    parentSteps: [
      holdStep("m1", 900), taskStep(childTask("marginal child 1")),
      holdStep("m2", 900), taskStep(childTask("marginal child 2")),
      holdStep("m3", 900), taskStep({ tasks: [childTask("marginal child 3"), childTask("marginal child 4")] }),
      holdStep("parent-release", 900), { type: "text", text: "marginal parent done" },
    ],
    childSteps: CHILD_TEXT,
  }
  const sandbox = newSandbox(run.sharded, "im", { omoConfig: taskConfig({ host_shard_prewarm: "session-start" }), script })
  const project = mainProject(sandbox, script)
  const parent = startParent(sandbox, project, "idle then marginal children")
  try {
    const socket = await newSocket(sandbox, new Set())
    if (socket === undefined || !(await reachable(sandbox, socket))) throw new Error("session-start pre-warm never produced a reachable shard")
    const ensuredAt = Date.now()
    log(`(a) shard ${socket.split("/").pop()} reachable; settling ${IDLE_SETTLE_MS} ms`)
    await settle(IDLE_SETTLE_MS)
    const status0 = hostStatus(sandbox, socket).json
    const idle = sampleEndpoint(socket, supervisorPid(sandbox, socket))
    const steps = []
    for (const [file, count] of [["m1", 1], ["m2", 2], ["m3", 4]]) {
      release(project, file)
      const records = await until(sandbox, () => settled(project, count))
      if (records === undefined) throw new Error(`(b) ${count} children never settled`)
      await settle(TURN_SETTLE_MS)
      const sample = sampleEndpoint(socket, supervisorPid(sandbox, socket))
      steps.push({
        children: count,
        completed: records.filter((record) => record.status === "completed").length,
        same_supervisor: sample.supervisor_pid === idle.supervisor_pid,
        endpoints: endpointSockets(sandbox).length,
        host_rss_mb: sample.host_rss_mb,
        host_footprint_mb: sample.host_footprint_mb,
        endpoint_rss_mb: sample.endpoint_rss_mb,
        endpoint_footprint_mb: sample.endpoint_footprint_mb,
        marginal_rss_mb_per_child: Math.round(((sample.host_rss_mb - idle.host_rss_mb) / count) * 10) / 10,
        marginal_footprint_mb_per_child: Math.round(((sample.host_footprint_mb - idle.host_footprint_mb) / count) * 10) / 10,
        processes: sample.processes,
      })
      log(`(b) ${count} children: host ${sample.host_rss_mb} MB RSS / ${sample.host_footprint_mb} MB footprint`)
    }
    return {
      idle: { ...idle, sessions_total: status0?.sessions?.total ?? null, ms_after_ensure: IDLE_SETTLE_MS, ensured_via: "task.host_shard_prewarm=session-start", ensured_at: new Date(ensuredAt).toISOString() },
      marginal: { settle_ms: TURN_SETTLE_MS, baseline_host_rss_mb: idle.host_rss_mb, baseline_host_footprint_mb: idle.host_footprint_mb, per_child: steps },
    }
  } finally {
    release(project, "parent-release")
    cleanup.push(await teardownSandbox(sandbox, [parent]))
  }
}

export async function controlIdle(run, cleanup) {
  const sandbox = newSandbox(run.control, "ci", { script: { parentSteps: [], childSteps: [] } })
  try {
    const ran = runBin(sandbox, ["daemon", "run", "--json"], { timeoutMs: 120_000 })
    const socket = join(sandbox.agentDir, "rpc", "rpc.sock")
    if (!(await reachable(sandbox, socket))) throw new Error(`control daemon run did not serve rpc.sock (exit ${ran.status})`)
    await settle(IDLE_SETTLE_MS)
    return { ...sampleEndpoint(socket, supervisorPid(sandbox, socket)), sessions_total: hostStatus(sandbox, socket).json?.sessions?.total ?? null, ensured_via: "omo daemon run (R0)" }
  } finally {
    cleanup.push(await teardownSandbox(sandbox))
  }
}

async function totalsFor(config, parents, cleanup) {
  const script = {
    parentSteps: [
      taskStep({ tasks: [1, 2, 3, 4].map((n) => childTask(`total child ${n}`)) }),
      holdStep("parent-release", 900),
      { type: "text", text: "totals parent done" },
    ],
    childSteps: CHILD_TEXT,
  }
  const sandbox = newSandbox(config, `t${parents}${config.kind[0]}`, { script })
  const project = mainProject(sandbox, script)
  const started = Array.from({ length: parents }, (_, index) => startParent(sandbox, project, `totals parent ${index}`))
  try {
    const records = await until(sandbox, () => settled(project, 4 * parents))
    if (records === undefined) throw new Error(`${config.kind} N=${parents}: ${4 * parents} children never settled`)
    await settle(TURN_SETTLE_MS)
    const status = statusAll(sandbox)
    const sockets = endpointSockets(sandbox)
    const shards = sockets.filter((socket) => /\/p-[0-9a-f]{16}\.sock$/.test(socket))
    const workers = status.endpoints.map((report) => report.sessions?.worker ?? null)
    const topology = config.kind === "control"
      ? { expected: "one reachable rpc.sock holding every child, no p-* shard", ok: sockets.length === 1 && sockets[0].endsWith("/rpc/rpc.sock") && shards.length === 0 && workers[0] === 4 * parents }
      : { expected: `${parents} p-* shards x 4 workers, no rpc.sock`, ok: shards.length === parents && sockets.length === parents && workers.every((count) => count === 4) }
    if (!topology.ok) throw new Error(`${config.kind} N=${parents} topology: ${JSON.stringify({ sockets, workers })}`)
    const samples = sampleAll(sandbox)
    return {
      children: 4 * parents,
      completed: records.filter((record) => record.status === "completed").length,
      status_all: status.mode,
      status_all_note: status.mode === "all" ? status.fieldsPresent.join(",") : status.reason,
      topology,
      workers_per_endpoint: workers,
      ...totalOf(samples),
      endpoints: samples,
    }
  } finally {
    release(project, "parent-release")
    cleanup.push(await teardownSandbox(sandbox, started))
  }
}

export async function totals(run, cleanup, log) {
  const rows = []
  for (const parents of [1, 2, 4]) {
    const sharded = await totalsFor(run.sharded, parents, cleanup)
    const control = await totalsFor(run.control, parents, cleanup)
    rows.push({ parents, children: 4 * parents, sharded, control, delta_rss_mb: Math.round((sharded.rss_mb - control.rss_mb) * 10) / 10, delta_footprint_mb: Math.round((sharded.footprint_mb - control.footprint_mb) * 10) / 10 })
    log(`(c) N=${parents}: sharded ${sharded.rss_mb} MB RSS (${sharded.endpoints_alive} hosts) vs control ${control.rss_mb} MB (1 host)`)
  }
  return { settle_ms: TURN_SETTLE_MS, rows }
}

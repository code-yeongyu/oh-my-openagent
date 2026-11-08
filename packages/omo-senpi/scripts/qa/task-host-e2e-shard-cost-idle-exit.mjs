import { join } from "node:path"

import { settled, until } from "./task-host-e2e-shard-cost-observe.mjs"
import {
  CHILD_TEXT,
  addProject,
  awaitParent,
  childRequests,
  childTask,
  endpointSockets,
  heldChild,
  holdStep,
  hostStatus,
  mainProject,
  newSandbox,
  pidAlive,
  processTable,
  release,
  sampleEndpoint,
  settle,
  shardOwners,
  startParent,
  supervisorPid,
  taskStep,
  teardownSandbox,
  totalOf,
  treePids,
} from "./task-host-e2e-shard-cost-support.mjs"

const PLUS_ONE_MS = 60_000
const PLUS_SIXTEEN_MS = 16 * 60_000
const LONG_EVICTION = "3600000"
const mockCwdMarker = (cwd) => `[[mock-cwd:${cwd}]]`

async function idleExitVariant(config, variant, cleanup, log) {
  const env = variant === "d2_long" ? { SENPI_RPC_SESSION_IDLE_EVICTION_MS: LONG_EVICTION } : {}
  const name = `${variant.replace("_default", "").replace("_long", "l")}${config.kind[0]}`
  const abCwd = join(config.root, name, "proj")
  const abScript = {
    parentSteps: [taskStep({ tasks: [childTask(`departed child 1 ${mockCwdMarker(abCwd)}`), childTask(`departed child 2 ${mockCwdMarker(abCwd)}`)] }), holdStep("parent-release", 1_500), { type: "text", text: "departed parent done" }],
    childSteps: CHILD_TEXT,
  }
  const sandbox = newSandbox(config, name, { script: abScript })
  if (sandbox.cwd !== abCwd) throw new Error(`sandbox cwd ${sandbox.cwd} is not the routed ${abCwd}`)
  const ab = mainProject(sandbox, abScript)
  const survivorScript = (cwd) => ({
    parentSteps: [taskStep(childTask(`survivor child ${mockCwdMarker(cwd)}`, { run_in_background: true })), holdStep("parent-release", 1_500), { type: "text", text: "survivor parent done" }],
    childSteps: heldChild(3_600_000),
  })
  const survivor = variant === "d1" ? undefined : addProject(sandbox, "c", { script: survivorScript(join(sandbox.root, "c")) })
  const parents = [startParent(sandbox, ab, "departed parent A", env), startParent(sandbox, ab, "departed parent B", env)]
  const survivorParent = survivor === undefined ? undefined : startParent(sandbox, survivor, "surviving parent C", env)
  if (survivorParent !== undefined) parents.push(survivorParent)
  try {
    const ready = await until(sandbox, () =>
      settled(ab, 4) !== undefined && (survivor === undefined || childRequests(survivor).length > 0) ? true : undefined)
    if (ready === undefined) throw new Error(`${config.kind} ${variant}: workload never reached its quit point`)
    const sockets = endpointSockets(sandbox)
    const owners = shardOwners(sandbox)
    const survivorSocket = config.kind === "sharded" && survivorParent !== undefined
      ? sockets.find((socket) => owners[socket] === survivorParent.sessionId())
      : undefined
    const before = Object.fromEntries(sockets.map((socket) => [socket, hostStatus(sandbox, socket).json?.sessions ?? null]))
    const table = processTable()
    const tracked = sockets.map((socket) => {
      const pids = treePids(supervisorPid(sandbox, socket) ?? -1, table)
      return { socket, supervisor: supervisorPid(sandbox, socket), host: pids.find((pid) => table.get(pid)?.args.includes("--mode rpc")), pids }
    })
    release(ab, "parent-release")
    await Promise.all(parents.slice(0, 2).map((parent) => awaitParent(parent, 120_000)))
    const quitAt = Date.now()
    await settle(PLUS_ONE_MS)
    const plusOne = tracked.map(({ socket, supervisor }) => sampleEndpoint(socket, supervisor))
    await settle(Math.max(0, quitAt + PLUS_SIXTEEN_MS - Date.now()))
    const aliveNow = tracked.map((entry) => ({ ...entry, alive: entry.pids.filter(pidAlive) }))
    const plusSixteen = tracked.map(({ socket, supervisor }) => sampleEndpoint(socket, supervisor))
    const result = {
      endpoints: tracked.map(({ socket, supervisor, host, pids }) => ({ socket: socket.split("/").pop(), supervisor_pid: supervisor ?? null, host_pid: host ?? null, pids, alive_at_16min: aliveNow.find((entry) => entry.socket === socket).alive })),
      sessions_before_quit: Object.fromEntries(Object.entries(before).map(([socket, sessions]) => [socket.split("/").pop(), sessions])),
      eviction_ms: variant === "d2_long" ? Number(LONG_EVICTION) : "default (idleExitMs 900000 copied by daemonLaunchOptions)",
      rss_mb_at_1min: totalOf(plusOne).rss_mb,
      rss_mb_at_16min: totalOf(plusSixteen).rss_mb,
      alive_rss_mb_at_16min: totalOf(plusSixteen).rss_mb,
      alive_endpoints_at_16min: aliveNow.filter((entry) => entry.alive.length > 0).map((entry) => entry.socket.split("/").pop()),
      samples_at_1min: plusOne,
      samples_at_16min: plusSixteen,
    }
    if (variant === "d1") {
      result.all_gone = aliveNow.every((entry) => entry.pids.length > 0 && entry.alive.length === 0)
    } else if (config.kind === "sharded") {
      const departed = aliveNow.filter((entry) => entry.socket !== survivorSocket)
      result.survivor_socket = survivorSocket?.split("/").pop() ?? null
      result.departed_gone = survivorSocket !== undefined && departed.length === 2 && departed.every((entry) => entry.pids.length > 0 && entry.alive.length === 0)
      result.survivor_alive = tracked.some((entry) => entry.socket === survivorSocket && entry.host !== undefined && pidAlive(entry.supervisor) && pidAlive(entry.host))
    } else {
      const socket = tracked[0]?.socket
      const status = socket === undefined ? undefined : hostStatus(sandbox, socket).json
      result.host_alive = aliveNow.length === 1 && aliveNow[0].alive.length > 0 && status?.reachable === true
      result.retained = status?.sessions?.retained ?? null
      result.sessions_at_16min = status?.sessions ?? null
    }
    log(`(d) ${config.kind} ${variant}: alive at +16 min = ${result.alive_endpoints_at_16min.length} endpoint(s), ${result.alive_rss_mb_at_16min} MB RSS`)
    return result
  } finally {
    if (survivor !== undefined) release(survivor, "parent-release")
    cleanup.push(await teardownSandbox(sandbox, parents))
  }
}

export async function idleExit(run, configs, cleanup, log) {
  const variants = ["d1", "d2_default", "d2_long"]
  const jobs = variants.flatMap((variant) => configs.map((config) => ({ variant, config })))
  const results = await Promise.all(jobs.map(async ({ variant, config }) => {
    try {
      return { variant, kind: config.kind, value: await idleExitVariant(config, variant, cleanup, log) }
    } catch (error) {
      return { variant, kind: config.kind, error: String(error?.stack ?? error) }
    }
  }))
  const failed = results.filter((entry) => entry.error !== undefined)
  if (failed.length > 0) throw new Error(`idle-exit variants failed: ${JSON.stringify(failed.map(({ variant, kind, error }) => ({ variant, kind, error: error.slice(0, 400) })))}`)
  const section = {}
  for (const { variant, kind, value } of results) section[variant] = { ...section[variant], [kind]: value }
  section.d2_long.label = "NON-DEFAULT: SENPI_RPC_SESSION_IDLE_EVICTION_MS=3600000 in both configurations"
  return section
}

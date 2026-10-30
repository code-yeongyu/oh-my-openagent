// The user-shaped half of the shard-cost latency section: what a person sees when a session's FIRST
// child starts, with nothing gated or pre-arranged.
//
// A fresh parent session opens, its first turn starts, the (mock) model thinks for a stated latency and
// answers with a `task` call, and the child starts. Measured: parent `task` tool_execution_start (driver
// clock) -> the child's first provider request (mock clock). The model latency cycles through
// MODEL_LATENCIES_MS per sample, the same schedule for every configuration, so the pre-warm overlaps the
// model call exactly as it would for a user. Configurations run interleaved, one sample of each per
// round, so every configuration sees the same machine load.
//
// The control is the pre-change release against its machine-wide host ALREADY RUNNING (`omo daemon run`,
// then one discarded warm-up child), which is what the first child of a session usually meets today: a
// sample counts only when the control's supervisor is the same process before and after it and no
// other endpoint appeared. A sharded sample counts only when exactly one new `p-*` shard served it. Both
// require the child to have run as a host session.
import { existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { pidAlive, runBin, waitFor } from "./task-host-e2e-process.mjs"
import { reachable } from "./task-host-e2e-shard-cost-observe.mjs"
import {
  CHILD_TEXT,
  awaitParent,
  childRequests,
  childTask,
  endpointSockets,
  holdStep,
  mainProject,
  newSandbox,
  processTable,
  release,
  sampleEndpoint,
  settle,
  startParent,
  stopEndpoint,
  supervisorPid,
  taskConfig,
  taskRecords,
  taskStep,
  teardownSandbox,
  treePids,
} from "./task-host-e2e-shard-cost-support.mjs"
import { summarizeSamples } from "./task-host-e2e-shard-cost-eval.mjs"

export const MODEL_LATENCIES_MS = [1000, 1500, 2000, 2500, 3000]
// Short enough for a QA host, long enough that the control's shared host outlives a whole round.
export const QA_IDLE_EXIT_MS = 180_000
const MAX_EXTRA_ROUNDS = 5
const SOCKET_POLL_MS = 50

/** Scenario name -> the sharded pre-warm value (`undefined` = key left out, the schema default). */
export const USER_SHARDED_MODES = {
  user_first_child_off: "off",
  user_first_child_first_turn: "first-turn",
  user_first_child_session_start: "session-start",
  user_first_child_default: undefined,
}

const qaEnv = (idleMs) => ({ SENPI_RPC_HOST_IDLE_EXIT_MS: String(idleMs), BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" })

function userScript(latencyMs) {
  return { parentSteps: [{ ...taskStep(childTask("first child")), delayMs: latencyMs }, { type: "text", text: "user parent done" }], childSteps: CHILD_TEXT }
}

// The earliest moment a new endpoint socket file exists, polled cheaply (a directory read, never a connection).
function watchNewSocket(sandbox, known) {
  let seen
  const timer = setInterval(() => {
    if (seen !== undefined) return
    const socket = endpointSockets(sandbox).find((candidate) => !known.has(candidate))
    if (socket !== undefined) seen = { socket, at: Date.now() }
  }, SOCKET_POLL_MS)
  return { stop: () => clearInterval(timer), seen: () => seen }
}

function configurations(run) {
  const sharded = Object.entries(USER_SHARDED_MODES).map(([name, prewarm]) => ({
    name,
    kind: "sharded",
    prewarm: prewarm ?? "default",
    config: run.sharded,
    omoConfig: taskConfig({ default_execution_mode: "auto", host_idle_exit_ms: QA_IDLE_EXIT_MS, ...(prewarm === undefined ? {} : { host_shard_prewarm: prewarm }) }),
  }))
  // The pre-change schema has no `host_shard_prewarm` (it is strict), so the control config never names it.
  const control = { name: "user_first_child_control", kind: "control", prewarm: "n/a", config: run.control, omoConfig: taskConfig({ default_execution_mode: "auto" }) }
  return [...sharded, control]
}

async function openConfiguration(entry, index) {
  const sandbox = newSandbox(entry.config, `u${index}${entry.kind[0]}`, { omoConfig: entry.omoConfig, script: userScript(MODEL_LATENCIES_MS[0]) })
  const project = mainProject(sandbox, userScript(MODEL_LATENCIES_MS[0]))
  const state = { entry, sandbox, project, values: [], detail: [] }
  if (entry.kind === "control") {
    const ran = runBin(sandbox, ["daemon", "run", "--json"], { timeoutMs: 120_000, env: qaEnv(QA_IDLE_EXIT_MS) })
    const socket = join(sandbox.agentDir, "rpc", "rpc.sock")
    if (!(await reachable(sandbox, socket))) throw new Error(`control daemon run did not serve rpc.sock (exit ${ran.status})`)
    state.sharedSocket = socket
  }
  return state
}

async function runSample(state, round, cleanup, latencyMs = MODEL_LATENCIES_MS[round % MODEL_LATENCIES_MS.length]) {
  const { entry, sandbox, project } = state
  const script = userScript(latencyMs)
  writeFileSync(join(project.cwd, "mock-script.json"), `${JSON.stringify(script, null, 2)}\n`)
  project.script = script
  const known = new Set(endpointSockets(sandbox))
  const sharedBefore = state.sharedSocket === undefined ? undefined : supervisorPid(sandbox, state.sharedSocket)
  const recordsBefore = new Set(taskRecords(project).map((record) => record.task_id))
  const seen = childRequests(project).length
  const watcher = watchNewSocket(sandbox, known)
  const parent = startParent(sandbox, project, `user-shaped ${entry.name} round ${round}`, qaEnv(QA_IDLE_EXIT_MS))
  const exit = await awaitParent(parent, 180_000)
  watcher.stop()
  const taskAt = parent.taskCallAt()
  const sessionAt = parent.events.find((event) => event.event.type === "session")?.at
  const first = childRequests(project).slice(seen)[0]
  const fresh = endpointSockets(sandbox).filter((socket) => !known.has(socket))
  const record = taskRecords(project).find((candidate) => !recordsBefore.has(candidate.task_id))
  const sharedAfter = state.sharedSocket === undefined ? undefined : supervisorPid(sandbox, state.sharedSocket)
  const topology = entry.kind === "control"
    ? sharedBefore !== undefined && sharedBefore === sharedAfter && fresh.length === 0
    : fresh.length === 1 && /\/p-[0-9a-f]{16}\.sock$/.test(fresh[0])
  const hostSession = record?.runner_kind === "host-session"
  const valid = taskAt !== undefined && first !== undefined && topology && hostSession
  const ms = valid ? first.atMs - taskAt : null
  const socketSeen = watcher.seen()
  state.detail.push({
    round,
    model_latency_ms: latencyMs,
    ms: ms ?? "invalid",
    valid,
    topology_ok: topology,
    runner_kind: record?.runner_kind ?? "none",
    session_to_task_call_ms: taskAt !== undefined && sessionAt !== undefined ? taskAt - sessionAt : "n/a",
    // Positive = the shard's socket existed that long before the task call (the pre-warm's lead).
    socket_lead_ms: socketSeen !== undefined && taskAt !== undefined ? taskAt - socketSeen.at : "none",
    shared_supervisor: sharedBefore ?? "none",
    parent_exit: exit.status,
  })
  for (const socket of fresh) cleanup.push(await stopEndpoint(sandbox, socket))
  return ms
}

/**
 * Every configuration's first-child latency under the same model-latency schedule, interleaved.
 * Round -1 is a discarded warm-up for every configuration (for the control it is what makes its host
 * "already running with a served session"; for the sharded ones it evens out the first cold file cache).
 */
export async function userFirstChild(run, samples, cleanup, log) {
  const states = []
  try {
    for (const [index, entry] of configurations(run).entries()) states.push(await openConfiguration(entry, index))
    for (const state of states) state.warmup = await runSample(state, -1, cleanup, MODEL_LATENCIES_MS[2])
    for (let round = 0; round < samples + MAX_EXTRA_ROUNDS && states.some((state) => state.values.length < samples); round += 1) {
      for (const state of states) {
        if (state.values.length >= samples) continue
        const ms = await runSample(state, round, cleanup)
        if (ms !== null) state.values.push(ms)
      }
    }
  } finally {
    for (const state of states) cleanup.push(await teardownSandbox(state.sandbox))
  }
  const scenarios = {}
  for (const state of states) {
    const { entry } = state
    scenarios[entry.name] = summarizeSamples(state.values, {
      definition: "user-shaped: fresh session -> first turn -> mock model latency -> task call; parent task tool_execution_start (driver clock) -> first child provider request (mock clock)",
      configuration: entry.kind,
      prewarm: entry.prewarm,
      model_latencies_ms: MODEL_LATENCIES_MS,
      warmup_ms: state.warmup ?? "invalid",
      invalid_samples: state.detail.filter((row) => row.round >= 0 && !row.valid).length,
      detail: state.detail,
    })
    log(`(e) ${entry.name}: ${state.values.length}/${samples} valid, p50 ${scenarios[entry.name].p50_ms} p95 ${scenarios[entry.name].p95_ms}`)
  }
  return scenarios
}

// What the pre-warm costs a session that never spawns a child, and proof its host still idles out. The
// parent's first turn holds (no child ever), so the default (first-turn) warms exactly as it would for a
// user who only chats; session-start warms without any turn.
const IDLE_PROBE_EXIT_MS = 45_000
const IDLE_PROBE_SAMPLE_MS = 20_000
export const PREWARM_IDLE_MODES = { default: undefined, session_start: "session-start" }

export async function prewarmIdle(run, cleanup, log) {
  const results = {}
  for (const [name, prewarm] of Object.entries(PREWARM_IDLE_MODES)) results[name] = await prewarmIdleProbe(run, name, prewarm, cleanup, log)
  return results
}

async function prewarmIdleProbe(run, name, prewarm, cleanup, log) {
  const script = { parentSteps: [holdStep("idle-release", 900), { type: "text", text: "idle parent done" }], childSteps: CHILD_TEXT }
  const omoConfig = taskConfig({ default_execution_mode: "auto", host_idle_exit_ms: IDLE_PROBE_EXIT_MS, ...(prewarm === undefined ? {} : { host_shard_prewarm: prewarm }) })
  const sandbox = newSandbox(run.sharded, `pi${name[0]}`, { omoConfig, script })
  const project = mainProject(sandbox, script)
  const watcher = watchNewSocket(sandbox, new Set())
  const startedAt = Date.now()
  const parent = startParent(sandbox, project, "a session that never spawns a child", qaEnv(IDLE_PROBE_EXIT_MS))
  try {
    const socket = await waitFor(() => watcher.seen()?.socket, { timeoutMs: 60_000, intervalMs: SOCKET_POLL_MS })
    watcher.stop()
    if (socket === undefined) throw new Error(`${name} pre-warm never created a shard socket`)
    if (!(await reachable(sandbox, socket))) throw new Error("pre-warmed shard never became reachable")
    // The status probe above is a connection, so the idle window restarts here.
    const lastProbeAt = Date.now()
    await settle(IDLE_PROBE_SAMPLE_MS)
    const supervisor = supervisorPid(sandbox, socket)
    const table = processTable()
    const pids = supervisor === undefined ? [] : treePids(supervisor, table)
    const idle = sampleEndpoint(socket, supervisor, table)
    const gone = await waitFor(() => (pids.length > 0 && pids.every((pid) => !pidAlive(pid)) ? Date.now() : undefined), {
      timeoutMs: IDLE_PROBE_EXIT_MS + 60_000,
      intervalMs: 250,
    })
    const parentAliveAtExit = pidAlive(parent.child.pid)
    const result = {
      prewarm: prewarm ?? "default",
      idle_exit_ms_configured: IDLE_PROBE_EXIT_MS,
      socket_created_after_parent_start_ms: watcher.seen().at - startedAt,
      sample_ms_after_last_probe: IDLE_PROBE_SAMPLE_MS,
      idle,
      host_pids: pids,
      host_exited: gone !== undefined,
      host_exit_ms_after_last_probe: gone === undefined ? "not within window + 60 s" : gone - lastProbeAt,
      parent_alive_at_host_exit: parentAliveAtExit,
      socket_file_after_exit: existsSync(socket),
      child_requests: childRequests(project).length,
      task_records: taskRecords(project).length,
    }
    log(`(f) prewarm idle ${name}: footprint ${idle.endpoint_footprint_mb} MB, host exited ${result.host_exit_ms_after_last_probe} ms after the last probe, parent alive ${parentAliveAtExit}`)
    return result
  } finally {
    watcher.stop()
    release(project, "idle-release")
    cleanup.push(await teardownSandbox(sandbox, [parent]))
  }
}

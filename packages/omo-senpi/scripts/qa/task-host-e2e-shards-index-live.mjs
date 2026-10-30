import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, realpathSync } from "node:fs"
import { dirname, join } from "node:path"

import { startMockCompletionsServer } from "./mock-completions-server.mjs"
import { observeState, stopParent } from "./task-host-e2e-events.mjs"
import { pidAlive, runBin, spawnParent } from "./task-host-e2e-process.mjs"
import { HostClient } from "./task-host-e2e-shards-rpc.mjs"
import { MOCK_ENTRY, awaitParent, endpointSockets, mainProject, newSandbox, startParent, supervisorPid, taskConfig, taskRecords, teardownSandbox } from "./task-host-e2e-shard-cost-support.mjs"
import { continuationCount, endpointFacts } from "./task-host-e2e-shards-support.mjs"
import { childSessionFiles, jsonlLines } from "./task-host-e2e-support.mjs"
import { captureAtomicWriteFailure, crossEndpointHazardPassed, finishRow, idleGcIndexResumePassed, observeRegistrationBeforeEndpoint, storeIndexPreconditionPassed, taskScript, writeHttpModels, writeScript } from "./task-host-e2e-shards-index-live-support.mjs"

const IDLE_EXIT_MS = 3_000

export async function runCrossEndpointOpenHazard(current, artifacts) {
  const sandbox = newSandbox(current, "index-hazard", { script: { parentSteps: [], childSteps: [] } })
  const duplicate = join(sandbox.root, "disposable-duplicate")
  const shard = join(sandbox.agentDir, "rpc", "shards", "p-aaaaaaaaaaaaaaaa.sock")
  const rpc = join(sandbox.agentDir, "rpc", "rpc.sock")
  const sessionPath = join(duplicate, "same-session.jsonl")
  let shardClient
  let rpcClient
  let facts = {}
  let cleanup
  let error
  try {
    cpSync(sandbox.cwd, duplicate, { recursive: true })
    mkdirSync(dirname(shard), { recursive: true })
    const ensure = (socket) => runBin(sandbox, [
      "host", "ensure", "--socket", socket, "--launch-spec", current.specPath, "--policy", "never", "--json",
    ], { timeoutMs: 120_000 })
    const shardEnsure = ensure(shard)
    const rpcEnsure = ensure(rpc)
    if (shardEnsure.status !== 0 || rpcEnsure.status !== 0) {
      throw new Error(`hazard endpoints failed to start: shard=${shardEnsure.status} rpc=${rpcEnsure.status}`)
    }
    shardClient = await HostClient.connect(shard, "hazard-shard")
    rpcClient = await HostClient.connect(rpc, "hazard-rpc")
    const params = { cwd: duplicate, sessionPath, kind: "interactive", context: { role: "interactive" }, provider: "omo-mock", modelId: "mock-1" }
    const first = await shardClient.openSession(params)
    const second = await rpcClient.openSession(params)
    facts = {
      same_session_path: sessionPath,
      shard_socket: shard,
      rpc_socket: rpc,
      shard_open_accepted: typeof first.routingId === "string",
      rpc_open_accepted: typeof second.routingId === "string",
      distinct_endpoints: shard !== rpc,
      guarded_hazard: "reservations are per endpoint; rollback must quiesce before reopening",
    }
  } catch (caught) {
    error = String(caught?.stack ?? caught)
  } finally {
    shardClient?.close()
    rpcClient?.close()
    rmSync(duplicate, { recursive: true, force: true })
    cleanup = await teardownSandbox(sandbox)
    facts.disposable_copy_removed = !existsSync(duplicate)
  }
  return finishRow("cross_endpoint_open_hazard", artifacts, facts, cleanup, error, crossEndpointHazardPassed)
}

export async function runIdleGcIndexResume(current, beforeBin, artifacts) {
  const config = taskConfig({ host_idle_exit_ms: IDLE_EXIT_MS })
  config.categories.proc.model = "omo-http/mock-1"
  const script = taskScript("idle-index-child", "idle index child", [{ type: "text", text: "interrupted child response" }])
  const sandbox = newSandbox(current, "idle-index", {
    omoConfig: config,
    script,
  })
  const project = mainProject(sandbox, script)
  const env = { SENPI_RPC_SESSION_IDLE_EVICTION_MS: String(IDLE_EXIT_MS) }
  const requestLog = join(project.cwd, ".omo", "idle-http-requests.jsonl")
  let initialReleased = false
  let initialRequestArrived = false
  const initialProvider = startMockCompletionsServer({
    steps: [{ type: "text", text: "interrupted child response", releaseWhen: () => initialReleased, releaseTimeoutMs: 120_000 }],
    requestLogPath: requestLog,
    onRequest: () => { initialRequestArrived = true },
  })
  let parent
  let resumed
  let resumeProvider
  let facts = {}
  let cleanup
  let error
  try {
    writeHttpModels(sandbox, await initialProvider.ready)
    const running = await observeState(sandbox.root, () => {
      const record = taskRecords(project).find((entry) => entry.name === "idle-index-child")
      return initialRequestArrived && record?.status === "running" ? record : undefined
    }, { trigger: () => { parent = startParent(sandbox, project, "start idle index child", env) } })
    if (running === undefined) throw new Error("idle child never reached a running mid-turn state")
    const parentSessionId = parent.sessionId()
    if (typeof parentSessionId !== "string") throw new Error("parent session id missing")
    const parentSessionName = readdirSync(sandbox.sessionDir)
      .find((name) => name.endsWith(".jsonl") && name.includes(parentSessionId))
    if (parentSessionName === undefined) throw new Error("parent session transcript missing")
    const socket = running.host_session?.socket
    const supervisor = typeof socket === "string" ? supervisorPid(sandbox, socket) : undefined
    if (typeof socket !== "string" || supervisor === undefined) throw new Error("idle child shard identity missing")
    await awaitParent(parent, 120_000)
    const host = endpointFacts(sandbox).find((entry) => entry.socket === socket)?.host
    if (host === null || host === undefined) throw new Error("idle child host process missing")
    const exited = await observeState(sandbox.root, () => !pidAlive(supervisor) ? true : undefined, {
      trigger: () => process.kill(host, "SIGSEGV"),
      timeoutMs: 60_000,
    })
    if (exited !== true) throw new Error("shard did not idle-exit after the child turn settled")
    const parked = taskRecords(project).find((entry) => entry.task_id === running.task_id)
    const interruptedFiles = childSessionFiles(sandbox, running.task_id)
    const interruptedTail = interruptedFiles.flatMap(jsonlLines).slice(-8)
    const interruptedAtExit = initialRequestArrived && !initialReleased
    const continuationBeforeR0 = continuationCount(sandbox, running.task_id)
    const transcriptPath = interruptedFiles[0]
    const transcriptLines = readFileSync(transcriptPath, "utf8").split("\n").filter(Boolean)
    const lastUser = transcriptLines.findLastIndex((line) => {
      const row = JSON.parse(line)
      return row.type === "message" && row.message?.role === "user"
    })
    if (lastUser < 0) throw new Error("idle child transcript has no user turn")
    writeFileSync(transcriptPath, `${transcriptLines.slice(0, lastUser + 1).join("\n")}\n`)
    const userTurnsBeforeR0 = transcriptLines.slice(0, lastUser + 1).filter((line) => {
      const row = JSON.parse(line)
      return row.type === "message" && row.message?.role === "user"
    }).length
    initialReleased = true
    initialProvider.close()
    const indexPath = join(sandbox.agentDir, "rpc", "task-stores.json")
    const indexBeforeGc = JSON.parse(readFileSync(indexPath, "utf8"))
    const gc = runBin(sandbox, ["daemon", "gc", "--json"], { timeoutMs: 60_000 })
    const rollback = runBin(sandbox, ["daemon", "rollback-prepare", "--json"], { timeoutMs: 120_000 })
    const migrated = taskRecords(project).find((entry) => entry.task_id === running.task_id)
    const r0 = { ...sandbox, bin: beforeBin }
    const provisioned = runBin(r0, ["--version"], { timeoutMs: 300_000 })
    const omoConfigPath = join(sandbox.agentDir, "omo.json")
    const r0Config = JSON.parse(readFileSync(omoConfigPath, "utf8"))
    delete r0Config.task?.host_idle_exit_ms
    writeFileSync(omoConfigPath, `${JSON.stringify(r0Config, null, 2)}\n`)
    resumeProvider = startMockCompletionsServer({
      steps: [{ type: "text", text: "R0 continuation complete" }],
      requestLogPath: join(project.cwd, ".omo", "r0-http-requests.jsonl"),
    })
    writeHttpModels(sandbox, await resumeProvider.ready)
    const daemon = runBin(r0, ["daemon", "run", "--json"], { timeoutMs: 120_000 })
    writeScript(project, {
      parentSteps: [{ type: "text", text: "R0 parent resumed" }],
      childSteps: [{ type: "text", text: "R0 continuation complete" }],
    })
    const resumedRecord = await observeState(sandbox.root, () => {
      const record = taskRecords(project).find((entry) => entry.task_id === running.task_id)
      return record?.status === "completed" ? record : undefined
    }, {
      trigger: () => {
        resumed = spawnParent(r0, MOCK_ENTRY, "resume after index rollback", {
          capture: true, env, session: join(sandbox.sessionDir, parentSessionName),
        })
      },
      timeoutMs: 180_000,
    })
    await stopParent(resumed)
    resumed = undefined
    const indexAfterGc = JSON.parse(readFileSync(indexPath, "utf8"))
    const userTurnsAfterR0 = readFileSync(transcriptPath, "utf8").split("\n").filter(Boolean)
      .filter((line) => {
        const row = JSON.parse(line)
        return row.type === "message" && row.message?.role === "user"
      }).length
    facts = {
      original_socket: socket,
      parent_quit_while_request_held: interruptedAtExit,
      supervisor_exited: exited === true,
      parked_status: parked?.status ?? null,
      parked_residency: parked?.residency_state ?? null,
      parked_suspension: parked?.suspension_reason ?? null,
      interrupted_transcript_files: interruptedFiles,
      interrupted_transcript_tail: interruptedTail,
      interrupted_fixture: { transcriptPath, keptLines: lastUser + 1 },
      continuation_before_r0: continuationBeforeR0,
      gc_exit: gc.status,
      endpoint_removed: !endpointSockets(sandbox).includes(socket),
      sidecar_removed: !existsSync(socket.replace(/\.sock$/, ".meta.json")),
      store_index_before_gc: Object.keys(indexBeforeGc.stores ?? {}),
      store_index_after_gc: Object.keys(indexAfterGc.stores ?? {}),
      store_retained_in_index: project.stateDir in (indexAfterGc.stores ?? {}),
      rollback_exit: rollback.status,
      migrated_socket: migrated?.host_session?.socket ?? null,
      r0_provision_exit: provisioned.status,
      r0_same_home: r0.home === sandbox.home,
      r0_daemon_exit: daemon.status,
      r0_resume_completed: resumedRecord?.status === "completed",
      continuation_count: userTurnsAfterR0 - userTurnsBeforeR0,
    }
  } catch (caught) {
    error = String(caught?.stack ?? caught)
  } finally {
    initialReleased = true
    initialProvider.close()
    resumeProvider?.close()
    cleanup = await teardownSandbox(sandbox, [parent, resumed].filter(Boolean))
  }
  return finishRow("idle_gc_index_resume", artifacts, facts, cleanup, error, idleGcIndexResumePassed)
}

// `process` pins the host runner; `auto` (the default) first asks the execution-mode gate, which would
// ensure the session's host, so the auto row proves the store is admitted before that ask too.
export async function runStoreIndexRegistrationPrecondition(current, artifacts, executionMode = "process") {
  const rowId = executionMode === "auto" ? "store_index_registration_precondition_auto" : "store_index_registration_precondition"
  const firstScript = taskScript("index-fail", "index failure child", [{ type: "text", text: "must not run" }])
  // The name is part of the agent dir path: a long one pushes the session's shard socket past
  // sun_path into a /tmp/omo-rpc-* fallback root that this row neither records nor removes.
  const sandbox = newSandbox(current, executionMode === "auto" ? "idx-auto" : "idx-proc", {
    omoConfig: taskConfig({ default_execution_mode: executionMode }), script: firstScript,
  })
  const project = mainProject(sandbox, firstScript)
  const rpcDir = join(sandbox.agentDir, "rpc")
  let first
  let retry
  let facts = {}
  let cleanup
  let error
  try {
    mkdirSync(join(rpcDir, "shards"), { recursive: true })
    chmodSync(rpcDir, 0o555)
    const indexPath = join(rpcDir, "task-stores.json")
    const atomicFailure = captureAtomicWriteFailure(rpcDir, indexPath)
    if (!atomicFailure.failed) throw new Error("permission fixture is vacuous: atomic task-store index write succeeded")
    const failed = await observeState(sandbox.root, () => {
      const record = taskRecords(project).find((entry) => entry.name === "index-fail")
      return record?.status === "error" ? record : undefined
    }, { trigger: () => { first = startParent(sandbox, project, "fail before endpoint creation") } })
    await awaitParent(first, 120_000)
    const endpointsBeforeRetry = endpointSockets(sandbox)
    const endpointStateRoot = join(sandbox.agentDir, "rpc-host-daemon")
    const endpointStateBeforeRetry = existsSync(endpointStateRoot)
      ? readdirSync(endpointStateRoot, { recursive: true }).map(String)
      : []
    const indexAbsentAfterFailure = !existsSync(indexPath)
    chmodSync(rpcDir, 0o755)
    const retryScript = taskScript("index-retry", "index retry child", [{ type: "text", text: "index retry complete" }])
    writeScript(project, retryScript)
    const registrationFirst = await observeRegistrationBeforeEndpoint(
      sandbox, indexPath, endpointStateRoot,
      () => { retry = startParent(sandbox, project, "retry after index permissions restore") },
    )
    const opened = await observeState(sandbox.root, () => {
      const record = taskRecords(project).find((entry) => entry.name === "index-retry")
      return typeof record?.host_session?.socket === "string" ? record : undefined
    })
    await awaitParent(retry, 120_000)
    const index = JSON.parse(readFileSync(indexPath, "utf8"))
    const socketStat = statSync(opened.host_session.socket)
    const indexStat = statSync(indexPath)
    facts = {
      atomic_index_write_failure: atomicFailure,
      failure_status: failed?.status ?? null,
      failure_reason: failed?.failure_reason ?? null,
      failure_has_no_host_session: failed?.host_session === undefined,
      endpoints_before_retry: endpointsBeforeRetry,
      endpoint_state_before_retry: endpointStateBeforeRetry,
      index_absent_after_failure: indexAbsentAfterFailure,
      registration_first_observation: registrationFirst,
      index_mtime_ms: indexStat.mtimeMs,
      endpoint_birthtime_ms: socketStat.birthtimeMs,
      retry_status: opened?.status ?? null,
      retry_socket: opened?.host_session?.socket ?? null,
      retry_socket_in_agent_dir: typeof opened?.host_session?.socket === "string" &&
        realpathSync(opened.host_session.socket).startsWith(`${realpathSync(sandbox.agentDir)}/`),
      store_registered_before_open: project.stateDir in (index.stores ?? {}),
    }
  } catch (caught) {
    error = String(caught?.stack ?? caught)
  } finally {
    chmodSync(rpcDir, 0o755)
    cleanup = await teardownSandbox(sandbox, [first, retry].filter(Boolean))
  }
  return finishRow(rowId, artifacts, facts, cleanup, error, storeIndexPreconditionPassed)
}

export async function runIndexLiveMatrix(current, beforeBin, artifacts) {
  mkdirSync(artifacts, { recursive: true })
  return { cross_endpoint_open_hazard: await runCrossEndpointOpenHazard(current, artifacts),
    idle_gc_index_resume: await runIdleGcIndexResume(current, beforeBin, artifacts),
    store_index_registration_precondition: await runStoreIndexRegistrationPrecondition(current, artifacts),
    store_index_registration_precondition_auto: await runStoreIndexRegistrationPrecondition(current, artifacts, "auto") }
}

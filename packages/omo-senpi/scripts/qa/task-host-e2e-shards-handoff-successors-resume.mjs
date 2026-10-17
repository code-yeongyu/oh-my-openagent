import { dirname, join } from "node:path"
import { existsSync, readFileSync, writeFileSync } from "node:fs"

import { observeState, stopParent } from "./task-host-e2e-events.mjs"
import { HostClient } from "./task-host-e2e-shards-rpc.mjs"
import { spawnParent } from "./task-host-e2e-process.mjs"
import { jsonlLines } from "./task-host-e2e-support.mjs"
import {
  startParent,
  taskRecords,
  teardownSandbox,
} from "./task-host-e2e-shard-cost-support.mjs"
import {
  crashRows,
  endpointFacts,
  generationNames,
} from "./task-host-e2e-shards-support.mjs"
import {
  MOCK_ENTRY,
  batchTaskStep,
  createHttpScenario,
  nextSockets,
  privateHostSocket,
  requestSeen,
  scenarioResult,
  sessionFile,
  sessionRow,
  supervisorCount,
  textStep,
  writeParentScript,
} from "./task-host-e2e-shards-handoff-successors-support.mjs"

const RESUME_CHILD = "T14_RESUME_CHILD_TWO"
const RESUME_GRANDCHILD = "T14_RESUME_GRANDCHILD_HOLD"
const READ_NOTICE = "T14_READ_OWN_HOST_NOTICE"

function route(childRelease, grandchildRelease, state) {
  return (request) => {
    if (request.user.includes(READ_NOTICE)) {
      return request.count("task_output") === 0
        ? {
            type: "tool_call",
            name: "task_output",
            arguments: { task_id: state.noticeTaskId, mode: "status" },
          }
        : textStep("notice read")
    }
    if (request.user.includes(RESUME_GRANDCHILD)) {
      return textStep("resume grandchild held", grandchildRelease)
    }
    if (request.user.includes(RESUME_CHILD)) {
      if (request.count("task") === 0) return batchTaskStep([
        { name: "resume-grandchild-0", prompt: RESUME_GRANDCHILD },
        { name: "resume-grandchild-1", prompt: RESUME_GRANDCHILD },
      ])
      return textStep("resume child held", childRelease)
    }
    return textStep("unexpected request")
  }
}

function invariant(sandbox, socket, before) {
  const endpoint = endpointFacts(sandbox).find((row) => row.socket === socket)
  return {
    instance: endpoint?.status?.instanceId ?? null,
    supervisor: endpoint?.supervisor ?? null,
    generations: generationNames(sandbox, socket),
    next_sockets: nextSockets(socket),
    supervisors: supervisorCount(socket),
    crashes: crashRows(sandbox, socket).length,
    unchanged:
      endpoint?.status?.instanceId === before.instance &&
      endpoint?.supervisor === before.supervisor &&
      JSON.stringify(generationNames(sandbox, socket)) === JSON.stringify(before.generations) &&
      nextSockets(socket).length === 0 &&
      supervisorCount(socket) === before.supervisors &&
      crashRows(sandbox, socket).length === before.crashes,
  }
}

export async function runNestedResumeScenario(current, artifacts) {
  const childRelease = join(current.root, `resume-child-${process.pid}`)
  const grandchildRelease = join(current.root, `resume-grandchild-${process.pid}`)
  const state = { noticeTaskId: undefined }
  const scenario = await createHttpScenario(
    current,
    "nested-resume",
    route(childRelease, grandchildRelease, state),
  )
  const { sandbox, project, requestLog } = scenario
  let parent
  let resumed
  let privateClient
  let publicClient
  let stoppedSupervisor
  try {
    writeParentScript(sandbox, [
      { type: "tool_call", name: "task", arguments: {
        category: "proc",
        run_in_background: true,
        name: "resume-child",
        prompt: RESUME_CHILD,
      } },
      { type: "text", text: "resume parent spawned child" },
    ])
    parent = startParent(sandbox, project, "spawn nested resume tree")
    const records = await observeState(sandbox.root, () => {
      const rows = taskRecords(project)
      return rows.length === 3 &&
        rows.every((record) => record.status === "running") &&
        requestSeen(requestLog, RESUME_CHILD) &&
        requestSeen(requestLog, RESUME_GRANDCHILD)
        ? rows
        : undefined
    })
    if (records === undefined) throw new Error("nested resume tree did not reach held text")
    const child = records.find((record) => record.name === "resume-child")
    const grandchild = records.find((record) => record.name === "resume-grandchild-0")
    const socket = child?.host_session?.socket
    if (typeof socket !== "string" || grandchild === undefined) {
      throw new Error("nested resume identities missing")
    }
    state.noticeTaskId = grandchild.task_id
    const endpointBefore = endpointFacts(sandbox).find((row) => row.socket === socket)
    const before = {
      instance: endpointBefore?.status?.instanceId ?? null,
      supervisor: endpointBefore?.supervisor ?? null,
      generations: generationNames(sandbox, socket),
      supervisors: supervisorCount(socket),
      crashes: crashRows(sandbox, socket).length,
    }
    const parentSession = sessionFile(sandbox, child.parent_session_id)
    await stopParent(parent)
    parent = undefined
    writeParentScript(sandbox, [
      { type: "tool_call", name: "task_output", arguments: {
        task_id: child.task_id,
        mode: "status",
      } },
      { type: "text", text: "nested resume observed" },
    ])
    resumed = spawnParent(sandbox, MOCK_ENTRY, "resume nested tree", {
      capture: true,
      session: parentSession,
    })
    await observeState(sandbox.root, () =>
      readFileSync(parentSession, "utf8").includes("nested resume observed") ? true : undefined)
    const normal = invariant(sandbox, socket, before)

    const childRow = sessionRow(
      endpointFacts(sandbox).find((row) => row.socket === socket)?.status,
      child.host_session.session_path,
    )
    const privateSocket = privateHostSocket(endpointBefore)
    stoppedSupervisor = before.supervisor
    process.kill(stoppedSupervisor, "SIGSTOP")
    const stoppedAt = Date.now()
    privateClient = await HostClient.connect(privateSocket, "nested-resume-private")
    const attached = await privateClient.openSession({
      cwd: sandbox.cwd,
      sessionPath: child.host_session.session_path,
      kind: "worker",
      context: childRow?.context ?? {},
      provider: "omo-http",
      modelId: "mock-1",
    })
    await privateClient.request({ type: "close_session", sessionId: attached.routingId })
    const reopened = await privateClient.openSession({
      cwd: sandbox.cwd,
      sessionPath: child.host_session.session_path,
      kind: "worker",
      context: childRow?.context ?? {},
      provider: "omo-http",
      modelId: "mock-1",
    })
    // A SIGSTOPped supervisor still completes connects from its listen backlog, which the lifecycle
    // reads as BUSY, not gone (omo#9069): C1's revival of G1 waits for its own host instead of parking
    // it. Either verdict is acceptable here - parked own_host_unreachable (the pre-#9069 contract) or
    // left untouched and waiting - as long as nothing was ensured, spawned or moved (checked below).
    const deferred = await observeState(sandbox.root, () => {
      const record = taskRecords(project).find((entry) => entry.task_id === grandchild.task_id)
      return record?.suspension_reason === "own_host_unreachable" ? record : undefined
    }, { timeoutMs: 15_000 })
    const deferredAtMs = Date.now() - stoppedAt
    const grandchildAtDeadline = taskRecords(project).find((entry) => entry.task_id === grandchild.task_id) ?? null
    const stopped = invariant(sandbox, socket, before)
    await privateClient.request({
      type: "prompt",
      sessionId: reopened.routingId,
      message: READ_NOTICE,
    })
    const notices = await observeState(dirname(child.host_session.session_path), () => {
      const count = readFileSync(child.host_session.session_path, "utf8")
        .split("host_notice:own_host_unreachable").length - 1
      return count > 0 ? count : undefined
    }, { timeoutMs: 30_000 })
    process.kill(stoppedSupervisor, "SIGCONT")
    stoppedSupervisor = undefined
    publicClient = await HostClient.connect(socket, "nested-resume-public")
    const protocol = await publicClient.request({ type: "get_protocol_info", observe: true })
    await privateClient.request({ type: "close_session", sessionId: reopened.routingId })
    const publicChild = await publicClient.openSession({
      cwd: sandbox.cwd,
      sessionPath: child.host_session.session_path,
      kind: "worker",
      context: childRow?.context ?? {},
      provider: "omo-http",
      modelId: "mock-1",
    })
    const reattached = await observeState(sandbox.root, () => {
      const record = taskRecords(project).find((entry) => entry.task_id === grandchild.task_id)
      return record?.residency_state === "resident" &&
        record.suspension_reason !== "own_host_unreachable"
        ? record
        : undefined
    }, { timeoutMs: 30_000 })
    const recovered = invariant(sandbox, socket, before)
    const facts = {
      socket,
      normal_resume: normal,
      private_socket: privateSocket,
      deferred_reason: deferred?.suspension_reason ?? null,
      deferred_after_stop_ms: deferredAtMs,
      stalled_own_host_verdict: deferred === undefined ? "busy_wait" : "parked_own_host_unreachable",
      grandchild_during_stall: grandchildAtDeadline === null ? null : {
        status: grandchildAtDeadline.status,
        residency_state: grandchildAtDeadline.residency_state,
        suspension_reason: grandchildAtDeadline.suspension_reason ?? null,
        socket: grandchildAtDeadline.host_session?.socket ?? null,
      },
      grandchild_log_tail: jsonlLines(join(project.stateDir, "logs", `${grandchild.task_id}.jsonl`)).slice(-6),
      notice_count: notices ?? 0,
      stopped_invariants: stopped,
      resumed_instance: protocol.data?.instanceId ?? null,
      reattached: reattached !== undefined,
      recovered_invariants: recovered,
      child_routing_id: publicChild.routingId,
    }
    return scenarioResult(
      normal.unchanged &&
        (deferred !== undefined
          ? notices === 1
          : grandchildAtDeadline?.status === "running" &&
            grandchildAtDeadline.host_session?.socket === socket &&
            (notices ?? 0) === 0) &&
        stopped.unchanged &&
        protocol.data?.instanceId === before.instance &&
        reattached !== undefined &&
        recovered.unchanged,
      join(artifacts, "nested-resume-attach-only.json"),
      facts,
      "nested resume unavailable-own-endpoint phase failed attach-only invariants",
    )
  } finally {
    if (stoppedSupervisor !== undefined) process.kill(stoppedSupervisor, "SIGCONT")
    if (existsSync(current.root)) {
      writeFileSync(childRelease, "go\n")
      writeFileSync(grandchildRelease, "go\n")
    }
    privateClient?.close()
    publicClient?.close()
    await stopParent(parent)
    await stopParent(resumed)
    scenario.close()
    const cleanup = await teardownSandbox(sandbox, [parent, resumed].filter(Boolean))
    writeFileSync(join(artifacts, "nested-resume-attach-only-cleanup.json"), `${JSON.stringify(cleanup, null, 2)}\n`)
  }
}

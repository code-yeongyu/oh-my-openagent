import { existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { observeState, stopParent } from "./task-host-e2e-events.mjs"
import { waitFor } from "./task-host-e2e-process.mjs"
import { childSessionFiles, jsonlLines } from "./task-host-e2e-support.mjs"
import {
  hostStatus,
  processTable,
  supervisorPid,
  taskRecords,
  treePids,
} from "./task-host-e2e-shard-cost-support.mjs"
import { crashRows } from "./task-host-e2e-shards-support.mjs"
import {
  childTurnFacts,
  cleanupScenario,
  createRetainScenario,
  heldText,
  IDLE_MS,
  lifecycleContinuations,
  parentSessionPath,
  readStep,
  replaceParentServer,
  requestCount,
  result,
  startParent,
  taskOutputStep,
  taskStep,
  terminal,
  textStep,
} from "./task-host-e2e-shards-retain-live-support.mjs"

async function runRetainResume(current, artifacts, midturn) {
  const id = midturn ? "retain-midturn-continuation" : "retain-idle-resume"
  const childPrompt = `${id} original child prompt`
  const release = join(current.root, `${id}-${process.pid}.release`)
  const parentRelease = join(current.root, `${id}-${process.pid}.parent-release`)
  const resumeRelease = join(current.root, `${id}-${process.pid}.resume-release`)
  const scenario = await createRetainScenario(current, id, {
    task: { host_idle_exit_ms: midturn ? 900_000 : IDLE_MS },
    parentSteps: [
      taskStep("retained", childPrompt),
      heldText(`${id} initial parent complete`, parentRelease),
    ],
    // Mid-turn needs a persisted turn prefix: senpi writes a session file only once an assistant
    // message exists, so a child killed inside its FIRST provider request leaves no transcript to
    // reopen. The read call lands user + assistant + toolResult on disk before the held request.
    childSteps: [
      ...(midturn ? [readStep(".omo/omo.json")] : []),
      heldText(`${id} original turn complete`, release),
      textStep(`${id} continuation complete`),
    ],
  })
  const { sandbox, project } = scenario
  const env = { SENPI_RPC_SESSION_IDLE_EVICTION_MS: String(IDLE_MS) }
  let parent
  let resumed
  try {
    parent = startParent(scenario, `start ${id}`, undefined, env)
    const running = await observeState(sandbox.root, () => {
      const record = taskRecords(project).find((entry) => entry.name === "retained")
      return record?.status === "running" && record.host_session?.socket ? record : undefined
    })
    if (running === undefined) throw new Error(`${id}: child never reached running`)
    const socket = running.host_session.socket
    const before = await waitFor(() => {
      const supervisor = supervisorPid(sandbox, socket)
      if (supervisor === undefined) return undefined
      const table = processTable()
      const host = treePids(supervisor, table).find((pid) =>
        table.get(pid)?.args.includes("--mode rpc"))
      return host === undefined
        ? undefined
        : { supervisor, host, status: hostStatus(sandbox, socket).json }
    }, { timeoutMs: 60_000, intervalMs: 250 })
    if (before === undefined) throw new Error(`${id}: host child missing`)
    const sessionPath = parentSessionPath(sandbox, running.parent_session_id)
    if (midturn) {
      // Quit the parent FIRST so the child is retained mid-turn with nobody left to re-ensure the
      // shard: a live parent answers the crash by starting a new generation at once, which is the
      // crash row's reattach path, not this retain/resume row.
      const heldMidTurn = await observeState(sandbox.root, () =>
        requestCount(scenario.childLog) >= 2 &&
          childSessionFiles(sandbox, running.task_id).flatMap(jsonlLines)
            .some((line) => line.includes('"role":"toolResult"'))
          ? true
          : undefined)
      if (heldMidTurn !== true) throw new Error(`${id}: child never reached its held request after a persisted tool result`)
      writeFileSync(parentRelease, "go\n")
      await stopParent(parent)
      parent = undefined
      const retained = taskRecords(project).find((entry) => entry.task_id === running.task_id)
      if (!["running", "interrupted"].includes(retained?.status)) throw new Error(`${id}: child was not retained mid-turn after the parent quit`)
      const crashed = await observeState(sandbox.root, () => {
        const rows = crashRows(sandbox, socket)
        return rows.length > 0 ? rows : undefined
      }, {
        trigger: () => {
          process.kill(before.host, "SIGSEGV")
        },
      })
      if (crashed === undefined) throw new Error(`${id}: host crash was not recorded`)
      writeFileSync(release, "go\n")
      const gone = await observeState(sandbox.root, () =>
        supervisorPid(sandbox, socket) === undefined && !existsSync(socket) ? true : undefined)
      if (gone !== true) throw new Error(`${id}: crashed shard did not become unreachable`)
    } else {
      writeFileSync(release, "go\n")
      const completed = await observeState(sandbox.root, () => {
        const record = taskRecords(project).find((entry) => entry.task_id === running.task_id)
        return record?.status === "completed" ? record : undefined
      })
      if (completed === undefined) throw new Error(`${id}: child did not settle`)
      writeFileSync(parentRelease, "go\n")
      await stopParent(parent)
      parent = undefined
      const exited = await observeState(sandbox.root, () =>
        supervisorPid(sandbox, socket) === undefined && !existsSync(socket) ? true : undefined)
      if (exited !== true) throw new Error(`${id}: idle host did not exit`)
    }
    await replaceParentServer(scenario, [
      taskOutputStep(running.task_id),
      heldText(`${id} resumed parent complete`, resumeRelease),
    ])

    resumed = startParent(scenario, `resume ${id}`, sessionPath, env)
    const settled = await observeState(sandbox.root, () => {
      const record = taskRecords(project).find((entry) => entry.task_id === running.task_id)
      return terminal(record) ? record : undefined
    })
    if (settled === undefined) {
      const record = taskRecords(project).find((entry) => entry.task_id === running.task_id)
      throw new Error(`${id}: retained child did not settle; record=${JSON.stringify(record)}; ` +
        `crashes=${JSON.stringify(crashRows(sandbox, socket))}; child_requests=${requestCount(scenario.childLog)}; ` +
        `parent_stderr=${resumed.chunks.stderr.slice(-2000)}`)
    }
    writeFileSync(resumeRelease, "go\n")
    await stopParent(resumed)
    resumed = undefined
    const after = {
      supervisor: supervisorPid(sandbox, socket),
      status: hostStatus(sandbox, socket).json,
    }
    const turns = childTurnFacts(sandbox, running.task_id, childPrompt)
    const facts = {
      socket,
      resumed_socket: settled.host_session?.socket ?? null,
      fresh_generation: before?.supervisor !== after?.supervisor,
      final_status: settled.status,
      child_http_requests: requestCount(scenario.childLog),
      replay_count: turns.prompt_count - 1,
      continuation_count: lifecycleContinuations(sandbox, running.task_id),
      ...turns,
    }
    const expectedTurns = midturn ? 2 : 1
    // read call + held request + continuation for mid-turn; the one text request otherwise.
    const expectedRequests = midturn ? 3 : 1
    const ok = facts.resumed_socket === socket &&
      facts.fresh_generation &&
      facts.final_status === "completed" &&
      facts.prompt_count === 1 &&
      facts.replay_count === 0 &&
      facts.child_http_requests === expectedRequests &&
      facts.machine_user_turns === expectedTurns &&
      facts.continuation_count === (midturn ? 1 : 0) &&
      facts.child_session_files.length === 1
    return result(
      ok,
      join(artifacts, `${id}.json`),
      facts,
      `${id} retained-session invariants failed`,
    )
  } finally {
    writeFileSync(release, "go\n")
    writeFileSync(parentRelease, "go\n")
    writeFileSync(resumeRelease, "go\n")
    await cleanupScenario(
      scenario,
      [parent, resumed],
      join(artifacts, `${id}-cleanup.json`),
    )
  }
}

export const runRetainIdleResume = (current, artifacts) =>
  runRetainResume(current, artifacts, false)

export const runRetainMidturnContinuation = (current, artifacts) =>
  runRetainResume(current, artifacts, true)

import { writeFileSync } from "node:fs"
import { join } from "node:path"

import { observeState, stopParent } from "./task-host-e2e-events.mjs"
import { runBin } from "./task-host-e2e-process.mjs"
import {
  endpointSockets,
  hostStatus,
  statusAll,
  stopEndpoint,
  taskRecords,
} from "./task-host-e2e-shard-cost-support.mjs"
import { HostClient } from "./task-host-e2e-shards-rpc.mjs"
import {
  childTurnFacts,
  cleanupScenario,
  createRetainScenario,
  heldText,
  lifecycleContinuations,
  parentSessionPath,
  replaceParentServer,
  requestCount,
  result,
  rewriteRecordedSocket,
  startParent,
  taskOutputStep,
  taskStep,
  terminal,
  textStep,
  transcriptSettled,
} from "./task-host-e2e-shards-retain-live-support.mjs"

export async function runRecordedSocketMigration(current, artifacts) {
  const oldPrompt = "pre-migration retained child"
  const nextPrompt = "post-migration new child"
  const release = join(current.root, `migration-${process.pid}.release`)
  const scenario = await createRetainScenario(current, "migration-recorded-socket", {
    parentSteps: [
      taskStep("migrated", oldPrompt),
      textStep("migration initial parent done"),
    ],
    childSteps: [
      heldText("pre-migration child complete", release),
      textStep("post-migration child complete"),
    ],
  })
  const { sandbox, project } = scenario
  let parent
  let resumed
  let legacyClient
  try {
    parent = startParent(scenario, "start migration fixture")
    const running = await observeState(sandbox.root, () => {
      const record = taskRecords(project).find((entry) => entry.name === "migrated")
      return record?.status === "running" && record.host_session?.socket ? record : undefined
    })
    if (running === undefined) throw new Error("migration child never reached running")
    const shard = running.host_session.socket
    const childSession = running.host_session.session_path
    const parentSession = parentSessionPath(sandbox, running.parent_session_id)
    await stopParent(parent)
    parent = undefined
    writeFileSync(release, "go\n")
    const settledInHost = await observeState(sandbox.root, () =>
      transcriptSettled(sandbox, running.task_id, /pre-migration child complete/) ? true : undefined)
    if (settledInHost !== true) throw new Error("migration child did not finish its turn inside the host")
    const retainedRecord = taskRecords(project).find((entry) => entry.task_id === running.task_id)
    if (terminal(retainedRecord)) throw new Error("migration fixture is vacuous: the record settled without a parent")
    await stopEndpoint(sandbox, shard)

    const legacy = join(sandbox.agentDir, "rpc", "rpc.sock")
    const ensured = runBin(sandbox, [
      "host", "ensure",
      "--socket", legacy,
      "--launch-spec", current.specPath,
      "--policy", "never",
      "--json",
    ])
    if (ensured.status !== 0) {
      throw new Error(`legacy host ensure failed: ${ensured.stderr || ensured.stdout}`)
    }
    const legacyStatus = hostStatus(sandbox, legacy).json
    legacyClient = await HostClient.connect(legacy, "migration-legacy")
    await legacyClient.openSession({
      sessionPath: childSession,
      cwd: sandbox.cwd,
      provider: "omo-child",
      modelId: "mock-1",
      kind: "worker",
      context: { role: "child", task_id: running.task_id },
      retain_on_disconnect: true,
      auto_title: false,
    })
    legacyClient.close()
    legacyClient = undefined
    rewriteRecordedSocket(project, running.task_id, legacy, legacyStatus?.instanceId)

    await replaceParentServer(scenario, [
      taskOutputStep(running.task_id),
      taskStep("next", nextPrompt),
      textStep("migration resumed parent done"),
    ])
    resumed = startParent(scenario, "resume migration fixture", parentSession)
    const records = await observeState(sandbox.root, () => {
      const rows = taskRecords(project)
      const old = rows.find((entry) => entry.task_id === running.task_id)
      const next = rows.find((entry) => entry.name === "next")
      return old?.host_session?.socket === legacy &&
        old.status === "completed" &&
        next?.host_session?.socket &&
        next.host_session.socket !== legacy
        ? { old, next }
        : undefined
    })
    if (records === undefined) {
      throw new Error("recorded socket did not win or next child did not shard")
    }
    const legacyRows = statusAll(sandbox).endpoints
      .find((entry) => entry.socket === legacy)?.session_rows ?? []
    const turns = childTurnFacts(sandbox, running.task_id, oldPrompt)
    const facts = {
      legacy,
      original_shard: shard,
      old_task_socket: records.old.host_session.socket,
      old_status_before_resume: retainedRecord?.status ?? null,
      old_status_after_resume: records.old.status,
      next_task_socket: records.next.host_session.socket,
      legacy_lists_old_session: legacyRows.some((row) =>
        row.sessionPath === childSession || row.session_path === childSession),
      old_child_http_requests: requestCount(scenario.childLog) - 1,
      old_continuation_count: lifecycleContinuations(sandbox, running.task_id),
      endpoints: endpointSockets(sandbox),
      ...turns,
    }
    const ok = facts.old_task_socket === legacy &&
      /\/p-[0-9a-f]{16}\.sock$/.test(facts.next_task_socket) &&
      facts.legacy_lists_old_session &&
      facts.prompt_count === 1 &&
      facts.machine_user_turns === 1 &&
      facts.old_continuation_count === 0
    return result(
      ok,
      join(artifacts, "migration-recorded-socket-wins.json"),
      facts,
      "recorded socket migration invariants failed",
    )
  } finally {
    legacyClient?.close()
    writeFileSync(release, "go\n")
    await cleanupScenario(
      scenario,
      [parent, resumed],
      join(artifacts, "migration-recorded-socket-wins-cleanup.json"),
    )
  }
}

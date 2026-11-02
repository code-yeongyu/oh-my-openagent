import { createServer } from "node:net"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { observeState, stopParent } from "./task-host-e2e-events.mjs"
import {
  endpointSockets,
  stopEndpoint,
  taskRecords,
} from "./task-host-e2e-shard-cost-support.mjs"
import { HostClient } from "./task-host-e2e-shards-rpc.mjs"
import { childSessionFiles, jsonlLines } from "./task-host-e2e-support.mjs"
import {
  childTurnFacts,
  cleanupScenario,
  createRetainScenario,
  heldText,
  noticeCount,
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

function startIncompatibleFixture(socketPath) {
  const commands = []
  rmSync(socketPath, { force: true })
  mkdirSync(dirname(socketPath), { recursive: true })
  const server = createServer((socket) => {
    let buffer = ""
    socket.setEncoding("utf8")
    socket.on("data", (chunk) => {
      buffer += chunk
      for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
        const request = JSON.parse(buffer.slice(0, newline))
        buffer = buffer.slice(newline + 1)
        commands.push(request)
        const data = {
          protocolVersion: 0,
          serverVersion: "0.0.0-incompatible",
          instanceId: "todo14-incompatible",
          generation: 1,
          engineVersion: "0.0.0-incompatible",
          engineOrdinal: [0, 0, 0, 0, 0],
          capabilities: ["multi_session"],
          launch_profile: { profile_id: "todo14-incompatible" },
        }
        socket.write(`${JSON.stringify({
          type: "response",
          id: request.id,
          command: request.type,
          success: true,
          data,
        })}\n`)
      }
    })
  })
  server.listen(socketPath)
  return {
    commands,
    ready: new Promise((resolve, reject) => {
      server.once("listening", resolve)
      server.once("error", reject)
    }),
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

async function retainedChildren(current, name, count) {
  const release = join(current.root, `${name}-${process.pid}.release`)
  const prompts = Array.from({ length: count }, (_, index) => `${name} child ${index}`)
  const parentSteps = [
    ...prompts.map((prompt, index) => taskStep(`${name}-${index}`, prompt)),
    textStep(`${name} initial parent done`),
  ]
  const childSteps = prompts.map((_, index) =>
    heldText(`${name} child ${index} complete`, release))
  const scenario = await createRetainScenario(current, name, { parentSteps, childSteps })
  let parent = startParent(scenario, `start ${name}`)
  const records = await observeState(scenario.sandbox.root, () => {
    const rows = taskRecords(scenario.project)
    return rows.length === count &&
      rows.every((record) => record.status === "running" && record.host_session?.socket)
      ? rows
      : undefined
  })
  if (records === undefined) throw new Error(`${name}: children never reached running`)
  const parentSession = parentSessionPath(scenario.sandbox, records[0].parent_session_id)
  await stopParent(parent)
  parent = undefined
  writeFileSync(release, "go\n")
  const turnDone = new RegExp(`${name} child \\d+ complete`)
  const settled = await observeState(scenario.sandbox.root, () =>
    records.every((record) => transcriptSettled(scenario.sandbox, record.task_id, turnDone)) ? true : undefined)
  if (settled !== true) throw new Error(`${name}: children did not finish their turns inside the host`)
  const retainedRecords = taskRecords(scenario.project)
  if (retainedRecords.some(terminal)) throw new Error(`${name}: fixture is vacuous: a record settled without a parent`)
  return { scenario, records: retainedRecords, prompts, parentSession, release, parent }
}

async function incompatibilityFacts(current, artifacts) {
  const retained = await retainedChildren(current, "incompatibility", 1)
  const { scenario, records, parentSession, release } = retained
  const resumeRelease = join(current.root, `incompatibility-${process.pid}.resume-release`)
  const noticeRelease = join(current.root, `incompatibility-${process.pid}.notice-release`)
  let resumed
  let fixture
  try {
    const record = records[0]
    await stopEndpoint(scenario.sandbox, record.host_session.socket)
    const socket = join(scenario.sandbox.agentDir, "rpc", "incompatible.sock")
    fixture = startIncompatibleFixture(socket)
    await fixture.ready
    rewriteRecordedSocket(scenario.project, record.task_id, socket, "todo14-incompatible")
    // Print mode exits as soon as its turn ends; hold the last step so the resumed parent is still
    // alive while its reconcile runs, and release it only after the verdict is observed.
    // task_output renders the session's host notices; read it only after the park landed, or the
    // resumed parent reads its notice list before the reconcile has written anything to it.
    await replaceParentServer(scenario, [
      { ...taskOutputStep(record.task_id), releaseWhen: () => existsSync(noticeRelease), releaseTimeoutMs: 600_000 },
      heldText("incompatibility observed", resumeRelease),
    ])
    resumed = startParent(scenario, "resume incompatible retained child", parentSession)
    const parked = await observeState(scenario.sandbox.root, () => {
      const row = taskRecords(scenario.project).find((entry) => entry.task_id === record.task_id)
      return row?.suspension_reason === "host_incompatible" ? row : undefined
    })
    const notices = await observeState(dirname(parentSession), () => {
      const count = noticeCount(parentSession, "host_unavailable:host_incompatible")
      return count > 0 ? count : undefined
    }, { trigger: () => writeFileSync(noticeRelease, "go\n"), timeoutMs: 120_000 })
    const facts = {
      socket,
      parked_status: parked?.status ?? null,
      parked_residency: parked?.residency_state ?? null,
      parked_reason: parked?.suspension_reason ?? null,
      commands: fixture.commands.map((command) => command.type),
      open_session_count: fixture.commands
        .filter((command) => command.type === "open_session").length,
      notice_count: notices ?? 0,
      other_endpoints: endpointSockets(scenario.sandbox),
    }
    return {
      facts,
      ok: facts.parked_reason === "host_incompatible" &&
        facts.open_session_count === 0 &&
        facts.notice_count === 1 &&
        facts.other_endpoints.length === 0,
    }
  } finally {
    writeFileSync(noticeRelease, "go\n")
    writeFileSync(resumeRelease, "go\n")
    await stopParent(resumed)
    await fixture?.close()
    writeFileSync(release, "go\n")
    await cleanupScenario(
      scenario,
      [resumed],
      join(artifacts, "incompatibility-cleanup.json"),
    )
  }
}

async function isolationFacts(current, artifacts) {
  const retained = await retainedChildren(current, "entry-isolation", 2)
  const { scenario, records, prompts, parentSession, release } = retained
  const resumeRelease = join(current.root, `entry-isolation-${process.pid}.resume-release`)
  let resumed
  let client
  try {
    const [deleted, good] = records
    const socket = good.host_session.socket
    const originalSameHost = deleted.host_session.socket === socket
    // A host that still holds both sessions live re-attaches them from memory and never reads a
    // transcript, so deleting one proves nothing. Stop B's endpoint first: the resume must re-ensure
    // the shard and REOPEN each child from its JSONL, where the deleted one is a real per-entry fault.
    const stoppedEndpoint = await stopEndpoint(scenario.sandbox, socket)
    const deletedDir = dirname(deleted.host_session.session_path)
    rmSync(deletedDir, { recursive: true, force: true })
    await replaceParentServer(scenario, [
      taskOutputStep(deleted.task_id),
      taskOutputStep(good.task_id),
      heldText("entry isolation observed", resumeRelease),
    ])
    resumed = startParent(scenario, "resume after deleting one transcript", parentSession)
    const observed = await observeState(scenario.sandbox.root, () => {
      const rows = taskRecords(scenario.project)
      const bad = rows.find((entry) => entry.task_id === deleted.task_id)
      const kept = rows.find((entry) => entry.task_id === good.task_id)
      const isolated = ["lost", "error"].includes(bad?.status) ||
        bad?.residency_state === "rpc_detached" ||
        /missing|ENOENT|transcript|session/i.test(
          `${bad?.error_message ?? ""} ${bad?.suspension_reason ?? ""}`,
        )
      return isolated && kept?.status === "completed" && kept.host_session?.socket === socket
        ? { bad, kept }
        : undefined
    })
    // The re-ensured shard still answers list_sessions after one of its entries failed to open.
    client = await HostClient.connect(socket, "entry-isolation")
    const listed = await client.request({ type: "list_sessions", include_workers: true })
    client.close()
    client = undefined
    const listedPaths = (listed.data?.sessions ?? []).map((row) => row.sessionPath ?? row.session_path)
    const turns = childTurnFacts(scenario.sandbox, good.task_id, prompts[1])
    const facts = {
      socket,
      original_same_host: originalSameHost,
      stopped_endpoint_before_resume: stoppedEndpoint,
      deleted_session_dir: deletedDir,
      list_sessions_answered: Array.isArray(listed.data?.sessions),
      listed_session_paths: listedPaths,
      good_session_listed: listedPaths.includes(good.host_session.session_path),
      deleted_task: observed?.bad ?? null,
      good_task: observed?.kept ?? null,
      // Observed, not gated: the engine recreates the deleted directory for its holder record and runs
      // one turn in the fresh empty session before the client disposes it (a senpi engine defect
      // reported separately); the child's RECORD is what this row judges.
      deleted_message_rows: jsonlLines(deleted.host_session.session_path)
        .filter((line) => line.includes('"type":"message"')).length,
      child_http_requests: requestCount(scenario.childLog),
      deleted_path_messages: jsonlLines(deleted.host_session.session_path)
        .filter((line) => line.includes('"type":"message"'))
        .map((line) => JSON.stringify(JSON.parse(line).message).slice(0, 400)),
      good_transcript_present: childSessionFiles(scenario.sandbox, good.task_id)
        .includes(good.host_session.session_path),
      ...turns,
    }
    return {
      facts,
      ok: facts.list_sessions_answered &&
        facts.good_session_listed &&
        facts.stopped_endpoint_before_resume.stillAlive.length === 0 &&
        facts.original_same_host &&
        facts.deleted_task?.status === "lost" &&
        /transcript is missing/.test(facts.deleted_task?.error_message ?? "") &&
        facts.good_transcript_present &&
        facts.good_task?.host_session?.socket === socket &&
        facts.prompt_count === 1 &&
        facts.machine_user_turns === 1 &&
        facts.child_session_files.length === 1,
    }
  } finally {
    client?.close()
    writeFileSync(resumeRelease, "go\n")
    await stopParent(resumed)
    writeFileSync(release, "go\n")
    await cleanupScenario(
      scenario,
      [resumed],
      join(artifacts, "entry-isolation-cleanup.json"),
    )
  }
}

export async function runIncompatibilityAndEntryIsolation(current, artifacts) {
  const incompatibility = await incompatibilityFacts(current, artifacts)
  const entryIsolation = await isolationFacts(current, artifacts)
  const facts = {
    incompatibility: incompatibility.facts,
    entry_isolation: entryIsolation.facts,
  }
  return result(
    incompatibility.ok && entryIsolation.ok,
    join(artifacts, "incompatibility-entry-isolation.json"),
    facts,
    "incompatibility or per-entry isolation invariants failed",
    [
      join(artifacts, "incompatibility-cleanup.json"),
      join(artifacts, "entry-isolation-cleanup.json"),
    ],
  )
}

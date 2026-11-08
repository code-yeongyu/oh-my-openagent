// Team + parking scenarios for task-host-e2e.mjs (todo 41): C proves a team member is a daemon session
// whose identity travels in the session context and whose lead mail is delivered, C2 proves a completed
// child is PARKED rather than closed and that `task_send` reopens it.
import { join } from "node:path"
import { readdirSync, writeFileSync } from "node:fs"
import { teamPass, reopenPass } from "./task-host-e2e-gates.mjs"
import { STATE_DEADLINE_MS, observeState, stopParent } from "./task-host-e2e-events.mjs"

import { createScenarioSandbox, writeMockScript, writeOmoConfig } from "./task-host-e2e-sandbox.mjs"
import {
  cleanupScenario,
  daemonStatus,
  perChildRpcProcesses,
  readTaskRecords,
  runBin,
  spawnParent,
  waitFor,
} from "./task-host-e2e-process.mjs"
import {
  CHILD_BUSY,
  CHILD_DONE,
  CHILD_PROMPT,
  childSessionFiles,
  childStartDiagnosis,
  childrenSettled,
  failureTokens,
  hostConfig,
  jsonlLines,
  recordFailureTokens,
  spawnScript,
  transcriptSizes,
  toolDetails,
} from "./task-host-e2e-support.mjs"

const TEAM_MAIL = "LEAD2MEMBER daemon mail delivered"

export async function scenarioC(run) {
  const config = hostConfig()
  config.categories.quick = { description: "Team member mock category.", model: "omo-mock/mock-1" }
  const sandbox = createScenarioSandbox(run, "sC", {
    omoConfig: config,
    script: {
      parentSteps: [
        {
          type: "tool_call",
          name: "team_create",
          arguments: {
            inline_spec: {
              name: "hostteam",
              members: [{ name: "quick", kind: "category", category: "quick", prompt: "You are team member 'quick'. Acknowledge and wait." }],
            },
          },
        },
        { type: "tool_call", name: "task_send", arguments: { to: "quick", message: TEAM_MAIL } },
        { type: "tool_call", name: "task_list", arguments: {} },
        { type: "text", text: "team scenario complete" },
      ],
      childSteps: CHILD_BUSY,
    },
  })
  let parent
  let facts = { memberRecords: 0, mailDelivered: false, memberSessionContexts: [] }
  await observeState(sandbox.root, async () => {
    const members = readTaskRecords(sandbox).filter((record) => record.team_member_name === "quick")
    const sent = toolDetails(parent.chunks.stdout, "task_send").find((d) =>
      d.kind === "team_message" && d.team?.kind === "to_members" && d.team.recipients.includes("quick"))
    const context = members.length ? await run.probeSessionContext(join(sandbox.agentDir, "rpc", "rpc.sock")) : { rows: [] }
    const memberContext = context.rows?.filter((row) => row.context?.role === "member") ?? []
    const mailDelivered = !!sent && members.some((record) =>
      childSessionFiles(sandbox, record.task_id).some((file) => jsonlLines(file).some((line) =>
        line.includes("<peer_message") && line.includes(sent.team.message_id) && line.includes(TEAM_MAIL))))
    facts = {
      memberRecords: members.length,
      memberStatuses: members.map((record) => record.status),
      mailDelivered,
      messageId: sent?.team.message_id ?? null,
      sessionContextProbe: context.probe,
      memberSessionContexts: memberContext.map((row) => row.context),
      memberContextMatches: members.length > 0 && members.every((record) => memberContext.some((row) =>
        row.context.task_id === record.task_id && row.context.team_run_id === record.team_run_id &&
        row.context.member_name === record.team_member_name)),
      failedMembers: members.filter((r) => ["error", "lost", "cancelled"].includes(r.status)).length,
      perChildRpcProcessCount: perChildRpcProcesses(sandbox).length,
      childStart: childStartDiagnosis(sandbox, readTaskRecords(sandbox)),
    }
    return teamPass(facts) || facts.failedMembers > 0 ? facts : undefined
  }, { trigger: () => { parent = spawnParent(sandbox, run.mockEntry, "create a team whose members live in the daemon", { capture: true }) } })
  const pass = teamPass(facts)
  await stopParent(parent)
  const status = daemonStatus(sandbox, { includeWorkers: true })
  const receipt = await cleanupScenario(sandbox, { hostPids: [status.json?.pid].filter(Boolean) })
  return {
    scenario: "C",
    title: "team members via daemon (identity from sessionContext, lead->member mail)",
    status: pass ? "pass" : "fail",
    reason: `members=${facts.memberRecords} mail=${facts.mailDelivered} memberContexts=${facts.memberSessionContexts.length} matched=${facts.memberContextMatches} probe=${facts.sessionContextProbe}`,
    facts,
    receipt,
  }
}

const IDLE_EVICTION_MS = 15_000

export async function scenarioC2(run) {
  // The launch spec raises an inherited eviction window to the host's idle-exit window, so parking at
  // 15s needs BOTH the env var and `task.host_idle_exit_ms`, or the window silently becomes 15 minutes.
  const config = hostConfig({ task: { host_idle_exit_ms: IDLE_EVICTION_MS } })
  const sandbox = createScenarioSandbox(run, "sC2", {
    omoConfig: config,
    script: {
      parentSteps: [
        { type: "tool_call", name: "task", arguments: { category: "proc", run_in_background: true, name: "done", prompt: CHILD_PROMPT } },
        { type: "text", text: "parked child scenario complete" },
      ],
      childSteps: [{
        type: "tool_call", name: "eval", arguments: {
          language: "js", summary: "hold the worker until its residency is observed",
          code: `var fs = await import("node:fs"); await new Promise((resolve, reject) => {
            var finish = () => { if (!fs.existsSync(".omo/park-release")) return;
              clearTimeout(timer); watcher.close(); resolve(); };
            var watcher = fs.watch(".omo", finish);
            var timer = setTimeout(() => { watcher.close(); reject(new Error("park release missing")); }, 600000);
            finish();
          });`,
        },
      }, ...CHILD_DONE],
    },
  })
  const env = { SENPI_RPC_SESSION_IDLE_EVICTION_MS: String(IDLE_EVICTION_MS) }
  let first
  const before = await observeState(sandbox.root, () => {
    const record = readTaskRecords(sandbox).find((record) => record.name === "done")
    if (!record || record.status !== "running") return undefined
    const status = daemonStatus(sandbox, { includeWorkers: true })
    return status.json?.sessions?.worker >= 1 ? status : undefined
  }, { trigger: () => { first = spawnParent(sandbox, run.mockEntry, "spawn one child and let it finish", { env, capture: true }) } })
  const completed = await observeState(sandbox.root, () => {
    const record = readTaskRecords(sandbox).find((record) => record.name === "done")
    return record && childrenSettled([record], 1) ? record : undefined
  }, { trigger: () => writeFileSync(join(sandbox.cwd, ".omo", "park-release"), "release\n") })
  const firstExit = first.child.exitCode
  await stopParent(first)
  // A park is only observable when there WAS a live worker session to park: with no worker, a zero
  // count is the starting state, not the eviction under test.
  const hadWorker = (before?.json?.sessions?.worker ?? 0) >= 1
  const parked = !hadWorker ? undefined : await waitFor(() => {
    const probe = daemonStatus(sandbox, { includeWorkers: true })
    return probe.json?.instanceId === before.json?.instanceId && probe.json.sessions.worker === 0 ? probe : undefined
  }, { timeoutMs: 90_000, intervalMs: 2_000 })
  const linesBefore = completed === undefined ? 0 : transcriptSizes(sandbox, [completed])[completed.task_id]
  const filesBefore = completed === undefined ? [] : childSessionFiles(sandbox, completed.task_id)
  const epochBefore = completed?.notification?.run_epoch
  const reopenMessage = "reopen the parked session"
  const reopenReply = "parked child resumed successfully"
  writeMockScript(sandbox, {
    parentSteps: [
      { type: "tool_call", name: "task_send", arguments: { to: "done", message: reopenMessage, all_scope: true } },
      { type: "text", text: "reopen complete" },
    ],
    childSteps: [{ type: "text", text: reopenReply }],
  })
  let reopen
  let reopened
  const reopenResults = () => readdirSync(sandbox.sessionDir).filter((file) => file.endsWith(".jsonl"))
    .flatMap((file) => jsonlLines(join(sandbox.sessionDir, file)))
    .map((line) => JSON.parse(line).message)
    .filter((message) => message?.role === "toolResult" && message.toolName === "task_send" && message.details)
    .map((message) => message.details)
  const progress = await observeState(sandbox.root, () => {
    reopened = readTaskRecords(sandbox).find((record) => record.task_id === completed?.task_id)
    const rows = filesBefore.flatMap(jsonlLines).slice(linesBefore).map((line) => JSON.parse(line))
    const messageIndex = rows.findIndex((row) => row.message?.role === "user" &&
      JSON.stringify(row.message.content).includes(reopenMessage))
    const answered = messageIndex >= 0 && rows.slice(messageIndex + 1).some((row) =>
      row.message?.role === "assistant" && row.message.content?.some((part) => part.type === "text" && part.text === reopenReply))
    const outcomes = reopenResults()
    if (outcomes.some((d) => d.kind !== "revived")) {
      return { messageIndex, answered: false }
    }
    const accepted = outcomes.some((d) =>
      d.kind === "revived" && d.task_id === completed?.task_id && d.run_epoch === epochBefore + 1)
    return accepted && reopened?.notification?.run_epoch === epochBefore + 1 &&
      reopened.status === "completed" && answered ? { messageIndex, answered } : undefined
  }, { trigger: () => { reopen = spawnParent(sandbox, run.mockEntry, "reopen the parked child", { env, capture: true }) } })
  const accepted = reopenResults().some((d) =>
    d.kind === "revived" && d.task_id === completed?.task_id && d.run_epoch === epochBefore + 1)
  const linesAfter = completed === undefined ? 0 : transcriptSizes(sandbox, [completed])[completed.task_id]
  const facts = {
    firstRunExit: firstExit,
    childCompleted: completed?.status ?? null,
    workerSessionsBeforePark: before?.json?.sessions?.worker ?? null,
    retainedBeforePark: before?.json?.sessions?.retained ?? null,
    hadWorkerSessionBeforePark: hadWorker,
    parkObserved: hadWorker && parked !== undefined,
    workerSessionsAfterPark: parked?.json?.sessions?.worker ?? daemonStatus(sandbox, { includeWorkers: true }).json?.sessions?.worker ?? null,
    reopenExit: reopen.child.exitCode,
    transcriptLinesBeforeReopen: linesBefore,
    transcriptLinesAfterReopen: linesAfter,
    reopenedCompleted: accepted && progress?.answered === true,
    reopenMessageDelivered: progress?.messageIndex >= 0,
    sameChildSession: filesBefore.length === 1 &&
      childSessionFiles(sandbox, completed.task_id).join() === filesBefore.join() &&
      readTaskRecords(sandbox).length === 1,
    reviveAccepted: accepted,
    reopenOutcome: reopenResults(),
    runEpochBefore: epochBefore ?? null,
    runEpochAfter: reopened?.notification?.run_epoch ?? null,
    childStart: childStartDiagnosis(sandbox, readTaskRecords(sandbox)),
  }
  const pass = reopenPass(facts)
  await stopParent(reopen)
  const receipt = await cleanupScenario(sandbox, { hostPids: [before?.json?.pid].filter(Boolean) })
  return {
    scenario: "C2",
    title: "parking: completed child parked, task_send reopens it",
    status: pass ? "pass" : "fail",
    reason: `child=${facts.childCompleted} parked=${facts.parkObserved} revived=${accepted} epoch=${facts.runEpochBefore}->${facts.runEpochAfter} lines=${linesBefore}->${linesAfter}`,
    facts,
    receipt,
  }
}


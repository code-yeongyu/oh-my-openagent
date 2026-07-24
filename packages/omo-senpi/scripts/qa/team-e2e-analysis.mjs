import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import {
  deliveredEventCount,
  findResults,
  memberTaskId,
  processedMessagePath,
  sessionContainsText,
} from "./team-e2e-support.mjs"
import { pollUntil } from "./team-e2e-runtime.mjs"

export async function analyzeMain(run, sandbox, obsDir) {
  const create = findResults(run.events, "team_create")[0]
  const send = findResults(run.events, "task_send")
  const waited = findResults(run.events, "team_wait")[0]
  const taskCreate = findResults(run.events, "task_create")[0]
  const taskUpdates = findResults(run.events, "task_update")
  const outputSnapshots = taskOutputSnapshots(run.events)
  const runId = create?.details?.team_run_id
  const memberNames = (create?.details?.members ?? []).map((member) => member.name).sort()
  const claimed = taskUpdates.some((result) => result.details?.kind === "claimed" || result.details?.task?.status === "claimed")
  const completed = completedTeamTaskUpdates(taskUpdates).length === 1
  const teamEnqueues = teamMessageEnqueues(send)
  const shutdownRequests = shutdownDetails(send, "shutdown_requested")
  const shutdownResponses = shutdownDetails(send, "shutdown_responded")
  const approvedFixture = shutdownResponses.some((details) => details.member === "fixture" && details.approved === true)
  const rejectedFixture = shutdownResponses.some((details) => details.member === "fixture" && details.approved === false)
  const fixtureCancelled = outputSnapshots.some((snapshot) => snapshot.name === `team:${runId}:fixture` && snapshot.status === "cancelled")
  const waitMessageId = waited?.details?.message_id
  const quickTask = runId === undefined ? undefined : memberTaskId(sandbox.cwd, runId, "quick")
  const leadToQuick = teamEnqueues.find((entry) => entry.recipients.includes("quick"))
  const evidence = await pollUntil(
    () => Promise.resolve(waitEvidence(sandbox.cwd, runId, quickTask, waitMessageId)),
    (value) => value.processed && value.events === 1,
    10_000,
  )
  mkdirSync(obsDir, { recursive: true })
  writeFileSync(join(obsDir, "team-wait-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`)
  return {
    createTwoMembersActive: create?.details?.kind === "created" && (create.details.members?.length ?? 0) === 2,
    createListsActiveMembers: JSON.stringify(memberNames) === JSON.stringify(["fixture", "quick"]),
    leadToMemberEnqueued: teamEnqueues.some((entry) => entry.recipients.includes("quick")),
    memberEnvelopeEchoed:
      quickTask !== undefined
      && leadToQuick !== undefined
      && sessionContainsText(sandbox.cwd, quickTask, leadToQuick.messageId),
    teamWaitReceivedMemberMessage: waited?.details?.kind === "message" && waited.details.body.includes("QUICK2LEAD"),
    teamWaitProcessedLedger: evidence.processed,
    teamWaitEventLoggedOnce: evidence.events === 1,
    taskCreateClaimUpdate: taskCreate?.details?.kind === "created" && claimed && completed,
    shutdownApproved: approvedFixture,
    shutdown_via_task_send: shutdownRequests.some((details) => details.member === "fixture") && approvedFixture && fixtureCancelled,
    rejectRestoredMember: rejectedFixture,
    leadExitClean: run.status === 0,
  }
}

export function verdict(checks) {
  const failed = Object.entries(checks).filter(([, value]) => value !== true).map(([name]) => name)
  return { result: failed.length === 0 ? "PASS" : "FAIL", failed }
}

export function teamMessageEnqueues(sendResults) {
  return sendResults.flatMap((result) => {
    if (result.details?.kind !== "team_message") return []
    const team = result.details.team
    if (team?.kind !== "to_members" || !Array.isArray(team.recipients)) return []
    return [{ messageId: team.message_id, recipients: team.recipients }]
  })
}

export function completedTeamTaskUpdates(taskUpdates) {
  return taskUpdates.filter((result) => result.details?.kind === "updated" && result.details?.task?.status === "completed")
}

function waitEvidence(cwd, runId, taskId, messageId) {
  if (runId === undefined || taskId === undefined || messageId === undefined) {
    return { processed: false, events: 0, runId, taskId, messageId }
  }
  return {
    processed: existsSync(processedMessagePath(cwd, runId, "lead", messageId)),
    events: deliveredEventCount(cwd, taskId, messageId),
    runId,
    taskId,
    messageId,
  }
}

function shutdownDetails(sendResults, kind) {
  return sendResults.map((result) => result.details).filter((details) => details?.kind === kind)
}

function taskOutputSnapshots(events) {
  return findResults(events, "task_output")
    .map((result) => result.details?.snapshot)
    .filter((snapshot) => snapshot !== undefined)
}

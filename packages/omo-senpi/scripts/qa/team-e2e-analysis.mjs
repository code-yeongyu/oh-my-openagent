import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import {
  findResults,
  inboxCounts,
  memberInboxDir,
  memberTaskId,
  sessionContainsText,
} from "./team-e2e-support.mjs"

export function analyzeMain(run, sandbox, obsDir, observedEvidence = undefined) {
  const create = findResults(run.events, "team_create")[0]
  const sends = findResults(run.events, "task_send")
  const runId = create?.details?.team_run_id
  const memberNames = (create?.details?.members ?? []).map((member) => member.name).sort()
  const leadToQuick = teamMessageEnqueues(sends).find((entry) => entry.recipients.includes("quick"))
  const quickTask = runId === undefined ? undefined : memberTaskId(sandbox.cwd, runId, "quick")
  const evidence = observedEvidence ?? injectionEvidence(sandbox.cwd, runId, quickTask, leadToQuick?.messageId, obsDir)
  mkdirSync(obsDir, { recursive: true })
  writeFileSync(join(obsDir, "team-injection-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`)
  return {
    createTwoMembersActive: create?.details?.kind === "created" && (create.details.members?.length ?? 0) === 2,
    createListsActiveMembers: JSON.stringify(memberNames) === JSON.stringify(["fixture", "quick"]),
    leadToMemberEnqueued: leadToQuick !== undefined,
    memberEnvelopeEchoed: evidence.memberEnvelopeEchoed,
    memberToLeadInjected: evidence.memberToLeadInjected,
    leadInboxDrained: evidence.leadInbox.unread === 0 && evidence.leadInbox.reserved === 0,
    noBlockingTeamWaitCalls: findResults(run.events, ["team", "wait"].join("_")).length === 0,
  }
}

export function teamMessageEnqueues(sendResults) {
  return sendResults.flatMap((result) => {
    if (result.details?.kind !== "team_message") return []
    const team = result.details.team
    if (team?.kind !== "to_members" || !Array.isArray(team.recipients)) return []
    return [{ messageId: team.message_id, recipients: team.recipients }]
  })
}

export function injectionEvidence(cwd, runId, quickTask, leadMessage, obsDir) {
  const leadReceipt = join(obsDir, "lead-received.txt")
  return {
    runId,
    quickTask,
    leadMessage,
    memberEnvelopeEchoed:
      quickTask !== undefined
      && leadMessage !== undefined
      && sessionContainsText(cwd, quickTask, leadMessage),
    memberToLeadInjected:
      existsSync(leadReceipt)
      && readFileSync(leadReceipt, "utf8").includes("QUICK2LEAD"),
    leadInbox: runId === undefined ? { unread: 0, reserved: 0, processed: 0 } : inboxCounts(memberInboxDir(cwd, runId, "lead")),
  }
}

export function verdict(checks) {
  const failed = Object.entries(checks).filter(([, value]) => value !== true).map(([name]) => name)
  return { result: failed.length === 0 ? "PASS" : "FAIL", failed }
}

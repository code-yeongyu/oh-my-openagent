// Product predicates shared by the live scenarios and their fault controls.
export function singleParentPass(facts) {
  return facts.sessionsWorker >= 16 && facts.daemonIdentitiesSeen === 1 &&
    facts.perChildRpcProcessCount === 0 && facts.failedChildren === 0 && facts.terminalChildFailures === 0
}

export function resumePass(facts) {
  return facts.childrenStarted === 4 && facts.reattachedChildren === 4 && facts.grewAfterParentExit && facts.resumeAcknowledged &&
    facts.sameParentSession && facts.noPromptReplay && facts.childrenCompleted === 4
}

export function teamPass(facts) {
  return facts.memberRecords > 0 && facts.mailDelivered && facts.memberSessionContexts.length > 0 &&
    facts.memberContextMatches && facts.failedMembers === 0 && facts.perChildRpcProcessCount === 0
}

export function reopenPass(facts) {
  return facts.childCompleted === "completed" && facts.parkObserved &&
    facts.reviveAccepted && facts.transcriptLinesAfterReopen > facts.transcriptLinesBeforeReopen &&
    facts.reopenedCompleted && facts.reopenMessageDelivered && facts.sameChildSession
}

export function stormPass(facts) {
  return facts.hostPid !== null && facts.daemonAlive && facts.stormParticipants === 8 &&
    facts.bashCallRecords >= 200 && facts.zombieChildCount === 0 && facts.daemonReportedZombies === 0
}

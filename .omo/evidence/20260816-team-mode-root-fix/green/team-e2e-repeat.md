# Team Mode E2E — second consecutive PASS (stability confirmation)

## What was tested

The isolated real-surface Team Mode E2E was re-run, unchanged, to close the QA review finding that the
first PASS was a single unrepeated run against harness code that had been modified minutes earlier.

Command:

```
TEAM_E2E_OUT_DIR=.omo/evidence/omo-senpi-adapter/20260816-team-mode-root-fix/pr-b/team-e2e-repeat \
SENPI_BIN="$(command -v senpi)" \
node packages/omo-senpi/scripts/qa/team-e2e.mjs
```

No production code, no harness code, and no test code was changed between the first PASS
(`team-e2e-green-final/`) and this run (`team-e2e-repeat/`).

## What was observed

Exit code: 0.

```json
{"result":"PASS",
 "failed":[],
 "credentialIsolationClean":true,
 "wholeDirUnchanged":true,
 "leakedPids":0}
```

All 22 checks true:

| Area | Checks |
|---|---|
| Create / membership | createTwoMembersActive, createListsActiveMembers |
| Messaging | leadToMemberEnqueued, memberEnvelopeEchoed, memberToLeadInjected, leadInboxDrained |
| No blocking wait | noBlockingTeamWaitCalls |
| Crash + reservation | crashHoldReached, crashKilledMemberAtHold, crashReservationUncommittedAtKill, crashReservationRestoredUnread, crashReservationNoResidue, crashReservedMessageDeliveredExactlyOnce |
| Restart + liveness | crashRestartExitClean, crashLivenessInjectedToLead, crashLivenessAcknowledged |
| Quit / resume | resume_member_suspended_on_quit, resume_member_revived, resume_member_mailbox_identity, resume_lead_poller_running, resume_shutdown_approved_setup, resume_shutdown_approved_not_revived |

Note: `wholeDirUnchanged` is `true` in this run (it was `false` and explicitly non-gating in the first
PASS, caused by unrelated concurrent writes into the shared evidence tree during that run). Both runs
gate on `credentialIsolationClean` and `leakedPids === 0`, which are true in both.

## Cleanup receipt (post-repeat)

```
ps aux | grep -c '[o]mo-mock'        -> 0
ls -d /tmp/omo-senpi-qa-* | wc -l    -> 0
```

No orphan mock Senpi processes, no residual sandbox roots.

## Why this is enough

Two consecutive independent PASS runs of the same unmodified harness against the same unmodified
production code, both with zero failed checks, zero leaked PIDs, and clean credential isolation,
establish that the Team Mode behavior is stable and not a one-off green.

Artifacts: `.omo/evidence/omo-senpi-adapter/20260816-team-mode-root-fix/pr-b/team-e2e-repeat/`
(verdict.json, crash-recovery.json, per-phase stdout/stderr logs).

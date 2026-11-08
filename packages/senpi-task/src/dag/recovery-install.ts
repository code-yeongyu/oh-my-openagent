import type { RecoveryContext, RecoverableRecord, RecoveryPendingTerminalResult, InstalledDagRun } from "./recovery"
import type { DagJournal } from "./journal"
import type { DagRunRecordV1 } from "./manager"
import type { DagNodeId, DagNodeError } from "./types"
import { resetDagNodes } from "./node-retry"
import { recoverPausedDagChildren } from "./paused-child-recovery"
import { createDagScheduler } from "./scheduler"
import { dagRunResumedEvent } from "./events"

type InstallEffects = {
  journal(record: RecoverableRecord, errors: Map<DagNodeId, DagNodeError>, results: Map<DagNodeId, RecoveryPendingTerminalResult>): DagJournal<DagRunRecordV1>
  reconcile(journal: DagJournal<DagRunRecordV1>, outputs: Map<DagNodeId, string>, errors: Map<DagNodeId, DagNodeError>, results: Map<DagNodeId, RecoveryPendingTerminalResult>, tasks: Map<DagNodeId, string>): Promise<void>
  release(): void
}

export async function installRecoveredDag(context: RecoveryContext, claimed: RecoverableRecord, effects: InstallEffects): Promise<InstalledDagRun> {
  try {
    if (claimed.pause?.reason === "user_stop" && context.pausedChildren !== undefined) {
      await recoverPausedDagChildren({
        store: context.store, taskManager: context.taskManager, initialRecord: claimed, hostPid: context.hostPid, now: context.now,
      }, context.pausedChildren)
      claimed = context.store.readCheckpoint<RecoverableRecord>(claimed.runId) ?? claimed
    }
    const pendingErrors = new Map<DagNodeId, DagNodeError>()
    const pendingTerminalResults = new Map<DagNodeId, RecoveryPendingTerminalResult>()
    const journal = effects.journal(claimed, pendingErrors, pendingTerminalResults)
    const reusedOutputs = new Map<DagNodeId, string>()
    const reattachedTasks = new Map<DagNodeId, string>()
    if ((claimed.retryOnResume?.length ?? 0) > 0) resetDagNodes(journal, claimed.retryOnResume ?? [])
    await effects.reconcile(journal, reusedOutputs, pendingErrors, pendingTerminalResults, reattachedTasks)
    const generation = journal.snapshot().generation + 1
    journal.append(dagRunResumedEvent({ generation }))
    const scheduler = createDagScheduler({
      store: context.store,
      taskManager: context.taskManager,
      initialRecord: journal.snapshot(),
      ...(context.subscriberRing === undefined ? {} : { subscriberRing: context.subscriberRing }),
      ...(context.nodeSpawnPolicy === undefined ? {} : { nodeSpawnPolicy: context.nodeSpawnPolicy }),
      ...(reattachedTasks.size === 0 ? {} : { preAttachedTasks: reattachedTasks }),
      ...(context.ancestry === undefined ? {} : { ancestry: context.ancestry }),
      ...(context.resumeCredential === undefined ? {} : { resumeCredential: context.resumeCredential }),
      now: context.now,
    })
    const settled = scheduler.run()
      .then(record => ({ runId: claimed.runId, kind: "resumed" as const, record, reusedOutputs }))
      .finally(() => effects.release())
    return { kind: "installed", runId: claimed.runId, scheduler, settled }
  } catch (error) {
    effects.release()
    throw error
  }
}

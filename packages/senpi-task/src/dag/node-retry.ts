// Retry: returning settled nodes to a fresh attempt and re-entering the run (`run-reentry.ts`).
import { dagNodeRetriedEvent, dagNodeTransitionedEvent } from "./events"
import type { DagJournal } from "./journal"
import type { DagRunEventPayload } from "./types"
import type { DagDefinition, DagNodeInput } from "./graph"
import { createDagManager, type DagMaterializeSkills, type DagRunRecordV1 } from "./manager"
import {
  acquireReentryLease,
  controlJournal,
  DagNodeControlError,
  ownedRecord,
  readRecord,
  refuseUnheldActiveNodes,
} from "./node-control-context"
import { appendWhileStopped } from "./paused-controls"
import { assertRetryable, defaultRetryTargets, skippedDependentsOf } from "./retry-targets"
import { resumeIfSettled, startReentry, withRevivalCapacity, type DagRunReentry } from "./run-reentry"
import { createDagScheduler, type DagSchedulerOptions } from "./scheduler"
import type { DagNode, DagNodeId, DagRunId } from "./types"

export type DagRetryOptions = {
  readonly prompt?: string
}

/**
 * Returns the named nodes to a fresh pending attempt and re-enters the run. Journal writes happen
 * outside any run lock: the journal takes that lock itself and it is not reentrant.
 */
export function retryDagNodes(
  options: DagSchedulerOptions,
  runId: DagRunId,
  nodeIds?: readonly DagNodeId[],
  retryOptions?: DagRetryOptions,
): DagRunReentry {
  // Fast refusals on the current read; a re-entry decides every one of them again on the record
  // it acquires, and writes from that record only (#15125).
  const observed = ownedRecord(options, runId)
  const observedTargets = retryTargets(observed, runId, nodeIds, retryOptions)
  if (observed.status === "paused" && observed.pause?.reason === "user_stop")
    return stageRetry(options, observed, observedTargets, retryOptions)
  const { record, abandon } = acquireReentryLease(options, runId)
  try {
    const targets = retryTargets(record, runId, nodeIds, retryOptions)
    // A prompt override is a definition amendment: it is recorded even when the cap then refuses the retry.
    let current = record
    if (retryOptions?.prompt !== undefined) {
      for (const target of targets) current = amendRetryPrompt(options, record, target, retryOptions.prompt)
    }
    // The node mutations and the resume share one cap check, so a refused retry leaves every node as it was.
    const resumed = withRevivalCapacity(options, current, () => {
      const journal = controlJournal(options, current)
      resetDagNodes(journal, targets, retryOptions?.prompt !== undefined)
      return resumeIfSettled(options, journal.snapshot())
    })
    return startReentry(options, resumed)
  } catch (error) {
    abandon()
    throw error
  }
}

/**
 * A user-stopped run only stages the retry for the user's Resume. The staging write re-decides under
 * the journal's run lock that the run is still stopped by the same Stop, or writes nothing.
 */
function stageRetry(
  options: DagSchedulerOptions,
  observed: DagRunRecordV1,
  targets: readonly DagNodeId[],
  retryOptions?: DagRetryOptions,
): DagRunReentry {
  let current = observed
  if (retryOptions?.prompt !== undefined) {
    for (const target of targets) current = amendRetryPrompt(options, observed, target, retryOptions.prompt)
  }
  // The one stopped-run write: same Stop and no other live holder, decided at the write.
  const staged = appendWhileStopped(options, current, {
    type: "dag.node.retry-staged",
    nodeIds: [...targets],
  }).snapshot()
  // Staging starts no run: the scheduler only fills the return shape, so it stops listening at once.
  const scheduler = createDagScheduler({ ...options, initialRecord: staged })
  void scheduler.suspend()
  return { record: staged, scheduler, run: Promise.resolve(staged) }
}

/** Every rule a retry's targets must meet, checked on the record given. */
function retryTargets(
  record: DagRunRecordV1,
  runId: DagRunId,
  nodeIds: readonly DagNodeId[] | undefined,
  retryOptions: DagRetryOptions | undefined,
): DagNodeId[] {
  refuseUnheldActiveNodes(record)
  if (record.status === "running" || record.status === "pending") {
    throw new DagNodeControlError({
      code: "run_still_active",
      message: `dag run "${runId}" is still active; wait for it to settle before retrying a node`,
      runId,
    })
  }
  if (retryOptions?.prompt !== undefined && (nodeIds === undefined || nodeIds.length !== 1)) {
    throw new DagNodeControlError({
      code: "invalid_arguments",
      message: "a retry prompt override requires exactly one explicit node id",
      runId,
      ...(nodeIds === undefined ? {} : { nodeIds }),
    })
  }
  const targets = nodeIds === undefined ? defaultRetryTargets(record) : [...nodeIds]
  if (targets.length === 0) {
    throw new DagNodeControlError({
      code: "node_not_retryable",
      message: `dag run "${runId}" has no failed or cancelled node to retry`,
      runId,
    })
  }
  assertRetryable(record, runId, targets)
  return targets
}

/** Shared reset for manual run re-entry and infrastructure retries inside the live scheduler. */
export function resetDagNodes(
  journal: DagJournal<DagRunRecordV1>,
  targets: readonly DagNodeId[],
  promptChanged = false,
  automatic?: Extract<DagRunEventPayload, { readonly type: "dag.node.retried" }>["automatic"],
): void {
  for (const nodeId of targets) {
    const node = nodeById(journal.snapshot(), nodeId)
    journal.append(
      dagNodeRetriedEvent({
        nodeId,
        ...(node.taskId === undefined ? {} : { priorTaskId: node.taskId }),
        execAttempt: (node.execAttempt ?? 0) + 1,
        promptChanged,
        ...(automatic === undefined ? {} : { automatic }),
      }),
    )
  }
  for (const node of skippedDependentsOf(journal.snapshot(), targets)) {
    journal.append(
      dagNodeTransitionedEvent({
        nodeId: node.id,
        from: "skipped",
        to: "blocked",
        reason: { kind: "retried" },
      }),
    )
  }
}

// A prompt override is an amendment of exactly one node, so it routes through the manager's amend
// path: the definition fingerprint, the amend history, and the invalidation of dependents keep one
// implementation. amendRun mutates the checkpoint synchronously inside the manager's async wrapper,
// so the fresh checkpoint is readable the moment the call returns; a rejected amendment leaves the
// fingerprint untouched, which is what this checks instead of awaiting inside a synchronous verb.
function amendRetryPrompt(
  options: DagSchedulerOptions,
  record: DagRunRecordV1,
  nodeId: DagNodeId,
  prompt: string,
): DagRunRecordV1 {
  const manager = createDagManager({
    store: options.store,
    ...(options.now === undefined ? {} : { now: options.now }),
    materializeSkills: options.materializeSkills ?? identityMaterializer,
  })
  const definition: DagDefinition = {
    key: record.definition.key,
    name: record.definition.name,
    nodes: record.definition.nodes.map((node) => definitionNode(node, node.id === nodeId ? prompt : node.prompt)),
  }
  // amendRun mutates the checkpoint synchronously before its async wrapper yields, so the fresh
  // fingerprint is the decision. The rejection itself settles on a later tick and can never be
  // observed from this synchronous verb, so it is deliberately not consulted: a swallowed rejection
  // always leaves the fingerprint untouched, which is exactly the refusal below.
  void manager
    .amend({ runId: record.runId, definition, parentSessionId: record.parentSessionId })
    .catch(() => undefined)
  const applied = readRecord(options.store, record.runId)
  if (applied === null || applied.definitionFingerprint === record.definitionFingerprint) {
    throw new DagNodeControlError({
      code: "invalid_arguments",
      message: `dag node "${nodeId}" prompt override was rejected`,
      runId: record.runId,
      nodeIds: [nodeId],
    })
  }
  return applied
}

// Skill materialization with nothing to load: effectivePrompt tracks the submitted prompt, which is
// what the real materializer produces for a node with no load_skills. It keeps a prompt override
// from dispatching the PREVIOUS effectivePrompt when the caller wired no materializer.
const identityMaterializer: DagMaterializeSkills = ({ definition }) => ({
  nodes: definition.nodes.map((node) => ({ nodeId: node.id, effectivePrompt: node.prompt })),
})

function definitionNode(node: DagNodeInput & { readonly effectivePrompt?: string }, prompt: string): DagNodeInput {
  const { effectivePrompt: _effectivePrompt, ...input } = node
  return { ...input, prompt }
}

function nodeById(record: DagRunRecordV1, nodeId: DagNodeId): DagNode {
  const node = record.nodes.find((entry) => entry.id === nodeId)
  if (node === undefined) throw new Error(`unknown DAG node "${nodeId}"`)
  return node
}

// Retry and run re-entry: returning settled nodes to a fresh attempt and handing the run to a NEW
// scheduler instance.
import { dagNodeRetriedEvent, dagNodeTransitionedEvent, dagRunResumedEvent } from "./events"
import type { DagDefinition, DagNodeInput } from "./graph"
import { createDagManager, type DagMaterializeSkills, type DagRunRecordV1 } from "./manager"
import {
  controlErrorMessage,
  controlJournal,
  DagNodeControlError,
  ownedRecord,
  readRecord,
} from "./node-control-context"
import { createDagScheduler, type DagScheduler, type DagSchedulerOptions } from "./scheduler"
import type { DagNode, DagNodeId, DagNodeState, DagRunId } from "./types"

const RETRYABLE_NODE_STATES: ReadonlySet<DagNodeState> = new Set(["failed", "cancelled", "skipped"])
const SETTLED_RUN_STATUSES: ReadonlySet<string> = new Set(["completed", "failed", "cancelled"])

export type DagRunReentry = {
  /** The record as it stands after the control verb journaled its mutations, before waves re-run. */
  readonly record: DagRunRecordV1
  readonly scheduler: DagScheduler
  readonly run: Promise<DagRunRecordV1>
}

export type DagRetryOptions = {
  readonly prompt?: string
}

/**
 * Re-enters a settled or idle run with a FRESH scheduler built from the CURRENT record. The settled
 * instance is never resumed: its cancellation deferreds and admission latches are single-shot, so a
 * second run on it would inherit a spent state machine. `dag.run.resumed` is journaled
 * SYNCHRONOUSLY here, before the run promise exists, so a caller that waits immediately after a
 * retry blocks on the NEW settle instead of short-circuiting on the stale terminal checkpoint.
 *
 * `preAttachedTasks` is deliberately dropped: it describes children that were live when the PREVIOUS
 * instance was built, and re-attaching an already-settled task would fold its outcome onto the node
 * a second time.
 */
export function reenterDagRun(options: DagSchedulerOptions): DagRunReentry {
  const current = readRecord(options.store, options.initialRecord.runId) ?? options.initialRecord
  let record = current
  if (SETTLED_RUN_STATUSES.has(current.status)) {
    const journal = controlJournal(options, current)
    journal.append(dagRunResumedEvent({ generation: current.generation + 1 }))
    record = journal.snapshot()
  }
  const { preAttachedTasks: _preAttachedTasks, ...reentryOptions } = options
  const scheduler = createDagScheduler({ ...reentryOptions, initialRecord: record })
  return { record, scheduler, run: scheduler.run() }
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
  const record = ownedRecord(options, runId)
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

  const current = retryOptions?.prompt === undefined
    ? record
    : amendRetryPrompt(options, record, targets[0] as DagNodeId, retryOptions.prompt)
  const journal = controlJournal(options, current)
  for (const nodeId of targets) {
    const node = nodeById(journal.snapshot(), nodeId)
    // The DISPLAY attempt belongs to task attachment; execAttempt is the execution-intent counter
    // the owner fingerprint is keyed on, so a retried node claims a new owner identity.
    journal.append(dagNodeRetriedEvent({
      nodeId,
      ...(node.taskId === undefined ? {} : { priorTaskId: node.taskId }),
      execAttempt: (node.execAttempt ?? 0) + 1,
      promptChanged: retryOptions?.prompt !== undefined,
    }))
  }
  for (const node of skippedDependentsOf(journal.snapshot(), targets)) {
    journal.append(dagNodeTransitionedEvent({
      nodeId: node.id,
      from: "skipped",
      to: "blocked",
      reason: { kind: "retried" },
    }))
  }
  return reenterDagRun({ ...options, initialRecord: journal.snapshot() })
}

function defaultRetryTargets(record: DagRunRecordV1): DagNodeId[] {
  const seeds = record.nodes
    .filter((node) => node.state === "failed" || node.state === "cancelled")
    .map((node) => node.id)
  return [...seeds, ...skippedDependentsOf(record, seeds).map((node) => node.id)]
}

// Transitive skipped dependents of the retry set: the cascade skipped them, so retrying their
// blocking ancestor must hand them back to the scheduler loop as blocked work.
function skippedDependentsOf(record: DagRunRecordV1, seeds: readonly DagNodeId[]): readonly DagNode[] {
  const selected = new Set(seeds)
  const restored: DagNode[] = []
  let changed = true
  while (changed) {
    changed = false
    for (const node of record.nodes) {
      if (node.state !== "skipped" || selected.has(node.id)) continue
      if (!node.dependsOn.some((dependencyId) => selected.has(dependencyId))) continue
      selected.add(node.id)
      restored.push(node)
      changed = true
    }
  }
  return restored
}

function assertRetryable(record: DagRunRecordV1, runId: DagRunId, targets: readonly DagNodeId[]): void {
  const selected = new Set(targets)
  for (const nodeId of targets) {
    const node = record.nodes.find((entry) => entry.id === nodeId)
    if (node === undefined) {
      throw new DagNodeControlError({ code: "node_not_found", message: `unknown dag node "${nodeId}"`, runId, nodeIds: [nodeId] })
    }
    if (node.state === "completed") {
      throw new DagNodeControlError({
        code: "node_not_retryable",
        message: `dag node "${nodeId}" already completed; amend the definition to re-run it`,
        runId,
        nodeIds: [nodeId],
      })
    }
    if (!RETRYABLE_NODE_STATES.has(node.state)) {
      throw new DagNodeControlError({
        code: "node_not_retryable",
        message: `dag node "${nodeId}" is ${node.state}; only failed, cancelled, or skipped nodes can be retried`,
        runId,
        nodeIds: [nodeId],
      })
    }
    if (node.state !== "skipped") continue
    // A skipped node whose blocking ancestor stays failed is re-skipped by the dependent cascade
    // the moment the scheduler loop runs, so every such ancestor must be part of the same retry set.
    const blocking = blockingAncestors(record, node).filter((ancestorId) => !selected.has(ancestorId))
    if (blocking.length > 0) {
      throw new DagNodeControlError({
        code: "node_not_retryable",
        message: `dag node "${nodeId}" was skipped because ${blocking.join(", ")} did not complete; retry those in the same call`,
        runId,
        nodeIds: [nodeId, ...blocking],
      })
    }
  }
}

function blockingAncestors(record: DagRunRecordV1, node: DagNode): readonly DagNodeId[] {
  const blocking = new Set<DagNodeId>()
  const seen = new Set<DagNodeId>([node.id])
  const queue = [...node.dependsOn]
  while (queue.length > 0) {
    const id = queue.shift() as DagNodeId
    if (seen.has(id)) continue
    seen.add(id)
    const ancestor = record.nodes.find((entry) => entry.id === id)
    if (ancestor === undefined) continue
    if (ancestor.state === "failed" || ancestor.state === "cancelled") blocking.add(id)
    if (ancestor.state === "skipped") queue.push(...ancestor.dependsOn)
  }
  return [...blocking]
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

function definitionNode(node: DagNodeInput, prompt: string): DagNodeInput {
  const { effectivePrompt: _effectivePrompt, ...input } = node as DagNodeInput & { readonly effectivePrompt?: string }
  return { ...input, prompt } as DagNodeInput
}

function nodeById(record: DagRunRecordV1, nodeId: DagNodeId): DagNode {
  const node = record.nodes.find((entry) => entry.id === nodeId)
  if (node === undefined) throw new Error(`unknown DAG node "${nodeId}"`)
  return node
}

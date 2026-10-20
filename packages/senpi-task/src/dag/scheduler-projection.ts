import { createHash } from "node:crypto"
import * as fs from "node:fs"
import { relative } from "node:path"
import { applyDagRunMutation } from "./manager"
import { persistDagNodeResult, readDagNodeResult, type DagNodeResultArtifact } from "./results"
import type { DagFileStore } from "./store"
import type { TaskRecord } from "../state"
import { DAG_NODE_OUTPUT_PREVIEW_CHARS, type DagRunEvent } from "./types"
import { TERMINAL_NODE_STATES, type PendingTerminalResult, type DagNodeWithResult } from "./scheduler-context"
import type { DagNode, DagNodeId, DagNodeState, DagNodeError, DagRunId } from "./types"
import type { DagRunRecordV1 } from "./manager"

export function applyDagSchedulerEvent(
  record: DagRunRecordV1,
  event: DagRunEvent,
  pendingErrors: ReadonlyMap<DagNodeId, DagNodeError> = new Map(),
  terminalResults?: {
    readonly store: DagFileStore
    readonly pendingTerminalResults: Map<DagNodeId, PendingTerminalResult>
    readonly now: () => number
  },
): DagRunRecordV1 {
  switch (event.type) {
    case "dag.run.started":
      return {
        ...record,
        status: "running",
        startedAt: record.startedAt ?? event.at,
        updatedAt: event.at,
      }
    case "dag.run.completed":
      return { ...record, status: "completed", completedAt: event.at, updatedAt: event.at }
    case "dag.run.failed":
      return { ...record, status: "failed", completedAt: event.at, updatedAt: event.at }
    case "dag.run.cancelled":
      return { ...record, status: "cancelled", completedAt: event.at, updatedAt: event.at }
    case "dag.node.transitioned": {
      const terminalResult = TERMINAL_NODE_STATES.has(event.to)
        ? terminalResults?.pendingTerminalResults.get(event.nodeId)
        : undefined
      const replayedResult = terminalResult === undefined && terminalResults !== undefined && event.to === "completed"
        ? replayDagNodeResult(terminalResults.store, record.runId, event.nodeId)
        : undefined
      const persisted: ReturnType<typeof persistDagNodeResult> | undefined = terminalResult === undefined || terminalResults === undefined
        ? replayedResult === undefined ? undefined : { kind: "persisted", artifact: replayedResult.artifact }
        : persistDagNodeResult({
            store: terminalResults.store,
            runId: record.runId,
            nodeId: event.nodeId,
            record: terminalResult.record,
            now: terminalResults.now,
          })
      terminalResults?.pendingTerminalResults.delete(event.nodeId)
      // The durable copy is written here anyway; carrying a bounded preview of it onto the node
      // costs no extra IO and is what lets a midpoint snapshot audit the child's claim (#8674).
      const outputText = terminalResult === undefined
        ? replayedResult?.output
        : terminalResult.record.final_response ?? ""
      return {
        ...record,
        nodes: record.nodes.map((node) => {
          if (node.id !== event.nodeId) return node
          const transitioned: DagNodeWithResult = transitionedNode(
            node,
            event.to,
            event.at,
            pendingErrors.get(event.nodeId),
          )
          if (persisted?.kind !== "persisted") return transitioned
          return {
            ...transitioned,
            resultArtifact: persisted.artifact,
            ...(outputText === undefined
              ? {}
              : {
                  output: outputText.slice(0, DAG_NODE_OUTPUT_PREVIEW_CHARS),
                  outputBytes: persisted.artifact.bytes,
                }),
            ...(terminalResult?.record.run_stats === undefined && replayedResult?.runStats === undefined
              ? {}
              : { runStats: terminalResult?.record.run_stats ?? replayedResult?.runStats }),
          }
        }),
        diagnostics: persisted?.kind === "failed"
          ? [
              ...record.diagnostics,
              {
                kind: "journal_corrupt",
                ...(persisted.diagnostic.runId === undefined ? {} : { runId: persisted.diagnostic.runId }),
                path: persisted.diagnostic.path,
                message: persisted.diagnostic.message,
                at: persisted.diagnostic.at,
              },
            ]
          : record.diagnostics,
        updatedAt: event.at,
      }
    }
    case "dag.node.task-attached":
      return {
        ...record,
        nodes: record.nodes.map((node) => node.id === event.nodeId
          ? { ...node, taskId: event.taskId, attempt: event.attempt }
          : node),
        updatedAt: event.at,
      }
    // Re-entry rearms the run: completedAt is stamped on every terminal status above, so leaving it
    // in place would report a settle that no longer describes this run through projectSnapshot.
    case "dag.run.resumed": {
      const { completedAt: _completedAt, ...running } = record
      return { ...running, status: "running", generation: event.generation, updatedAt: event.at }
    }
    // A revived child runs again on its own session: no new task, no attempt bump, just the node
    // leaving its terminal state so the revive watcher can fold the new outcome.
    case "dag.node.steered":
      if (event.delivery !== "revive") return { ...record, updatedAt: event.at }
      return {
        ...record,
        nodes: record.nodes.map((node) => node.id === event.nodeId ? { ...node, taskId: event.taskId } : node),
        updatedAt: event.at,
      }
    // The retry and amend record mutations live in ONE shared reducer with the manager so a journal
    // replay through either entry point rebuilds an identical checkpoint.
    case "dag.node.retried":
    case "dag.definition.amended":
      return { ...applyDagRunMutation(record, event), updatedAt: event.at }
    case "dag.diagnostic.added":
      return { ...record, diagnostics: [...record.diagnostics, event.diagnostic], updatedAt: event.at }
    case "dag.run.created":
    case "dag.run.paused":
    case "dag.wave.started":
    case "dag.wave.completed":
    case "dag.node.reused":
    case "dag.stream.overflow":
      return { ...record, updatedAt: event.at }
    default:
      return assertNever(event)
  }
}

function assertNever(value: never): never {
  throw new Error(`unexpected DAG event ${JSON.stringify(value)}`)
}

function replayDagNodeResult(
  store: DagFileStore,
  runId: DagRunId,
  nodeId: DagNodeId,
): {
  readonly artifact: DagNodeResultArtifact
  readonly output: string
  readonly runStats?: TaskRecord["run_stats"]
} | undefined {
  const result = readDagNodeResult({ store, runId, nodeId })
  if (result === null) return undefined
  const outputPath = store.paths.result(runId, nodeId)
  const output = fs.readFileSync(outputPath, "utf8")
  const statsPath = outputPath.replace(/\.txt$/, ".stats.json")
  const stats = readOptionalArtifact(store, statsPath)
  return {
    output,
    artifact: {
      ...artifactRef(store, outputPath, output),
      ...(stats === undefined ? {} : { stats }),
    },
    ...(result.runStats === undefined ? {} : { runStats: result.runStats }),
  }
}

function readOptionalArtifact(
  store: DagFileStore,
  path: string,
): DagNodeResultArtifact["stats"] | undefined {
  try {
    return artifactRef(store, path, fs.readFileSync(path, "utf8"))
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
    throw error
  }
}

function artifactRef(store: DagFileStore, path: string, contents: string): {
  readonly relativePath: string
  readonly sha256: string
  readonly bytes: number
} {
  return {
    relativePath: relative(store.stateDir, path),
    sha256: createHash("sha256").update(contents, "utf8").digest("hex"),
    bytes: Buffer.byteLength(contents, "utf8"),
  }
}

function transitionedNode(node: DagNode, state: DagNodeState, at: string, error?: DagNodeError): DagNode {
  // Leaving a terminal state for a new execution (a revived child) drops the previous outcome:
  // error, completion time, and result metadata all describe the attempt that just ended, and the
  // durable artifact stays readable on disk until the new attempt overwrites it.
  const base = state === "running" && TERMINAL_NODE_STATES.has(node.state)
    ? clearedTerminalOutcome(node)
    : node
  return {
    ...base,
    state,
    ...(state === "running" && node.startedAt === undefined ? { startedAt: at } : {}),
    ...(TERMINAL_NODE_STATES.has(state) ? { completedAt: at } : {}),
    ...(error === undefined ? {} : { error }),
  }
}

function clearedTerminalOutcome(node: DagNodeWithResult): DagNode {
  const {
    error: _error,
    completedAt: _completedAt,
    runStats: _runStats,
    resultArtifact: _resultArtifact,
    output: _output,
    outputBytes: _outputBytes,
    ...cleared
  } = node
  return cleared
}

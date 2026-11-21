import { createHash } from "node:crypto"
import { relative } from "node:path"

import type { TaskRecord, TaskRunStats } from "../state"
import type { DagFileStore, DagStoreDiagnostic } from "./store"
import type { DagNodeId, DagRunId } from "./types"

const STATS_SCHEMA_VERSION = 1

export type DagResultArtifactRef = {
  readonly relativePath: string
  readonly sha256: string
  readonly bytes: number
}

// Journal-recorded description of the durable copy: the response artifact plus the optional
// run_stats sidecar. Both paths are relative to the task state dir so a moved project still
// resolves them.
export type DagNodeResultArtifact = DagResultArtifactRef & {
  readonly stats?: DagResultArtifactRef
}

export type DagNodeResultPersistOutcome =
  | { readonly kind: "persisted"; readonly artifact: DagNodeResultArtifact }
  | { readonly kind: "failed"; readonly diagnostic: DagStoreDiagnostic }

export type DagNodeResultRead = {
  readonly output: string
  readonly runStats?: TaskRunStats
  readonly artifact: DagNodeResultArtifact
}

export type DagNodeResultPersistInput = {
  readonly store: DagFileStore
  readonly runId: DagRunId
  readonly nodeId: DagNodeId
  readonly record: TaskRecord
  readonly now?: () => number
}

export type DagNodeResultReadInput = {
  readonly store: DagFileStore
  readonly runId: DagRunId
  readonly nodeId: DagNodeId
}

type StatsSidecar = {
  readonly schemaVersion: typeof STATS_SCHEMA_VERSION
  readonly runId: DagRunId
  readonly nodeId: DagNodeId
  readonly runStats: TaskRunStats
}

/**
 * Copies a terminal node's final response (and run_stats sidecar) into the DAG result store.
 *
 * Called SYNCHRONOUSLY inside the terminal-transition journal mutation: residency eviction drops
 * terminal idle TaskRecords, and the record itself expires on the task TTL, so a lazy copy would
 * lose the output. Single attempt only - a failed copy returns a journal_corrupt diagnostic for the
 * caller to journal, and the run continues.
 */
export function persistDagNodeResult(input: DagNodeResultPersistInput): DagNodeResultPersistOutcome {
  const now = input.now ?? Date.now
  let outputPath: string | undefined
  try {
    // The store's path builder refuses an unsafe node id (a path-traversal backstop behind the
    // graph compiler's boundary check). The refusal lands in the catch below as the same
    // journal_corrupt diagnostic the caller already journals, instead of throwing out of a
    // terminal-transition mutation.
    outputPath = input.store.paths.result(input.runId, input.nodeId)
    const output = input.record.final_response ?? ""
    input.store.writeResult(input.runId, input.nodeId, output)
    const stats = writeStatsSidecar(input)
    return {
      kind: "persisted",
      artifact: {
        ...artifactRef(input.store, outputPath, output),
        ...(stats === undefined ? {} : { stats }),
      },
    }
  } catch (error) {
    // A refused node id keeps the existing journal_corrupt kind so the scheduler's terminal
    // transition and its reducer are unchanged; `path` names the results directory rather than the
    // rejected id, because the diagnostic's `path` field is documented as a filesystem path.
    return {
      kind: "failed",
      diagnostic: {
        kind: "journal_corrupt",
        runId: input.runId,
        path: outputPath ?? input.store.paths.results,
        message: `failed to persist dag node result for "${input.nodeId}": ${errorMessage(error)}`,
        at: new Date(now()).toISOString(),
      },
    }
  }
}

/**
 * Reads a completed node's durable output for resume reuse. Reads ONLY the persisted artifacts,
 * never TaskRecord.final_response / run_stats, so reuse survives the task TTL sweep.
 */
export function readDagNodeResult(input: DagNodeResultReadInput): DagNodeResultRead | null {
  let outputPath: string
  try {
    // Same backstop as persist: an unsafe node id reads nothing rather than escaping the state dir.
    // Only paths.result is in the try, so this catch cannot swallow an unrelated I/O error; keep it
    // that way if this function grows.
    outputPath = input.store.paths.result(input.runId, input.nodeId)
  } catch (error) {
    if (error instanceof Error) return null
    throw error
  }
  const output = input.store.readResult(input.runId, input.nodeId)
  if (output === null) return null
  const stats = input.store.readResultStats(input.runId, input.nodeId)
  const artifact: DagNodeResultArtifact = {
    ...artifactRef(input.store, outputPath, output),
    ...(stats === null
      ? {}
      : { stats: artifactRef(input.store, input.store.paths.resultStats(input.runId, input.nodeId), stats) }),
  }
  if (stats === null) return { output, artifact }
  return { output, artifact, runStats: (JSON.parse(stats) as StatsSidecar).runStats }
}

function writeStatsSidecar(input: DagNodeResultPersistInput): DagResultArtifactRef | undefined {
  const runStats = input.record.run_stats
  if (runStats === undefined) return undefined
  const sidecar: StatsSidecar = {
    schemaVersion: STATS_SCHEMA_VERSION,
    runId: input.runId,
    nodeId: input.nodeId,
    runStats,
  }
  const serialized = JSON.stringify(sidecar)
  return artifactRef(input.store, input.store.writeResultStats(input.runId, input.nodeId, serialized), serialized)
}

function artifactRef(store: DagFileStore, path: string, contents: string): DagResultArtifactRef {
  return {
    relativePath: relative(store.stateDir, path),
    sha256: createHash("sha256").update(contents, "utf8").digest("hex"),
    bytes: Buffer.byteLength(contents, "utf8"),
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

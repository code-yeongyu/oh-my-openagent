import { createHash, randomBytes } from "node:crypto"
import * as fs from "node:fs"
import { dirname, relative } from "node:path"

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
  const outputPath = input.store.paths.result(input.runId, input.nodeId)
  try {
    const output = input.record.final_response ?? ""
    fs.mkdirSync(dirname(outputPath), { recursive: true })
    writeArtifact(outputPath, output)
    const stats = writeStatsSidecar(input, statsPath(outputPath))
    return {
      kind: "persisted",
      artifact: {
        ...artifactRef(input.store, outputPath, output),
        ...(stats === undefined ? {} : { stats }),
      },
    }
  } catch (error) {
    return {
      kind: "failed",
      diagnostic: {
        kind: "journal_corrupt",
        runId: input.runId,
        path: outputPath,
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
  const outputPath = input.store.paths.result(input.runId, input.nodeId)
  const output = readTextFile(outputPath)
  if (output === null) return null
  const runStats = readStats(statsPath(outputPath))
  return runStats === undefined ? { output } : { output, runStats }
}

function writeStatsSidecar(input: DagNodeResultPersistInput, path: string): DagResultArtifactRef | undefined {
  const runStats = input.record.run_stats
  if (runStats === undefined) return undefined
  const sidecar: StatsSidecar = {
    schemaVersion: STATS_SCHEMA_VERSION,
    runId: input.runId,
    nodeId: input.nodeId,
    runStats,
  }
  const serialized = JSON.stringify(sidecar)
  writeArtifact(path, serialized)
  return artifactRef(input.store, path, serialized)
}

function writeArtifact(path: string, contents: string): void {
  const tmpPath = `${path}.tmp-${randomSuffix()}`
  let fd: number | undefined
  try {
    fd = fs.openSync(tmpPath, "w")
    fs.writeSync(fd, contents)
    fs.fsyncSync(fd)
    fs.closeSync(fd)
    fd = undefined
    fs.renameSync(tmpPath, path)
  } catch (error) {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd)
      } catch {
        // ignore close errors during cleanup
      }
      fd = undefined
    }
    try {
      fs.rmSync(tmpPath, { force: true })
    } catch {
      // ignore cleanup errors
    }
    throw error
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd)
      } catch {
        // ignore close errors during cleanup
      }
    }
  }
}

function randomSuffix(): string {
  return randomBytes(8).toString("hex")
}

function artifactRef(store: DagFileStore, path: string, contents: string): DagResultArtifactRef {
  return {
    relativePath: relative(store.stateDir, path),
    sha256: createHash("sha256").update(contents, "utf8").digest("hex"),
    bytes: Buffer.byteLength(contents, "utf8"),
  }
}

function statsPath(outputPath: string): string {
  return `${outputPath.slice(0, -".txt".length)}.stats.json`
}

function readStats(path: string): TaskRunStats | undefined {
  const raw = readTextFile(path)
  if (raw === null) return undefined
  const value = JSON.parse(raw) as StatsSidecar
  return value.runStats
}

function readTextFile(path: string): string | null {
  try {
    return fs.readFileSync(path, "utf8")
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
    throw error
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

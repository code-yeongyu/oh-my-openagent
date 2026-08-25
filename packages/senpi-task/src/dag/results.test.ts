import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { createTaskRecord } from "../state"
import type { TaskRecord, TaskRunStats } from "../state"
import { createTaskRecordStore } from "../store/record-store"
import { persistDagNodeResult, readDagNodeResult } from "./results"
import { createDagFileStore, type DagFileStore } from "./store"
import type { DagNodeId, DagRunId } from "./types"

const cleanupRoots: string[] = []
const runId = "run-results" as DagRunId
const nodeId = "plan" as DagNodeId

const runStats: TaskRunStats = {
  runtime_ms: 4321,
  turns: 3,
  tool_calls: 7,
  output_tokens: 512,
  cost_usd: 0.0125,
}

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

function tempProject(): string {
  const directory = fs.mkdtempSync(join(tmpdir(), "senpi-dag-results-"))
  cleanupRoots.push(directory)
  return directory
}

function terminalRecord(projectDir: string, finalResponse: string): TaskRecord {
  const records = createTaskRecordStore({ project_dir: projectDir })
  const record: TaskRecord = {
    ...createTaskRecord({
      parent_session_id: "parent-session",
      root_session_id: "root-session",
      depth: 0,
      execution_mode: "direct",
      model: "gpt-5.2",
      notify_on_terminal: false,
    }),
    status: "completed",
    final_response: finalResponse,
    run_stats: runStats,
  }
  records.save(record)
  return record
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

describe("persistDagNodeResult durable node artifacts", () => {
  test("#given a terminal node record #when persisted #then the response file carries the sha256 and byte count of the copy", () => {
    // given
    const projectDir = tempProject()
    const store: DagFileStore = createDagFileStore({ project_dir: projectDir })
    const finalResponse = "plan complete: shipped 3 files\nwith a trailing note"
    const record = terminalRecord(projectDir, finalResponse)

    // when
    const outcome = persistDagNodeResult({ store, runId, nodeId, record })

    // then
    expect(outcome.kind).toBe("persisted")
    if (outcome.kind !== "persisted") throw new Error("expected persisted outcome")
    expect(outcome.artifact.relativePath).toBe(join("dag", "results", runId, `${nodeId}.txt`))
    expect(outcome.artifact.sha256).toBe(sha256(finalResponse))
    expect(outcome.artifact.bytes).toBe(Buffer.byteLength(finalResponse, "utf8"))
    expect(fs.readFileSync(join(store.stateDir, outcome.artifact.relativePath), "utf8")).toBe(finalResponse)
  })

  test("#given run stats on the terminal record #when persisted #then a stats sidecar holds them with its own digest", () => {
    // given
    const projectDir = tempProject()
    const store = createDagFileStore({ project_dir: projectDir })
    const record = terminalRecord(projectDir, "build ok")

    // when
    const outcome = persistDagNodeResult({ store, runId, nodeId, record })

    // then
    if (outcome.kind !== "persisted") throw new Error("expected persisted outcome")
    const sidecar = outcome.artifact.stats
    if (sidecar === undefined) throw new Error("expected stats sidecar")
    expect(sidecar.relativePath).toBe(join("dag", "results", runId, `${nodeId}.stats.json`))
    const raw = fs.readFileSync(join(store.stateDir, sidecar.relativePath), "utf8")
    expect(sidecar.sha256).toBe(sha256(raw))
    expect(sidecar.bytes).toBe(Buffer.byteLength(raw, "utf8"))
    expect(JSON.parse(raw)).toEqual({ schemaVersion: 1, runId, nodeId, runStats })
  })

  test("#given a persisted node #when the TaskRecord is deleted #then resume reuse still reads the output and stats", () => {
    // given
    const projectDir = tempProject()
    const store = createDagFileStore({ project_dir: projectDir })
    const records = createTaskRecordStore({ project_dir: projectDir })
    const finalResponse = "survives the task ttl sweep"
    const record = terminalRecord(projectDir, finalResponse)
    persistDagNodeResult({ store, runId, nodeId, record })

    // when
    records.remove(record.task_id)

    // then
    expect(records.load(record.task_id)).toBeNull()
    const reused = readDagNodeResult({ store, runId, nodeId })
    expect(reused?.output).toBe(finalResponse)
    expect(reused?.runStats).toEqual(runStats)
  })

  test("#given an unwritable result path #when persisting #then a journal_corrupt diagnostic is returned instead of throwing", () => {
    // given
    const projectDir = tempProject()
    const store = createDagFileStore({ project_dir: projectDir })
    const record = terminalRecord(projectDir, "unreachable output")
    const outputPath = store.paths.result(runId, nodeId)
    // A directory planted at the artifact path rejects open-for-write on Windows and POSIX alike.
    fs.mkdirSync(outputPath, { recursive: true })
    expect(fs.statSync(outputPath).isDirectory()).toBe(true)

    // when
    const outcome = persistDagNodeResult({ store, runId, nodeId, record })

    // then
    expect(outcome.kind).toBe("failed")
    if (outcome.kind !== "failed") throw new Error("expected failed outcome")
    expect(outcome.diagnostic.kind).toBe("journal_corrupt")
    expect(outcome.diagnostic.runId).toBe(runId)
    expect(outcome.diagnostic.path).toBe(outputPath)
    // the diagnostic must be caused by the blocked path, not returned unconditionally
    fs.rmSync(outputPath, { recursive: true })
    expect(readDagNodeResult({ store, runId, nodeId })).toBeNull()
    expect(persistDagNodeResult({ store, runId, nodeId, record }).kind).toBe("persisted")
  })

  test("#given a node with no persisted artifact #when reuse reads it #then it reports nothing rather than falling back to the record", () => {
    // given
    const projectDir = tempProject()
    const store = createDagFileStore({ project_dir: projectDir })
    const record = terminalRecord(projectDir, "record-only response")
    persistDagNodeResult({ store, runId, nodeId: "build" as DagNodeId, record })

    // when
    const reused = readDagNodeResult({ store, runId, nodeId })

    // then
    expect(reused).toBeNull()
    expect(readDagNodeResult({ store, runId, nodeId: "build" as DagNodeId })?.output).toBe("record-only response")
  })

  test("#given a terminal record without run stats #when persisted #then no sidecar is written and reuse reports undefined stats", () => {
    // given
    const projectDir = tempProject()
    const store = createDagFileStore({ project_dir: projectDir })
    const record: TaskRecord = { ...terminalRecord(projectDir, "no stats output"), run_stats: undefined }

    // when
    const outcome = persistDagNodeResult({ store, runId, nodeId, record })

    // then
    if (outcome.kind !== "persisted") throw new Error("expected persisted outcome")
    expect(outcome.artifact.stats).toBeUndefined()
    expect(fs.existsSync(join(store.stateDir, "dag", "results", runId, `${nodeId}.stats.json`))).toBe(false)
    const reused = readDagNodeResult({ store, runId, nodeId })
    expect(reused?.output).toBe("no stats output")
    expect(reused?.runStats).toBeUndefined()
  })

  test("#given a persisted node #when persisted again with a different body #then the second body replaces the first and the stats sidecar is replaced", () => {
    // given
    const projectDir = tempProject()
    const store = createDagFileStore({ project_dir: projectDir })
    const firstRecord = terminalRecord(projectDir, "first attempt body")
    const secondRecord = terminalRecord(projectDir, "second attempt body")

    // when
    const firstOutcome = persistDagNodeResult({ store, runId, nodeId, record: firstRecord })
    const secondOutcome = persistDagNodeResult({ store, runId, nodeId, record: secondRecord })

    // then
    expect(firstOutcome.kind).toBe("persisted")
    expect(secondOutcome.kind).toBe("persisted")
    const reused = readDagNodeResult({ store, runId, nodeId })
    expect(reused?.output).toBe("second attempt body")
    expect(reused?.runStats).toEqual(runStats)
    const resultDir = dirname(store.paths.result(runId, nodeId))
    expect(fs.readdirSync(resultDir).sort()).toEqual([`${nodeId}.stats.json`, `${nodeId}.txt`])
  })

  test("#given a fault mid-write during re-persist #then the prior artifact body remains intact and no orphan temp file is left", () => {
    // given
    const projectDir = tempProject()
    const store = createDagFileStore({ project_dir: projectDir })
    const firstRecord = terminalRecord(projectDir, "first attempt body that must survive")
    const secondRecord = terminalRecord(projectDir, "second attempt body that will crash")
    persistDagNodeResult({ store, runId, nodeId, record: firstRecord })

    const originalWriteSync = fs.writeSync
    const fault = new Error("simulated partial write fault")
    const faultingWriteSync = (fd: number, data: string | Uint8Array, ...args: unknown[]): number => {
      if (typeof data === "string" && data.includes("second attempt body that will crash")) {
        const partial = data.slice(0, Math.floor(data.length / 2))
        originalWriteSync(fd, partial)
        throw fault
      }
      if (typeof data === "string") {
        return originalWriteSync(fd, data, ...(args as [(number | null)?, BufferEncoding?]))
      }
      return originalWriteSync(fd, data, ...(args as [(number | null)?, (number | null)?, (number | null)?]))
    }
    const writeSpy = spyOn(fs, "writeSync").mockImplementation(faultingWriteSync as unknown as typeof fs.writeSync)

    // when
    let outcome: ReturnType<typeof persistDagNodeResult> | undefined
    try {
      outcome = persistDagNodeResult({ store, runId, nodeId, record: secondRecord })
    } finally {
      writeSpy.mockRestore()
    }

    // then
    expect(outcome?.kind).toBe("failed")
    const reused = readDagNodeResult({ store, runId, nodeId })
    expect(reused?.output).toBe("first attempt body that must survive")
    const resultDir = dirname(store.paths.result(runId, nodeId))
    expect(fs.readdirSync(resultDir).sort()).toEqual([`${nodeId}.stats.json`, `${nodeId}.txt`])
  })
})

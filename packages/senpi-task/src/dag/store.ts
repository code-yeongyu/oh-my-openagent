// allow: SIZE_OK - crash-safe DAG persistence is kept in one module so WAL, checkpoint, lock, and GC invariants share one filesystem boundary.
import { createHash, randomUUID } from "node:crypto"
import * as fs from "node:fs"
import { basename, dirname, join } from "node:path"

import { defaultSignaller } from "../lifecycle/context"
import { resolveStateDir } from "../store/state-dir"
import { DAG_SETTINGS_DEFAULTS, type DagEventLane, type DagRunEvent, type DagRunId, type DagRunStatus, type DagSettings } from "./types"
import type { DagRunEventType } from "./events"

const SCHEMA_VERSION = 1
const LOCK_RETRY_MS = 10
const LOCK_WAIT_TIMEOUT_MS = 1_000
const READ_BUFFER_BYTES = 64 * 1024
const TERMINAL_STATUSES = new Set<DagRunStatus>(["completed", "failed", "cancelled"])
const sleeper = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))

export type DagStoreConfig = {
  readonly project_dir: string
  readonly task?: {
    readonly state_dir?: string
    readonly dag?: Partial<DagSettings>
  }
}

export type DagStoreDiagnostic =
  | {
      readonly kind: "event_log_recovered"
      readonly runId: DagRunId
      readonly path: string
      readonly message: string
      readonly at: string
    }
  | {
      readonly kind: "journal_corrupt"
      readonly runId?: DagRunId
      readonly path: string
      readonly message: string
      readonly at: string
    }

export type DagEventReadOptions = {
  readonly limit: number
  readonly lane?: DagEventLane
  readonly types?: readonly DagRunEventType[]
  readonly throughSeq?: number
}

export type DagEventPage = {
  readonly events: readonly DagRunEvent[]
  readonly nextSinceSeq: number
  readonly headSeq: number
  readonly hasMore: boolean
}

export type DagKeyRecord = {
  readonly schemaVersion: 1
  readonly parentSessionId: string
  readonly runKey: string
  readonly runId: DagRunId
  readonly definitionFingerprint?: string
}

export type DagStorePaths = {
  readonly root: string
  readonly keys: string
  readonly runs: string
  readonly events: string
  readonly results: string
  readonly locks: string
  readonly key: (parentSessionId: string, runKey: string) => string
  readonly run: (runId: DagRunId) => string
  readonly event: (runId: DagRunId) => string
  readonly result: (runId: DagRunId, nodeId: string) => string
  readonly runLock: (runId: DagRunId) => string
  readonly keyLock: (parentSessionId: string, runKey: string) => string
  readonly taskOwnerLock: (taskOwner: string) => string
}

export type DagFileStore = {
  readonly stateDir: string
  readonly paths: DagStorePaths
  readonly diagnostics: () => readonly DagStoreDiagnostic[]
  readonly appendEvent: (event: DagRunEvent) => void
  readonly readEvents: (runId: DagRunId, sinceSeqExclusive: number, options: DagEventReadOptions) => DagEventPage
  readonly writeCheckpoint: (runId: DagRunId, checkpoint: object) => void
  readonly readCheckpoint: <T extends object>(runId: DagRunId) => T | null
  readonly writeKey: (record: DagKeyRecord) => string
  readonly readKey: (parentSessionId: string, runKey: string) => DagKeyRecord | null
  readonly writeResult: (runId: DagRunId, nodeId: string, result: string) => string
  readonly readResult: (runId: DagRunId, nodeId: string) => string | null
  readonly withRunLock: <T>(runId: DagRunId, operation: () => T) => T
  readonly withKeyLock: <T>(parentSessionId: string, runKey: string, operation: () => T) => T
  readonly withTaskOwnerLock: <T>(taskOwner: string, runId: DagRunId, operation: () => T) => T
  readonly pruneExpired: (now?: number) => readonly DagRunId[]
}

export class DagJournalCorruptError extends Error {
  readonly diagnostic: DagStoreDiagnostic

  constructor(diagnostic: DagStoreDiagnostic) {
    super(diagnostic.message)
    this.name = "DagJournalCorruptError"
    this.diagnostic = diagnostic
  }
}

type StoreOptions = {
  readonly now?: () => number
  readonly isProcessAlive?: (pid: number) => boolean
  readonly platform?: NodeJS.Platform
  // Ordering-focused tests can disable fsync without bypassing real filesystem writes.
  readonly fsync?: boolean
}

type RetentionCheckpoint = {
  readonly schemaVersion: number
  readonly runId: DagRunId
  readonly runKey?: string
  readonly parentSessionId?: string
  readonly status?: DagRunStatus
  readonly completedAt?: string
  readonly updatedAt?: string
  readonly nodes?: readonly { readonly taskId?: string }[]
}

export function dagKeyHash(parentSessionId: string, runKey: string): string {
  return sha256(`${parentSessionId}\0${runKey}`)
}

export function createDagFileStore(config: DagStoreConfig, options: StoreOptions = {}): DagFileStore {
  const stateDir = resolveStateDir(config)
  const paths = createPaths(stateDir)
  const diagnosticLog: DagStoreDiagnostic[] = []
  const recoveredPaths = new Set<string>()
  const now = options.now ?? Date.now
  const isProcessAlive = options.isProcessAlive ?? defaultSignaller.isAlive
  const platform = options.platform ?? process.platform
  const fsyncWrites = options.fsync ?? true
  const maxRunsPerSession = config.task?.dag?.max_runs_per_session ?? DAG_SETTINGS_DEFAULTS.max_runs_per_session
  const retentionDays = config.task?.dag?.retention_days ?? DAG_SETTINGS_DEFAULTS.retention_days

  for (const directory of [paths.keys, paths.runs, paths.events, paths.results, paths.locks]) {
    fs.mkdirSync(directory, { recursive: true })
  }
  inspectExistingEventLogs(paths, diagnosticLog, recoveredPaths, now)

  const store: DagFileStore = {
    stateDir,
    paths,
    diagnostics: () => [...diagnosticLog],
    appendEvent(event) {
      assertSafeSegment(event.runId, "run id")
      assertSupportedSchema(event, paths.event(event.runId), event.runId, now)
      const path = paths.event(event.runId)
      const expectedSeq = eventLogTailSeq(path, event.runId, now) + 1
      if (!Number.isSafeInteger(event.seq) || event.seq !== expectedSeq) {
        throw new Error(`DAG event seq must be strictly increasing: expected ${expectedSeq}, received ${event.seq}`)
      }
      fs.mkdirSync(dirname(path), { recursive: true })
      const fd = fs.openSync(path, "a")
      try {
        fs.writeSync(fd, `${JSON.stringify(event)}\n`)
        if (fsyncWrites) fs.fsyncSync(fd)
      } finally {
        fs.closeSync(fd)
      }
    },
    readEvents(runId, sinceSeqExclusive, readOptions) {
      assertSafeSegment(runId, "run id")
      if (!Number.isInteger(readOptions.limit) || readOptions.limit <= 0) {
        throw new Error("event page limit must be a positive integer")
      }
      const path = paths.event(runId)
      if (!fs.existsSync(path)) {
        return { events: [], nextSinceSeq: sinceSeqExclusive, headSeq: 0, hasMore: false }
      }
      inspectEventLog(path, runId, diagnosticLog, recoveredPaths, now)
      const wantedTypes = readOptions.types === undefined ? undefined : new Set(readOptions.types)
      const events: DagRunEvent[] = []
      let headSeq = 0
      let hasMore = false
      forEachJsonLine(path, (value) => {
        const event = parseEvent(value, path, runId, now)
        headSeq = Math.max(headSeq, event.seq)
        if (event.seq <= sinceSeqExclusive) return
        if (readOptions.throughSeq !== undefined && event.seq > readOptions.throughSeq) return
        if (readOptions.lane !== undefined && event.lane !== readOptions.lane) return
        if (wantedTypes !== undefined && !wantedTypes.has(event.type)) return
        if (events.length < readOptions.limit) events.push(event)
        else hasMore = true
      })
      return {
        events,
        nextSinceSeq: events.at(-1)?.seq ?? sinceSeqExclusive,
        headSeq,
        hasMore,
      }
    },
    writeCheckpoint(runId, checkpoint) {
      assertSafeSegment(runId, "run id")
      assertSupportedSchema(checkpoint, paths.run(runId), runId, now)
      writeCheckpointWithinSessionLimit(
        paths,
        runId,
        checkpoint,
        maxRunsPerSession,
        platform,
        fsyncWrites,
        isProcessAlive,
        now,
      )
    },
    readCheckpoint<T extends object>(runId: DagRunId): T | null {
      assertSafeSegment(runId, "run id")
      const path = paths.run(runId)
      const value = readJsonFile(path, runId, now)
      if (value === null) return null
      assertSupportedSchema(value, path, runId, now)
      return value as T
    },
    writeKey(record) {
      assertSupportedSchema(record, paths.key(record.parentSessionId, record.runKey), record.runId, now)
      const path = paths.key(record.parentSessionId, record.runKey)
      writeJsonAtomic(path, record, platform, fsyncWrites)
      return path
    },
    readKey(parentSessionId, runKey) {
      const path = paths.key(parentSessionId, runKey)
      const value = readJsonFile(path)
      if (value === null) return null
      const runId = readOptionalString(value, "runId") as DagRunId | undefined
      assertSupportedSchema(value, path, runId, now)
      return value as DagKeyRecord
    },
    writeResult(runId, nodeId, result) {
      assertSafeSegment(runId, "run id")
      assertSafeSegment(nodeId, "node id")
      const path = paths.result(runId, nodeId)
      writeFileAtomic(path, result, platform, fsyncWrites)
      return path
    },
    readResult(runId, nodeId) {
      assertSafeSegment(runId, "run id")
      assertSafeSegment(nodeId, "node id")
      try {
        return fs.readFileSync(paths.result(runId, nodeId), "utf8")
      } catch (error) {
        if (hasCode(error, "ENOENT")) return null
        throw error
      }
    },
    withRunLock(runId, operation) {
      assertSafeSegment(runId, "run id")
      return withLock(paths.runLock(runId), runId, operation, isProcessAlive, now, fsyncWrites)
    },
    withKeyLock: (parentSessionId, runKey, operation) => withLock(
      paths.keyLock(parentSessionId, runKey), undefined, operation, isProcessAlive, now, fsyncWrites,
    ),
    withTaskOwnerLock: (taskOwner, runId, operation) => withLock(
      paths.taskOwnerLock(taskOwner), runId, operation, isProcessAlive, now, fsyncWrites,
    ),
    pruneExpired(pruneNow = now()) {
      const cutoff = pruneNow - retentionDays * 24 * 60 * 60 * 1000
      const pruned: DagRunId[] = []
      for (const entry of fs.readdirSync(paths.runs, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue
        const path = join(paths.runs, entry.name)
        const value = readJsonFile(path, entry.name.slice(0, -5) as DagRunId, now)
        if (value === null) continue
        const checkpoint = value as RetentionCheckpoint
        const runId = checkpoint.runId ?? entry.name.slice(0, -5) as DagRunId
        assertSupportedSchema(checkpoint, path, runId, now)
        if (checkpoint.status === undefined || !TERMINAL_STATUSES.has(checkpoint.status)) continue
        const terminalAt = checkpoint.completedAt ?? checkpoint.updatedAt
        if (terminalAt === undefined || Date.parse(terminalAt) > cutoff) continue
        pruneRunArtifacts(paths, checkpoint, runId)
        pruned.push(runId)
      }
      return pruned
    },
  }
  return store
}

function createPaths(stateDir: string): DagStorePaths {
  const root = join(stateDir, "dag")
  const keys = join(root, "keys")
  const runs = join(root, "runs")
  const events = join(root, "events")
  const results = join(root, "results")
  const locks = join(root, "locks")
  return {
    root,
    keys,
    runs,
    events,
    results,
    locks,
    key: (parentSessionId, runKey) => join(keys, `${dagKeyHash(parentSessionId, runKey)}.json`),
    run: (runId) => join(runs, `${runId}.json`),
    event: (runId) => join(events, `${runId}.jsonl`),
    result: (runId, nodeId) => join(results, runId, `${nodeId}.txt`),
    runLock: (runId) => join(locks, `${runId}.lock`),
    keyLock: (parentSessionId, runKey) => join(locks, `key-${dagKeyHash(parentSessionId, runKey)}.lock`),
    taskOwnerLock: (taskOwner) => join(locks, `task-owner-${sha256(taskOwner)}.lock`),
  }
}

function writeCheckpointWithinSessionLimit(
  paths: DagStorePaths,
  runId: DagRunId,
  checkpoint: object,
  maxRunsPerSession: number,
  platform: NodeJS.Platform,
  fsyncWrites: boolean,
  isProcessAlive: (pid: number) => boolean,
  now: () => number,
): void {
  const path = paths.run(runId)
  const parentSessionId = readOptionalString(checkpoint, "parentSessionId")
  if (parentSessionId === undefined || fs.existsSync(path)) {
    writeJsonAtomic(path, checkpoint, platform, fsyncWrites)
    return
  }
  const capacityLock = join(paths.locks, `session-runs-${sha256(parentSessionId)}.lock`)
  withLock(capacityLock, undefined, () => {
    if (fs.existsSync(path)) {
      writeJsonAtomic(path, checkpoint, platform, fsyncWrites)
      return
    }
    let runCount = 0
    for (const entry of fs.readdirSync(paths.runs, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue
      const existingRunId = entry.name.slice(0, -5) as DagRunId
      const existingPath = join(paths.runs, entry.name)
      const existing = readJsonFile(existingPath, existingRunId, now)
      if (existing === null) continue
      assertSupportedSchema(existing, existingPath, existingRunId, now)
      if (readOptionalString(existing, "parentSessionId") === parentSessionId) runCount += 1
    }
    if (runCount >= maxRunsPerSession) {
      fs.rmSync(join(paths.root, "skills", `${runId}.json`), { force: true })
      throw new Error(`DAG session run limit reached: ${maxRunsPerSession}`)
    }
    writeJsonAtomic(path, checkpoint, platform, fsyncWrites)
  }, isProcessAlive, now, fsyncWrites)
}

function writeJsonAtomic(path: string, value: object, platform: NodeJS.Platform, fsyncWrites: boolean): void {
  writeFileAtomic(path, JSON.stringify(value), platform, fsyncWrites)
}

function writeFileAtomic(path: string, content: string, platform: NodeJS.Platform, fsyncWrites: boolean): void {
  fs.mkdirSync(dirname(path), { recursive: true })
  const tmpPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  let fd: number | undefined
  try {
    fd = fs.openSync(tmpPath, "wx")
    fs.writeSync(fd, content)
    if (fsyncWrites) fs.fsyncSync(fd)
    fs.closeSync(fd)
    fd = undefined
    fs.renameSync(tmpPath, path)
    if (fsyncWrites) fsyncParentDirectoryAfterRename(path, platform)
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
    fs.rmSync(tmpPath, { force: true })
  }
}

function fsyncParentDirectoryAfterRename(path: string, platform: NodeJS.Platform): void {
  // Directory fsync makes the rename durable on POSIX. Windows rejects fsync on directory handles
  // with EPERM, and its MoveFileEx-backed rename uses different durability semantics.
  if (platform === "win32") return
  const directoryFd = fs.openSync(dirname(path), "r")
  try {
    fs.fsyncSync(directoryFd)
  } finally {
    fs.closeSync(directoryFd)
  }
}

function eventLogTailSeq(path: string, runId: DagRunId, now: () => number): number {
  let tailSeq = 0
  forEachJsonLine(path, (value) => {
    tailSeq = parseEvent(value, path, runId, now).seq
  })
  return tailSeq
}

function inspectExistingEventLogs(
  paths: DagStorePaths,
  diagnostics: DagStoreDiagnostic[],
  recoveredPaths: Set<string>,
  now: () => number,
): void {
  for (const entry of fs.readdirSync(paths.events, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue
    const runId = entry.name.slice(0, -6) as DagRunId
    inspectEventLog(join(paths.events, entry.name), runId, diagnostics, recoveredPaths, now)
  }
}

function inspectEventLog(
  path: string,
  runId: DagRunId,
  diagnostics: DagStoreDiagnostic[],
  recoveredPaths: Set<string>,
  now: () => number,
): void {
  let lastCompleteOffset = 0
  let trailing: Buffer = Buffer.alloc(0)
  let hasTrailing = false
  forEachRawLine(path, (line, endOffset, complete) => {
    if (!complete) {
      trailing = line
      hasTrailing = true
      return
    }
    parseEventJson(line.toString("utf8"), path, runId, now)
    lastCompleteOffset = endOffset
  })
  if (!hasTrailing || trailing.length === 0) return
  try {
    parseEventJson(trailing.toString("utf8"), path, runId, now)
  } catch (error) {
    if (error instanceof DagJournalCorruptError && error.diagnostic.message.includes("schemaVersion")) throw error
    fs.truncateSync(path, lastCompleteOffset)
    if (!recoveredPaths.has(path)) {
      recoveredPaths.add(path)
      diagnostics.push({
        kind: "event_log_recovered",
        runId,
        path,
        message: "discarded malformed trailing JSONL fragment",
        at: new Date(now()).toISOString(),
      })
    }
  }
}

function forEachJsonLine(path: string, visit: (value: unknown) => void): void {
  forEachRawLine(path, (line, _endOffset, complete) => {
    if (!complete && line.length === 0) return
    visit(parseJson(line.toString("utf8"), path))
  })
}

function forEachRawLine(
  path: string,
  visit: (line: Buffer, endOffset: number, complete: boolean) => void,
): void {
  if (!fs.existsSync(path)) return
  const fd = fs.openSync(path, "r")
  const buffer = Buffer.allocUnsafe(READ_BUFFER_BYTES)
  let pending: Buffer[] = []
  let offset = 0
  try {
    for (;;) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null)
      if (bytesRead === 0) break
      let start = 0
      for (let index = 0; index < bytesRead; index += 1) {
        if (buffer[index] !== 10) continue
        pending.push(Buffer.from(buffer.subarray(start, index)))
        offset += index - start + 1
        visit(Buffer.concat(pending), offset, true)
        pending = []
        start = index + 1
      }
      if (start < bytesRead) {
        pending.push(Buffer.from(buffer.subarray(start, bytesRead)))
        offset += bytesRead - start
      }
    }
    if (pending.length > 0) visit(Buffer.concat(pending), offset, false)
  } finally {
    fs.closeSync(fd)
  }
}

function parseEventJson(text: string, path: string, runId: DagRunId, now: () => number): DagRunEvent {
  return parseEvent(parseJson(text, path, runId, now), path, runId, now)
}

function parseEvent(value: unknown, path: string, runId: DagRunId, now: () => number): DagRunEvent {
  assertSupportedSchema(value, path, runId, now)
  if (!isRecord(value) || typeof value.seq !== "number" || typeof value.type !== "string") {
    throw corrupt(path, runId, "invalid DAG event envelope", now)
  }
  return value as DagRunEvent
}

function parseJson(text: string, path: string, runId?: DagRunId, now: () => number = Date.now): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw corrupt(path, runId, `malformed JSON: ${error instanceof Error ? error.message : String(error)}`, now)
  }
}

function readJsonFile(path: string, runId?: DagRunId, now: () => number = Date.now): unknown | null {
  try {
    return parseJson(fs.readFileSync(path, "utf8"), path, runId, now)
  } catch (error) {
    if (hasCode(error, "ENOENT")) return null
    throw error
  }
}

function assertSupportedSchema(value: unknown, path: string, runId: DagRunId | undefined, now: () => number): void {
  if (!isRecord(value) || typeof value.schemaVersion !== "number") {
    throw corrupt(path, runId, "missing schemaVersion", now)
  }
  if (value.schemaVersion !== SCHEMA_VERSION) {
    throw corrupt(path, runId, `unsupported schemaVersion ${value.schemaVersion}`, now)
  }
}

function corrupt(path: string, runId: DagRunId | undefined, message: string, now: () => number): DagJournalCorruptError {
  return new DagJournalCorruptError({
    kind: "journal_corrupt",
    ...(runId === undefined ? {} : { runId }),
    path,
    message,
    at: new Date(now()).toISOString(),
  })
}

function withLock<T>(
  path: string,
  runId: DagRunId | undefined,
  operation: () => T,
  isProcessAlive: (pid: number) => boolean,
  now: () => number,
  fsyncWrites: boolean,
): T {
  assertSafeSegment(basename(path), "lock name")
  const startedAt = now()
  let acquiredHolder: LockHolder | undefined
  for (;;) {
    const content = JSON.stringify({
      hostPid: process.pid,
      runId,
      token: randomUUID(),
      createdAt: new Date(now()).toISOString(),
    })
    if (tryCreateLock(path, content, fsyncWrites)) {
      acquiredHolder = { pid: process.pid, content }
      break
    }
    const observedHolder = readLockHolder(path)
    if (observedHolder === undefined) continue
    if (observedHolder.pid === undefined || !isProcessAlive(observedHolder.pid)) {
      const reclaimedHolder = reclaimObservedLock(path, observedHolder, isProcessAlive, runId, now, fsyncWrites)
      if (reclaimedHolder !== undefined) {
        acquiredHolder = reclaimedHolder
        break
      }
      if (now() - startedAt >= LOCK_WAIT_TIMEOUT_MS) throw new Error(`Timed out acquiring DAG lock: ${path}`)
      Atomics.wait(sleeper, 0, 0, LOCK_RETRY_MS)
      continue
    }
    if (now() - startedAt >= LOCK_WAIT_TIMEOUT_MS) throw new Error(`Timed out acquiring DAG lock: ${path}`)
    Atomics.wait(sleeper, 0, 0, LOCK_RETRY_MS)
  }
  if (acquiredHolder === undefined) throw new Error(`Failed to acquire DAG lock: ${path}`)
  try {
    return operation()
  } finally {
    removeObservedLock(path, acquiredHolder, () => true)
  }
}

type LockHolder = {
  readonly pid: number | undefined
  readonly content: string
}

function readLockHolder(path: string): LockHolder | undefined {
  try {
    const content = fs.readFileSync(path, "utf8")
    try {
      const value = JSON.parse(content) as unknown
      if (isRecord(value) && typeof value.hostPid === "number") return { pid: value.hostPid, content }
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
    }
    const firstLine = content.split("\n", 1)[0]
    const pid = Number(firstLine)
    return { pid: Number.isInteger(pid) && pid > 0 ? pid : undefined, content }
  } catch (error) {
    if (hasCode(error, "ENOENT")) return undefined
    throw error
  }
}

function sameLockHolder(left: LockHolder | undefined, right: LockHolder | undefined): boolean {
  if (left === undefined || right === undefined) return left === right
  return left.pid === right.pid && left.content === right.content
}

// Windows can refuse hard links outright (EPERM/EACCES on NTFS ACLs, ReFS, and network shares)
// even though the target is vacant. Publishing the lock exclusively with "wx" is equally atomic:
// the OS rejects the second creator with EEXIST, which is the contention answer callers expect.
function publishLockExclusively(path: string, content: string, fsyncWrites: boolean): boolean {
  let fd: number | undefined
  try {
    fd = fs.openSync(path, "wx")
    fs.writeSync(fd, content)
    if (fsyncWrites) fs.fsyncSync(fd)
    return true
  } catch (error) {
    if (hasCode(error, "EEXIST")) return false
    throw error
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

function tryCreateLock(path: string, content: string, fsyncWrites: boolean): boolean {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  let fd: number | undefined
  try {
    fd = fs.openSync(temporaryPath, "wx")
    fs.writeSync(fd, content)
    if (fsyncWrites) fs.fsyncSync(fd)
    fs.closeSync(fd)
    fd = undefined
    fs.linkSync(temporaryPath, path)
    return true
  } catch (error) {
    if (hasCode(error, "EEXIST")) return false
    if (hasCode(error, "EPERM") || hasCode(error, "EACCES")) {
      return publishLockExclusively(path, content, fsyncWrites)
    }
    throw error
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
    fs.rmSync(temporaryPath, { force: true })
  }
}

function reclaimObservedLock(
  path: string,
  observedHolder: LockHolder,
  isProcessAlive: (pid: number) => boolean,
  runId: DagRunId | undefined,
  now: () => number,
  fsyncWrites: boolean,
): LockHolder | undefined {
  const reclaimPath = `${path}.reclaim`
  const reclaimHolder = tryAcquireReclaimMutex(reclaimPath, isProcessAlive, now, fsyncWrites)
  if (reclaimHolder === undefined) return undefined
  const content = JSON.stringify({
    hostPid: process.pid,
    runId,
    token: randomUUID(),
    createdAt: new Date(now()).toISOString(),
  })
  const successorPath = `${path}.${process.pid}.${randomUUID()}.successor`
  let fd: number | undefined
  try {
    fd = fs.openSync(successorPath, "wx")
    fs.writeSync(fd, content)
    if (fsyncWrites) fs.fsyncSync(fd)
    fs.closeSync(fd)
    fd = undefined
    const currentHolder = readLockHolder(path)
    if (currentHolder === undefined || !sameLockHolder(observedHolder, currentHolder) ||
      (currentHolder.pid !== undefined && isProcessAlive(currentHolder.pid))) {
      return undefined
    }
    fs.renameSync(successorPath, path)
    return { pid: process.pid, content }
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
    fs.rmSync(successorPath, { force: true })
    removeObservedLock(reclaimPath, reclaimHolder, () => true)
  }
}

function tryAcquireReclaimMutex(
  path: string,
  isProcessAlive: (pid: number) => boolean,
  now: () => number,
  fsyncWrites: boolean,
): LockHolder | undefined {
  const content = JSON.stringify({
    hostPid: process.pid,
    token: randomUUID(),
    createdAt: new Date(now()).toISOString(),
  })
  if (tryCreateLock(path, content, fsyncWrites)) return { pid: process.pid, content }
  const observedHolder = readLockHolder(path)
  if (observedHolder !== undefined &&
    (observedHolder.pid === undefined || !isProcessAlive(observedHolder.pid))) {
    removeObservedLock(
      path,
      observedHolder,
      (movedHolder) => movedHolder === undefined || movedHolder.pid === undefined || !isProcessAlive(movedHolder.pid),
    )
  }
  return undefined
}

function removeObservedLock(
  path: string,
  observedHolder: LockHolder | undefined,
  canRemove: (movedHolder: LockHolder | undefined) => boolean,
): boolean {
  if (!sameLockHolder(observedHolder, readLockHolder(path))) return false
  const quarantinePath = `${path}.${process.pid}.${randomUUID()}.stale`
  try {
    fs.renameSync(path, quarantinePath)
  } catch (error) {
    if (hasCode(error, "ENOENT")) return false
    throw error
  }
  const movedHolder = readLockHolder(quarantinePath)
  if (!sameLockHolder(observedHolder, movedHolder) || !canRemove(movedHolder)) {
    restoreQuarantinedLock(path, quarantinePath)
    return false
  }
  fs.rmSync(quarantinePath, { force: true })
  return true
}

function restoreQuarantinedLock(path: string, quarantinePath: string): void {
  try {
    fs.linkSync(quarantinePath, path)
  } catch (error) {
    if (!hasCode(error, "EEXIST")) throw error
  }
  fs.rmSync(quarantinePath, { force: true })
}

function pruneRunArtifacts(paths: DagStorePaths, checkpoint: RetentionCheckpoint, runId: DagRunId): void {
  fs.rmSync(paths.event(runId), { force: true })
  fs.rmSync(join(paths.results, runId), { recursive: true, force: true })
  fs.rmSync(join(paths.root, "skills", `${runId}.json`), { force: true })
  fs.rmSync(paths.runLock(runId), { force: true })
  for (const entry of fs.readdirSync(paths.keys, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue
    const keyPath = join(paths.keys, entry.name)
    const value = readJsonFile(keyPath)
    if (!isRecord(value) || value.runId !== runId) continue
    fs.rmSync(keyPath, { force: true })
    fs.rmSync(join(paths.locks, `key-${entry.name.slice(0, -5)}.lock`), { force: true })
  }
  for (const node of checkpoint.nodes ?? []) {
    if (node.taskId !== undefined) fs.rmSync(paths.taskOwnerLock(node.taskId), { force: true })
  }
  for (const entry of fs.readdirSync(paths.locks, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".lock")) continue
    const lockPath = join(paths.locks, entry.name)
    try {
      const value = JSON.parse(fs.readFileSync(lockPath, "utf8")) as unknown
      if (isRecord(value) && value.runId === runId) fs.rmSync(lockPath, { force: true })
    } catch (error) {
      if (!hasCode(error, "ENOENT") && !(error instanceof SyntaxError)) throw error
    }
  }
  fs.rmSync(paths.run(runId), { force: true })
}

function assertSafeSegment(value: string, label: string): void {
  if (value.length === 0 || value === "." || value === ".." || value.includes("/") || value.includes("\\") || value.includes("\0")) {
    throw new Error(`Invalid ${label}`)
  }
}

function readOptionalString(value: unknown, key: string): string | undefined {
  return isRecord(value) && typeof value[key] === "string" ? value[key] : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function hasCode(error: unknown, expected: string): boolean {
  return error instanceof Error && "code" in error && error.code === expected
}

import { randomUUID } from "node:crypto"
import { appendFile, mkdir, readFile, rename, writeFile } from "../fs/resilient"
import { join } from "node:path"

import {
  captureCursorSnapshot,
  deriveState,
  finalizeCursor,
  initialReflectionState,
  reflectedThroughByteOffset,
  type ReflectionSnapshot, type ReflectionTranscriptState,
} from "./cursor"
import {
  projectTranscriptEntries,
  type TranscriptEntry,
  type TranscriptProjection,
} from "./entries"
import { withLocalJournalLock, JournalLockTimeoutError, type JournalLock } from "./lock"
import { syncJournalDirectory, syncJournalFile } from "./fsync"

export { withLocalJournalLock, JournalLockTimeoutError, type JournalLock }

export type TranscriptJournalOptions = {
  readonly journalDir: string
  readonly now?: () => Date
  readonly lock?: JournalLock
}

export type AppendResult = { readonly appended: number; readonly skipped: number }

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}

function isTranscriptEntry(value: unknown): value is TranscriptEntry {
  if (!value || typeof value !== "object") return false
  const row = value as Record<string, unknown>
  if (
    typeof row.kind !== "string" ||
    typeof row.captured_at !== "string" ||
    typeof row.source_line_id !== "string" ||
    typeof row.source_message_id !== "string"
  ) return false
  if (row.kind === "tool_call") return true
  return (
    (row.kind === "user" || row.kind === "assistant" || row.kind === "reasoning" || row.kind === "error") &&
    typeof row.text === "string"
  )
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0
}

function optionalNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined
}

function parseState(raw: string | null): ReflectionTranscriptState {
  if (raw === null) return initialReflectionState()
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return initialReflectionState()
    const state = parsed as Record<string, unknown>
    const reflectedThroughByteOffset = optionalNonNegativeInteger(state.reflected_through_byte_offset)
    return {
      schema_version: "v3_assistant_steps",
      reflected_through_message_id: optionalString(state.reflected_through_message_id),
      ...(reflectedThroughByteOffset === undefined ? {} : { reflected_through_byte_offset: reflectedThroughByteOffset }),
      total_completed_steps: nonNegativeInteger(state.total_completed_steps),
      reflected_completed_steps: nonNegativeInteger(state.reflected_completed_steps),
      steps_since_last_successful_reflection: nonNegativeInteger(
        state.steps_since_last_successful_reflection,
      ),
      last_reflection_started_at: optionalString(state.last_reflection_started_at),
      last_reflection_succeeded_at: optionalString(state.last_reflection_succeeded_at),
      pending_compaction:
        typeof state.pending_compaction === "boolean" ? state.pending_compaction : undefined,
    }
  } catch {
    return initialReflectionState()
  }
}

export class TranscriptJournal {
  readonly transcriptPath: string
  readonly statePath: string
  readonly lockPath: string
  private readonly now: () => Date
  private readonly lock: JournalLock

  constructor(readonly options: TranscriptJournalOptions) {
    this.transcriptPath = join(options.journalDir, "transcript.jsonl")
    this.statePath = join(options.journalDir, "state.json")
    this.lockPath = join(options.journalDir, "state.lock")
    this.now = options.now ?? (() => new Date())
    this.lock = options.lock ?? withLocalJournalLock
  }

  async reconcile(messages: readonly TranscriptProjection[]): Promise<AppendResult> {
    return this.locked(async () => {
      const capturedAt = this.now().toISOString()
      return this.appendUnlocked(
        messages.flatMap((message) => projectTranscriptEntries(message, capturedAt)),
      )
    })
  }

  async append(entries: readonly TranscriptEntry[]): Promise<AppendResult> {
    return this.locked(() => this.appendUnlocked(entries))
  }

  async readEntries(): Promise<TranscriptEntry[]> {
    return this.locked(() => this.readEntriesUnlocked())
  }

  async getState(): Promise<ReflectionTranscriptState> {
    return this.locked(async () => {
      const entries = await this.readEntriesUnlocked()
      const state = deriveState(await this.readStateUnlocked(), entries)
      await this.writeStateUnlocked(state, entries)
      return state
    })
  }

  async setPendingCompaction(pending: boolean): Promise<void> {
    await this.locked(async () => {
      const entries = await this.readEntriesUnlocked()
      const state = { ...(await this.readStateUnlocked()), pending_compaction: pending }
      await this.writeStateUnlocked(state, entries)
    })
  }

  async captureReflectionSnapshot(signal?: AbortSignal): Promise<ReflectionSnapshot | null> {
    return this.locked(async () => {
      const entries = await this.readEntriesUnlocked()
      const state = deriveState(await this.readStateUnlocked(), entries)
      const snapshot = captureCursorSnapshot(entries, state)
      if (snapshot === null) return null
      signal?.throwIfAborted()
      await this.writeStateUnlocked(
        { ...state, last_reflection_started_at: this.now().toISOString() },
        entries,
      )
      return snapshot
    }, signal)
  }

  /**
   * Makes the journal durable WITHOUT the state lock (IC-11). Locking is unnecessary here —
   * transcript.jsonl is append-only and state.json is published by atomic rename, so fsync
   * races no writer — and it is harmful: the shutdown drain that calls this owns a 1500ms
   * budget, while the lock's acquisition wait alone is 5000ms, so a scanner holding state.lock
   * used to exhaust the whole drain. The signal is re-checked before each fsync so an aborted
   * flush STARTS no further I/O once the drain has returned.
   */
  async flush(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    // Read through a call so the check is re-evaluated after every await: abort can fire
    // between two fsyncs, which a narrowed property read would miss.
    const aborted = (): boolean => signal?.aborted ?? false
    await syncJournalFile(this.transcriptPath)
    if (aborted()) return
    await syncJournalFile(this.statePath)
    if (aborted()) return
    await syncJournalDirectory(this.options.journalDir)
  }

  /**
   * Lock-free tolerant read for identity-wide scanners (dream selection): never touches
   * state.lock, never creates files, and skips rows that do not parse — a torn trailing line
   * from a concurrent append is expected under a snapshot read, not corruption. Correctness
   * paths (reconcile, reflection cursors) keep using the locked readEntries().
   */
  async readEntriesSnapshot(): Promise<TranscriptEntry[]> {
    let raw: string
    try {
      raw = await readFile(this.transcriptPath, "utf8")
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error
      return []
    }
    const entries: TranscriptEntry[] = []
    for (const line of raw.split("\n")) {
      if (line.trim().length === 0) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch (error) {
        if (error instanceof SyntaxError) continue
        throw error
      }
      if (isTranscriptEntry(parsed)) entries.push(parsed)
    }
    return entries
  }

  async backfillReflectionByteOffset(entries: readonly TranscriptEntry[]): Promise<ReflectionTranscriptState> {
    const state = await this.readStateUnlocked()
    await this.writeStateUnlocked({
      ...state,
      reflected_through_byte_offset: state.reflected_through_byte_offset
        ?? (state.reflected_through_message_id === undefined
          ? 0
          : reflectedThroughByteOffset(entries, state.reflected_through_message_id)),
    }, entries)
    return this.readStateUnlocked()
  }

  async finalizeReflection(snapshot: ReflectionSnapshot, success: boolean): Promise<void> {
    await this.locked(async () => {
      const entries = await this.readEntriesUnlocked()
      const state = deriveState(await this.readStateUnlocked(), entries)
      await this.writeStateUnlocked(
        finalizeCursor(state, entries, snapshot, success, this.now().toISOString()),
        entries,
      )
    })
  }

  private async locked<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted()
    await mkdir(this.options.journalDir, { recursive: true, mode: 0o700 })
    return this.lock(this.lockPath, task, signal)
  }

  private async appendUnlocked(entries: readonly TranscriptEntry[]): Promise<AppendResult> {
    const existing = await this.readEntriesUnlocked()
    const sourceIds = new Set(existing.map((entry) => entry.source_line_id))
    const fresh: TranscriptEntry[] = []
    let skipped = 0
    for (const entry of entries) {
      if (sourceIds.has(entry.source_line_id)) {
        skipped += 1
      } else {
        sourceIds.add(entry.source_line_id)
        fresh.push(entry)
      }
    }
    if (fresh.length > 0) {
      await appendFile(
        this.transcriptPath,
        `${fresh.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
        "utf8",
      )
    }
    const allEntries = [...existing, ...fresh]
    await this.writeStateUnlocked(await this.readStateUnlocked(), allEntries)
    return { appended: fresh.length, skipped }
  }

  private async readEntriesUnlocked(): Promise<TranscriptEntry[]> {
    let raw: string
    try {
      raw = await readFile(this.transcriptPath, "utf8")
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error
      await writeFile(this.transcriptPath, "", { encoding: "utf8", flag: "a" })
      return []
    }
    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        const parsed: unknown = JSON.parse(line)
        if (!isTranscriptEntry(parsed)) throw new Error("Invalid transcript journal row")
        return parsed
      })
  }

  private async readStateUnlocked(): Promise<ReflectionTranscriptState> {
    try {
      return parseState(await readFile(this.statePath, "utf8"))
    } catch (error) {
      if (errorCode(error) === "ENOENT") return initialReflectionState()
      throw error
    }
  }

  private async writeStateUnlocked(
    state: ReflectionTranscriptState,
    entries: readonly TranscriptEntry[],
  ): Promise<void> {
    const derived = deriveState({
      ...state,
      ...(state.reflected_through_message_id !== undefined && state.reflected_through_byte_offset === undefined
        ? { reflected_through_byte_offset: reflectedThroughByteOffset(entries, state.reflected_through_message_id) }
        : {}),
    }, entries)
    const temporaryPath = `${this.statePath}.tmp-${randomUUID()}`
    await writeFile(temporaryPath, `${JSON.stringify(derived, null, 2)}\n`, "utf8")
    await rename(temporaryPath, this.statePath)
  }
}

import {
  MAX_IMPORTED_TRANSCRIPT_BYTES,
  MAX_IMPORT_HISTORY_BYTES,
  MAX_IMPORT_RECORD_BYTES,
  TRANSCRIPT_PREFIX_BYTES,
} from "./constants"
import type { SessionHistoryFile, SessionHistoryFileStats, SessionHistoryFs } from "./session-history-fs"
import { decodeTranscriptLine, shouldRetainDecodedRecord, type TranscriptRecord } from "./transcript-records"
import type { AgentSessionSource, TranscriptSource } from "./types"

export type TranscriptIdentity = Omit<TranscriptSource, "provider" | "homePath" | "providerSessionId">

export function transcriptIdentity(filePath: string, stats: SessionHistoryFileStats): TranscriptIdentity {
  return { filePath, size: stats.size, mtimeMs: stats.mtimeMs, device: stats.dev, inode: stats.ino, birthtimeMs: stats.birthtimeMs }
}

export function sameTranscriptIdentity(left: TranscriptIdentity, right: TranscriptIdentity): boolean {
  return (
    left.filePath === right.filePath &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.device === right.device &&
    left.inode === right.inode &&
    left.birthtimeMs === right.birthtimeMs
  )
}

class HistoryBudgetExceeded extends Error {}

class RecordAccumulator {
  readonly records: Array<TranscriptRecord> = []
  recordCount = 0
  private chunks: Array<Uint8Array> = []
  private pendingBytes = 0
  private oversized = false
  private historyBytes = 0

  constructor(
    private readonly source: AgentSessionSource,
    private readonly recordLimit: number,
  ) {}

  get started(): boolean {
    return this.pendingBytes > 0 || this.oversized
  }

  append(segment: Uint8Array): void {
    if (this.oversized || segment.byteLength === 0) return
    this.pendingBytes += segment.byteLength
    if (this.pendingBytes > MAX_IMPORT_RECORD_BYTES) {
      // A record past the cap (a screenshot tool result, a pasted log) is skipped whole, never buffered.
      this.oversized = true
      this.chunks = []
      return
    }
    this.chunks.push(segment.slice())
  }

  /** False once the transcript holds more records than the caller's remaining budget. */
  finish(): boolean {
    this.recordCount += 1
    if (this.recordCount > this.recordLimit) return false
    if (!this.oversized && this.pendingBytes > 0) {
      const line = new TextDecoder().decode(Buffer.concat(this.chunks))
      const decoded = decodeTranscriptLine(line, this.source)
      if (decoded !== null && shouldRetainDecodedRecord(this.source, decoded)) {
        this.historyBytes += JSON.stringify(decoded).length * 2
        if (this.historyBytes > MAX_IMPORT_HISTORY_BYTES) throw new HistoryBudgetExceeded()
        this.records.push(decoded)
      }
    }
    this.chunks = []
    this.pendingBytes = 0
    this.oversized = false
    return true
  }
}

async function readRecords(
  file: SessionHistoryFile,
  expected: TranscriptIdentity,
  accumulator: RecordAccumulator,
): Promise<boolean> {
  let bytesRead = 0
  while (bytesRead < expected.size) {
    const next = await file.read(Math.min(TRANSCRIPT_PREFIX_BYTES, expected.size - bytesRead))
    if (next === null) return false
    bytesRead += next.byteLength
    let start = 0
    while (start < next.byteLength) {
      const newline = next.indexOf(10, start)
      const end = newline === -1 ? next.byteLength : newline
      accumulator.append(next.subarray(start, end))
      if (newline === -1) break
      if (!accumulator.finish()) return false
      start = newline + 1
    }
  }
  return !accumulator.started || accumulator.finish()
}

/**
 * Stream one transcript into its retained records. The file identity is checked on both sides of the
 * read, and any budget failure rejects the whole transcript before anything is imported.
 */
export async function readTranscriptRecords(
  fs: SessionHistoryFs,
  expected: TranscriptIdentity,
  recordLimit: number,
  source: AgentSessionSource,
): Promise<{ readonly records: ReadonlyArray<TranscriptRecord>; readonly recordCount: number } | null> {
  if (expected.size > MAX_IMPORTED_TRANSCRIPT_BYTES) return null
  let file: SessionHistoryFile
  try {
    file = await fs.open(expected.filePath)
  } catch {
    return null
  }
  try {
    if (!sameTranscriptIdentity(expected, transcriptIdentity(expected.filePath, await file.stat()))) return null
    const accumulator = new RecordAccumulator(source, recordLimit)
    if (!(await readRecords(file, expected, accumulator))) return null
    if (!sameTranscriptIdentity(expected, transcriptIdentity(expected.filePath, await file.stat()))) return null
    return { records: accumulator.records, recordCount: accumulator.recordCount }
  } catch {
    return null
  } finally {
    await file.close().catch(() => undefined)
  }
}

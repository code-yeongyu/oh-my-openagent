import {
  MAX_METADATA_RECORDS_PER_TRANSCRIPT,
  MAX_TRANSCRIPT_SCAN_BYTES,
  METADATA_READ_BYTES,
} from "./constants"
import type { SessionHistoryFile, SessionHistoryFs } from "./session-history-fs"
import type { TranscriptCandidate } from "./transcript-discovery"
import { extractCwdFromLine } from "./transcript-records"

export interface MetadataReadBudget {
  bytesRemaining: number
  operationsRemaining: number
  recordsRemaining: number
  truncated: boolean
}

export interface CwdGroup {
  readonly cwd: string
  readonly homePath: string
  readonly lastActiveAtMs: number
  readonly transcripts: ReadonlyArray<{ readonly filePath: string; readonly mtimeMs: number }>
}

async function scanForCwd(file: SessionHistoryFile, size: number, budget: MetadataReadBudget): Promise<string | null> {
  const decoder = new TextDecoder()
  let remaining = ""
  let bytesRead = 0
  let recordsRead = 0
  const maxBytes = Math.min(MAX_TRANSCRIPT_SCAN_BYTES, size)
  const reserveRecord = () => {
    if (recordsRead === MAX_METADATA_RECORDS_PER_TRANSCRIPT || budget.recordsRemaining === 0) {
      budget.truncated = true
      return false
    }
    recordsRead += 1
    budget.recordsRemaining -= 1
    return true
  }
  const readLastRecord = () => {
    const record = remaining + decoder.decode()
    return record.length === 0 || !reserveRecord() ? null : extractCwdFromLine(record.trim())
  }
  while (bytesRead < maxBytes) {
    if (budget.bytesRemaining === 0 || budget.operationsRemaining === 0) {
      budget.truncated = true
      return null
    }
    const readSize = Math.min(METADATA_READ_BYTES, maxBytes - bytesRead, budget.bytesRemaining)
    budget.operationsRemaining -= 1
    budget.bytesRemaining -= readSize
    const next = await file.read(readSize)
    if (next === null) return readLastRecord()
    bytesRead += next.byteLength
    remaining += decoder.decode(next, { stream: true })
    const lines = remaining.split("\n")
    remaining = lines.pop() ?? ""
    for (const line of lines) {
      if (!reserveRecord()) return null
      const cwd = extractCwdFromLine(line.trim())
      if (cwd !== null) return cwd
    }
  }
  if (bytesRead < size) {
    budget.truncated = true
    return null
  }
  return readLastRecord()
}

/** A large history snapshot can precede session metadata, so bounded chunks are read until a record names its cwd. */
export async function readTranscriptCwd(
  fs: SessionHistoryFs,
  transcript: TranscriptCandidate,
  budget: MetadataReadBudget,
): Promise<string | null> {
  if (transcript.size === 0) return null
  if (budget.bytesRemaining === 0 || budget.operationsRemaining < 2 || budget.recordsRemaining === 0) {
    budget.truncated = true
    return null
  }
  budget.operationsRemaining -= 1
  let file: SessionHistoryFile
  try {
    file = await fs.open(transcript.filePath)
  } catch {
    return null
  }
  try {
    return await scanForCwd(file, transcript.size, budget)
  } catch {
    return null
  } finally {
    await file.close().catch(() => undefined)
  }
}

export async function groupTranscriptsByCwd(
  fs: SessionHistoryFs,
  transcripts: ReadonlyArray<TranscriptCandidate>,
  budget: MetadataReadBudget,
): Promise<Array<CwdGroup>> {
  const groups = new Map<string, { cwd: string; homePath: string; lastActiveAtMs: number; transcripts: Array<TranscriptCandidate> }>()
  for (const transcript of transcripts) {
    const cwd = await readTranscriptCwd(fs, transcript, budget)
    if (cwd === null) continue
    const key = `${transcript.homePath}\0${cwd}`
    const existing = groups.get(key)
    if (existing) {
      existing.lastActiveAtMs = Math.max(existing.lastActiveAtMs, transcript.mtimeMs)
      existing.transcripts.push(transcript)
    } else {
      groups.set(key, { cwd, homePath: transcript.homePath, lastActiveAtMs: transcript.mtimeMs, transcripts: [transcript] })
    }
  }
  return Array.from(groups.values())
}

import { basename } from "node:path"

import { uniqueHomes } from "./agent-transcripts"
import { MAX_DISCOVERY_OPERATIONS_PER_SOURCE, MAX_IMPORT_RECORDS } from "./constants"
import type { ProjectPathRules } from "./project-paths"
import { buildSessionDigest } from "./session-digest"
import { realPathOr, statOrNull, type SessionHistoryFile, type SessionHistoryFs } from "./session-history-fs"
import { discoverClaudeTranscripts, discoverCodexTranscripts, type TranscriptCandidate } from "./transcript-discovery"
import { parseAgentSessionRecords } from "./transcript-parser"
import { readTranscriptRecords, transcriptIdentity } from "./transcript-reader"
import { extractDecodedCwd } from "./transcript-records"
import type { AgentHome, AgentSessionSource, SessionDigest } from "./types"

function untilAborted<T>(signal: AbortSignal, start: () => Promise<T>, onLate?: (value: T) => void): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  const work = start()
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener("abort", abort, { once: true })
    work.then(
      (value) => {
        signal.removeEventListener("abort", abort)
        if (signal.aborted) onLate?.(value)
        else resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort)
        reject(error)
      },
    )
  })
}

/**
 * The filesystem as seen by a scan that must stop at `signal`: after the abort no call reaches `fs`,
 * and a pending call rejects at once instead of holding the scan. Closing a handle always goes through,
 * and a handle that opens only after the abort is closed rather than leaked.
 */
export function abortableSessionHistoryFs(fs: SessionHistoryFs, signal: AbortSignal): SessionHistoryFs {
  const file = (handle: SessionHistoryFile): SessionHistoryFile => ({
    read: (size) => untilAborted(signal, () => handle.read(size)),
    stat: () => untilAborted(signal, () => handle.stat()),
    close: () => handle.close(),
  })
  return {
    readDirectory: (path) => untilAborted(signal, () => fs.readDirectory(path)),
    stat: (path) => untilAborted(signal, () => fs.stat(path)),
    realPath: (path) => untilAborted(signal, () => fs.realPath(path)),
    readFileString: (path) => untilAborted(signal, () => fs.readFileString(path)),
    open: async (path) =>
      file(await untilAborted(signal, () => fs.open(path), (late) => void late.close().catch(() => undefined))),
  }
}

async function candidates(
  fs: SessionHistoryFs,
  rules: ProjectPathRules,
  homes: ReadonlyArray<AgentHome>,
  signal: AbortSignal,
): Promise<Array<TranscriptCandidate & { readonly source: AgentSessionSource }>> {
  const found: Array<TranscriptCandidate & { readonly source: AgentSessionSource }> = []
  for (const source of ["claudeAgent", "codex"] as const) {
    const discover = source === "claudeAgent" ? discoverClaudeTranscripts : discoverCodexTranscripts
    const sourceHomes = await uniqueHomes(rules, homes, source)
    const budget = Math.floor(MAX_DISCOVERY_OPERATIONS_PER_SOURCE / Math.max(1, sourceHomes.length))
    for (const homePath of sourceHomes) {
      if (signal.aborted) return found
      const discovered = await discover(fs, homePath, budget, signal)
      for (const transcript of discovered.transcripts) found.push({ ...transcript, source })
    }
  }
  return found
}

/**
 * Digests of the newest `limit` recent agent sessions across Claude Code and Codex. Discovery only lists
 * directories and stats files to order them; at most `limit` transcripts are then opened, newest first,
 * so the read cost is bounded by the limit rather than by the size of the history. A transcript that
 * turns out unusable (excluded project, unparsable, a duplicate session) still spends one of those reads.
 * Every filesystem call goes through `signal`: once it aborts nothing more is read and the digests made
 * so far are returned.
 */
export async function newestSessionDigests(input: {
  readonly fs: SessionHistoryFs
  readonly createRules: (fs: SessionHistoryFs) => ProjectPathRules
  readonly homes: ReadonlyArray<AgentHome>
  readonly nowMs: number
  readonly recentWindowMs: number
  readonly limit: number
  readonly signal: AbortSignal
}): Promise<Array<SessionDigest>> {
  const { signal, limit, nowMs } = input
  const fs = abortableSessionHistoryFs(input.fs, signal)
  const rules = input.createRules(fs)
  const cutoffMs = nowMs - input.recentWindowMs
  const recent = (await candidates(fs, rules, input.homes, signal))
    .filter((transcript) => transcript.mtimeMs >= cutoffMs && transcript.mtimeMs <= nowMs)
    .sort((left, right) => right.mtimeMs - left.mtimeMs || left.filePath.localeCompare(right.filePath))
  const digests: Array<SessionDigest> = []
  const sessions = new Set<string>()
  let reads = 0
  let recordsRemaining = MAX_IMPORT_RECORDS
  for (const transcript of recent) {
    if (signal.aborted || reads === limit || digests.length === limit || recordsRemaining === 0) break
    const stats = await statOrNull(fs, transcript.filePath)
    if (stats === null || stats.type !== "File") continue
    reads += 1
    const snapshot = await readTranscriptRecords(fs, transcriptIdentity(transcript.filePath, stats), recordsRemaining, transcript.source)
    if (signal.aborted || snapshot === null) continue
    recordsRemaining -= snapshot.recordCount
    const recordedCwd = snapshot.records.map(extractDecodedCwd).find((cwd) => cwd !== null) ?? null
    const cwd = recordedCwd === null ? null : rules.resolveRecordedPath(recordedCwd)
    if (cwd === null || rules.isExcludedProjectPath(cwd) || rules.isExcludedProjectPath(await realPathOr(fs, cwd))) continue
    const thread = parseAgentSessionRecords(
      { source: transcript.source, fallbackSessionId: basename(transcript.filePath, ".jsonl"), lastActiveAtMs: transcript.mtimeMs },
      snapshot.records,
    )
    if (thread === null) continue
    const key = `${thread.source}\0${thread.providerSessionId}`
    if (sessions.has(key)) continue
    sessions.add(key)
    digests.push(buildSessionDigest({ thread, records: snapshot.records, cwd }))
  }
  return digests
}

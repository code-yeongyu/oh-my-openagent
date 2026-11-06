import { basename } from "node:path"

import { DEFAULT_RECENT_WINDOW_MS, MAX_IMPORTED_TRANSCRIPT_BYTES, MAX_IMPORT_BYTES, MAX_IMPORT_RECORDS, MAX_IMPORT_TRANSCRIPTS } from "./constants"
import type { ProjectPathRules } from "./project-paths"
import { buildSessionDigest } from "./session-digest"
import { realPathOr, statOrNull, type SessionHistoryFs } from "./session-history-fs"
import type { CwdGroup } from "./transcript-cwd"
import { parseAgentSessionRecords } from "./transcript-parser"
import { readTranscriptRecords, sameTranscriptIdentity, transcriptIdentity } from "./transcript-reader"
import { extractDecodedCwd } from "./transcript-records"
import type { AgentSessionSource, CompletedTranscript, RecentSessionOutcome, RecentSessionsQuery, ScanCounts, TranscriptSource } from "./types"

export type SourcedGroup = CwdGroup & { readonly source: AgentSessionSource }

export interface RecentSessionsRun extends AsyncIterable<RecentSessionOutcome> {
  /** Eligible transcripts found, transcripts read, and the per-call read cap; final once iteration ends. */
  counts(): ScanCounts
}

interface Eligible {
  readonly group: SourcedGroup
  readonly filePath: string
  readonly mtimeMs: number
  readonly targetIdentity: string
}

async function eligibleTranscripts(
  fs: SessionHistoryFs,
  rules: ProjectPathRules,
  groups: ReadonlyArray<SourcedGroup>,
  query: RecentSessionsQuery,
  nowMs: number,
): Promise<Array<Eligible>> {
  const root = query.workspaceRoot === undefined ? null : rules.resolveRecordedPath(query.workspaceRoot)
  if (query.workspaceRoot !== undefined) {
    if (root === null || rules.isExcludedProjectPath(root) || rules.isExcludedProjectPath(await realPathOr(fs, root))) return []
  }
  const rootIdentity = root === null ? null : await rules.directoryIdentity(root)
  const cutoffMs = nowMs - (query.recentWindowMs ?? DEFAULT_RECENT_WINDOW_MS)
  const eligible: Array<Eligible> = []
  for (const group of groups) {
    const resolved = rules.resolveRecordedPath(group.cwd)
    if (resolved === null) continue
    if (rootIdentity === null && (rules.isExcludedProjectPath(resolved) || rules.isExcludedProjectPath(await realPathOr(fs, resolved)))) continue
    const identity = await rules.directoryIdentity(resolved)
    if (rootIdentity !== null && identity !== rootIdentity) continue
    for (const transcript of group.transcripts) {
      if (transcript.mtimeMs < cutoffMs || transcript.mtimeMs > nowMs) continue
      eligible.push({ group, filePath: transcript.filePath, mtimeMs: transcript.mtimeMs, targetIdentity: identity })
    }
  }
  return eligible.sort((left, right) => right.mtimeMs - left.mtimeMs || left.filePath.localeCompare(right.filePath))
}

/**
 * Newest-first recent sessions of one project (or every non-excluded project). Each transcript is re-stat'ed
 * and re-read, and its own cwd rechecked, because a file can be replaced after discovery. Reads share the
 * per-call caps of 100 transcripts, 4 GiB and 100,000 records. A transcript still identical to one the caller
 * names as completed is only stat'ed, never read, and does not count against those caps.
 */
export function listRecentSessions(input: {
  readonly fs: SessionHistoryFs
  readonly rules: ProjectPathRules
  readonly groups: () => Promise<ReadonlyArray<SourcedGroup>>
  readonly query: RecentSessionsQuery
  readonly now: () => number
}): RecentSessionsRun {
  const counts = { found: 0, read: 0, cap: MAX_IMPORT_TRANSCRIPTS }
  const { fs, rules } = input
  const completedByFile = new Map<string, Array<CompletedTranscript>>()
  for (const completed of input.query.completed ?? []) {
    const key = `${completed.provider}\0${completed.filePath}`
    completedByFile.set(key, [...(completedByFile.get(key) ?? []), completed])
  }
  async function completedSource(entry: Eligible): Promise<TranscriptSource | null> {
    const named = completedByFile.get(`${entry.group.source}\0${entry.filePath}`)
    if (named === undefined) return null
    const stats = await statOrNull(fs, entry.filePath)
    if (stats === null || stats.type !== "File") return null
    const identity = transcriptIdentity(entry.filePath, stats)
    const match = named.find((completed) => sameTranscriptIdentity(completed, identity))
    return match === undefined
      ? null
      : { ...identity, provider: entry.group.source, homePath: entry.group.homePath, providerSessionId: match.providerSessionId }
  }
  async function* run(): AsyncGenerator<RecentSessionOutcome> {
    const eligible = await eligibleTranscripts(fs, rules, await input.groups(), input.query, input.now())
    counts.found = eligible.length
    const importedSessions = new Set<string>()
    let bytesRemaining = MAX_IMPORT_BYTES
    let transcriptsRemaining = MAX_IMPORT_TRANSCRIPTS
    let recordsRemaining = MAX_IMPORT_RECORDS
    for (const entry of eligible) {
      const imported = await completedSource(entry)
      if (imported !== null) {
        importedSessions.add(`${imported.provider}\0${imported.providerSessionId}`)
        yield { _tag: "AlreadyImported", source: imported }
        continue
      }
      if (transcriptsRemaining === 0 || bytesRemaining === 0 || recordsRemaining === 0) {
        yield { _tag: "Skipped" }
        continue
      }
      const stats = await statOrNull(fs, entry.filePath)
      if (stats === null || stats.type !== "File") {
        yield { _tag: "Skipped" }
        continue
      }
      const identity = transcriptIdentity(entry.filePath, stats)
      if (identity.size > MAX_IMPORTED_TRANSCRIPT_BYTES || identity.size > bytesRemaining) {
        yield { _tag: "Skipped" }
        continue
      }
      transcriptsRemaining -= 1
      bytesRemaining -= identity.size
      counts.read += 1
      const snapshot = await readTranscriptRecords(fs, identity, recordsRemaining, entry.group.source)
      if (snapshot === null) {
        yield { _tag: "Skipped" }
        continue
      }
      recordsRemaining -= snapshot.recordCount
      const snapshotCwd = snapshot.records.map(extractDecodedCwd).find((cwd) => cwd !== null) ?? null
      const resolvedCwd = snapshotCwd === null ? null : rules.resolveRecordedPath(snapshotCwd)
      if (resolvedCwd === null || (await rules.directoryIdentity(resolvedCwd)) !== entry.targetIdentity) {
        yield { _tag: "Skipped" }
        continue
      }
      const thread = parseAgentSessionRecords(
        { source: entry.group.source, fallbackSessionId: basename(entry.filePath, ".jsonl"), lastActiveAtMs: entry.mtimeMs },
        snapshot.records,
      )
      if (thread === null) {
        yield { _tag: "Skipped" }
        continue
      }
      const source = { ...identity, provider: thread.source, homePath: entry.group.homePath, providerSessionId: thread.providerSessionId }
      const sessionKey = `${thread.source}\0${thread.providerSessionId}`
      if (importedSessions.has(sessionKey)) {
        yield { _tag: "Duplicate", source }
        continue
      }
      importedSessions.add(sessionKey)
      const digest = buildSessionDigest({ thread, records: snapshot.records, cwd: resolvedCwd })
      yield { _tag: "Importable", thread, source, cwd: resolvedCwd, digest }
    }
  }
  return { [Symbol.asyncIterator]: () => run(), counts: () => ({ ...counts }) }
}

import { join } from "node:path"

import { MAX_TRANSCRIPTS_PER_SOURCE } from "./constants"
import { listDirectoryOrEmpty, statOrNull, type SessionHistoryFs } from "./session-history-fs"

export interface TranscriptCandidate {
  readonly filePath: string
  readonly mtimeMs: number
  /** The agent home the transcript was found in; one home owns each copy of a session. */
  readonly homePath: string
  readonly size: number
}

export interface DiscoveredTranscripts {
  readonly transcripts: ReadonlyArray<TranscriptCandidate>
  readonly truncated: boolean
}

class OperationBudget {
  truncated = false
  constructor(
    private readonly fs: SessionHistoryFs,
    private remaining: number,
    private readonly signal?: AbortSignal,
  ) {}

  get exhausted(): boolean {
    if (this.remaining <= 0 || this.signal?.aborted === true) this.truncated = true
    return this.truncated
  }

  async readDirectory(directory: string): Promise<ReadonlyArray<string>> {
    if (this.exhausted) return []
    this.remaining -= 1
    return listDirectoryOrEmpty(this.fs, directory)
  }

  async statTranscript(filePath: string, homePath: string): Promise<TranscriptCandidate | null> {
    if (this.signal?.aborted === true) return null
    this.remaining -= 1
    const stats = await statOrNull(this.fs, filePath)
    if (stats === null || stats.type !== "File" || stats.mtimeMs === null) return null
    return { filePath, mtimeMs: stats.mtimeMs, homePath, size: stats.size }
  }
}

export async function discoverClaudeTranscripts(
  fs: SessionHistoryFs,
  homePath: string,
  operationBudget: number,
  signal?: AbortSignal,
): Promise<DiscoveredTranscripts> {
  const budget = new OperationBudget(fs, operationBudget, signal)
  const projectsDir = join(homePath, "projects")
  const transcripts: Array<TranscriptCandidate> = []
  for (const projectDirectory of await budget.readDirectory(projectsDir)) {
    if (budget.exhausted) break
    const directory = join(projectsDir, projectDirectory)
    const entries = (await budget.readDirectory(directory)).filter((entry) => entry.endsWith(".jsonl"))
    for (const entry of entries) {
      if (budget.exhausted) break
      const transcript = await budget.statTranscript(join(directory, entry), homePath)
      if (transcript !== null) transcripts.push(transcript)
    }
  }
  return { transcripts, truncated: budget.truncated }
}

const newestFirst = (entries: ReadonlyArray<string>) => entries.toSorted().toReversed()

/** Date-partitioned directories sort chronologically, so walking them in reverse spends the budget on recent sessions. */
export async function discoverCodexTranscripts(
  fs: SessionHistoryFs,
  homePath: string,
  operationBudget: number,
  signal?: AbortSignal,
): Promise<DiscoveredTranscripts> {
  const budget = new OperationBudget(fs, operationBudget, signal)
  const sessionsDir = join(homePath, "sessions")
  const transcripts: Array<TranscriptCandidate> = []
  for (const year of newestFirst(await budget.readDirectory(sessionsDir))) {
    if (budget.exhausted) break
    for (const month of newestFirst(await budget.readDirectory(join(sessionsDir, year)))) {
      if (budget.exhausted) break
      for (const day of newestFirst(await budget.readDirectory(join(sessionsDir, year, month)))) {
        if (budget.exhausted) break
        const directory = join(sessionsDir, year, month, day)
        for (const entry of newestFirst(await budget.readDirectory(directory))) {
          if (!entry.startsWith("rollout-") || !entry.endsWith(".jsonl")) continue
          if (budget.exhausted) break
          const transcript = await budget.statTranscript(join(directory, entry), homePath)
          if (transcript !== null) transcripts.push(transcript)
        }
      }
    }
  }
  return { transcripts, truncated: budget.truncated }
}

/** Newest-first, giving each home a turn before taking another file from the same home. */
export function selectMetadataTranscripts(transcripts: ReadonlyArray<TranscriptCandidate>): Array<TranscriptCandidate> {
  const selected: Array<TranscriptCandidate> = []
  let pending = Array.from(Map.groupBy(transcripts, (transcript) => transcript.homePath).values(), (entries) =>
    entries.values(),
  )
  while (pending.length > 0 && selected.length < MAX_TRANSCRIPTS_PER_SOURCE) {
    const nextRound: typeof pending = []
    for (const iterator of pending) {
      if (selected.length === MAX_TRANSCRIPTS_PER_SOURCE) break
      const next = iterator.next()
      if (next.done) continue
      selected.push(next.value)
      nextRound.push(iterator)
    }
    pending = nextRound
  }
  return selected
}

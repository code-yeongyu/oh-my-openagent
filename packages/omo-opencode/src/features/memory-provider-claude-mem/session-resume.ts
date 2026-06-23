import type { L1SearchResult, L1SessionContext } from "../memory-provider-core/types"
import type { ClaudeMemHttpClient } from "./http-client"
import type { ClaudeMemSQLiteReader } from "./sqlite-reader"
import { formatSessionSummary } from "./session-summary-text"
import type { ObservationRow, SessionSummaryRow } from "./types"

export interface SessionResumeDeps {
  sqliteReader: ClaudeMemSQLiteReader
  httpClient?: ClaudeMemHttpClient
}

export async function buildSessionContext(
  contentSessionId: string,
  deps: SessionResumeDeps,
): Promise<L1SessionContext | undefined> {
  const { sqliteReader, httpClient } = deps

  if (httpClient) {
    const isAlive = await httpClient.isWorkerProcessAlive().catch(() => false)
    if (isAlive) {
      const workerContext = await buildFromHttpWorker(contentSessionId, httpClient).catch(
        () => undefined,
      )
      if (workerContext) return workerContext
    }
  }

  return buildFromSQLite(contentSessionId, sqliteReader)
}

async function buildFromHttpWorker(
  contentSessionId: string,
  httpClient: ClaudeMemHttpClient,
): Promise<L1SessionContext | undefined> {
  const searchResult = await httpClient
    .search({ q: contentSessionId, limit: 10, type: "sessions" })
    .catch(() => ({ results: [], total: 0 }))

  if (searchResult.results.length === 0) return undefined

  const observations: L1SearchResult[] = searchResult.results.map((r) => ({
    id: String(r.id),
    title: r.title,
    subtitle: r.subtitle,
    source: r.project,
    created_at: r.time,
  }))

  const first = searchResult.results[0]
  return {
    session_id: contentSessionId,
    project: first?.project ?? "unknown",
    observations,
    started_at: first?.time ?? new Date().toISOString(),
  }
}

function buildFromSQLite(
  contentSessionId: string,
  reader: ClaudeMemSQLiteReader,
): L1SessionContext | undefined {
  const session = reader.getSession(contentSessionId)
  if (!session) return undefined

  const summaryRow: SessionSummaryRow | null = session.memory_session_id
    ? reader.getSessionSummary(session.memory_session_id)
    : null

  const observationRows: ObservationRow[] = session.memory_session_id
    ? reader.getSessionObservations(session.memory_session_id, 10)
    : []

  const observations: L1SearchResult[] = observationRows.map((o) => ({
    id: String(o.id),
    title: o.title ?? "(untitled)",
    subtitle: o.subtitle ?? undefined,
    score:
      o.discovery_tokens !== null
        ? Math.min(Math.max(o.discovery_tokens / 1000, 0), 1)
        : undefined,
    source: o.project,
    created_at: o.created_at,
  }))

  return {
    session_id: contentSessionId,
    project: session.project,
    summary: formatSessionSummary(summaryRow),
    observations,
    started_at: session.started_at,
    completed_at: session.completed_at ?? undefined,
  }
}

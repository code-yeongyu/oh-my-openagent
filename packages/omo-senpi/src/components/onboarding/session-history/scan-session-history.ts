import { describeReadFailure } from "../../../../../omo-native/bin/lib/read-failure.js"
import type { SessionDigestStore } from "./digest-store"
import { digestByteLength } from "./session-digest"
import { createSessionHistoryScanner } from "./session-history-scanner"
import type {
  AgentSessionSource,
  ProjectCandidate,
  RecentSessionsQuery,
  ScanCounts,
  SessionHistoryOptions,
} from "./types"

export type SessionHistoryScanSource = "projects" | "sessions"

export interface SessionScanItem {
  readonly sessionKey: string
  readonly source: AgentSessionSource
  readonly providerSessionId: string
  readonly cwd: string
  readonly title: string
  readonly lastActiveAt: string
  readonly digestBytes: number
}

/** One event of the onboarding scan stream (`omo.onboarding.scan.event`), for the `projects` and `sessions` sources. */
export interface SessionHistoryScanEvent {
  readonly scanId: string
  readonly kind: "source_started" | "item" | "source_done" | "source_failed"
  readonly source: SessionHistoryScanSource
  /** A `ProjectCandidate` for `projects`, a `SessionScanItem` for `sessions`. */
  readonly item?: ProjectCandidate | SessionScanItem
  readonly counts?: ScanCounts
  /**
   * On `source_failed`: the failure's kind (`describeReadFailure`), never the error's own text, which can name
   * local paths or quote a file. It reaches the onboarding RPC, the first-prompt context and the history tool.
   */
  readonly error?: string
  readonly elapsedMs: number
}

export type ScanSessionHistoryOptions = SessionHistoryOptions &
  RecentSessionsQuery & { readonly scanId: string; readonly digestStore: SessionDigestStore }

/**
 * Programmatic, read-only discovery: no model call and no network I/O. Projects are emitted first, then the
 * recent sessions, whose digests are written to `digestStore` under `scanId` before their item is emitted.
 * A failing source ends with `source_failed` and never hides the other source.
 */
export async function* scanSessionHistory(options: ScanSessionHistoryOptions): AsyncGenerator<SessionHistoryScanEvent> {
  const startedAt = performance.now()
  const elapsedMs = () => Math.max(0, Math.round(performance.now() - startedAt))
  const { scanId } = options
  const scanner = createSessionHistoryScanner(options)

  yield { scanId, kind: "source_started", source: "projects", elapsedMs: elapsedMs() }
  try {
    const result = await scanner.scanProjects()
    for (const item of result.candidates)
      yield { scanId, kind: "item", source: "projects", item, elapsedMs: elapsedMs() }
    yield { scanId, kind: "source_done", source: "projects", counts: result.counts, elapsedMs: elapsedMs() }
  } catch (cause) {
    yield {
      scanId,
      kind: "source_failed",
      source: "projects",
      error: describeReadFailure(cause),
      elapsedMs: elapsedMs(),
    }
  }

  yield { scanId, kind: "source_started", source: "sessions", elapsedMs: elapsedMs() }
  try {
    const query: RecentSessionsQuery = {
      ...(options.workspaceRoot === undefined ? {} : { workspaceRoot: options.workspaceRoot }),
      ...(options.recentWindowMs === undefined ? {} : { recentWindowMs: options.recentWindowMs }),
    }
    const run = scanner.recentSessions(query)
    for await (const outcome of run) {
      if (outcome._tag !== "Importable") continue
      await options.digestStore.put(scanId, outcome.digest)
      const item: SessionScanItem = {
        sessionKey: outcome.digest.sessionKey,
        source: outcome.thread.source,
        providerSessionId: outcome.thread.providerSessionId,
        cwd: outcome.cwd,
        title: outcome.thread.title,
        lastActiveAt: outcome.thread.updatedAt,
        digestBytes: digestByteLength(outcome.digest),
      }
      yield { scanId, kind: "item", source: "sessions", item, elapsedMs: elapsedMs() }
    }
    yield { scanId, kind: "source_done", source: "sessions", counts: run.counts(), elapsedMs: elapsedMs() }
  } catch (cause) {
    yield {
      scanId,
      kind: "source_failed",
      source: "sessions",
      error: describeReadFailure(cause),
      elapsedMs: elapsedMs(),
    }
  }
}

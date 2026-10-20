import { join } from "node:path"

import type { AgentToolResult } from "@code-yeongyu/senpi"

import type {
  ProjectCandidate,
  SessionDigest,
  SessionHistoryOptions,
  SessionHistoryScanEvent,
  SessionHistoryScanSource,
} from "./session-history"
import type { SessionHistoryRuntimeLoader } from "./session-history-runtime-loader"
import type { OnboardingSessionHistoryDetails, OnboardingSessionHistoryParams, SourceSummary } from "./session-history-tool"

const DAY_MS = 24 * 60 * 60 * 1000
const SHOWN_PROJECTS = 40
const SHOWN_DIGESTS = 40

export interface OnboardingSessionHistoryRun {
  readonly params: OnboardingSessionHistoryParams
  readonly stateDir: string
  readonly scanOptions?: SessionHistoryOptions
  readonly scanId: string
  readonly loadRuntime: SessionHistoryRuntimeLoader
}

export async function executeOnboardingSessionHistory(run: OnboardingSessionHistoryRun): Promise<AgentToolResult<OnboardingSessionHistoryDetails>> {
  const { createSessionDigestStore, scanSessionHistory } = await run.loadRuntime()
  const { params, scanId } = run
  const digestStore = createSessionDigestStore({ stateDir: run.stateDir })
  const events = scanSessionHistory({
    ...run.scanOptions,
    scanId,
    digestStore,
    ...(params.workspace_root === undefined ? {} : { workspaceRoot: params.workspace_root }),
    ...(params.recent_days === undefined ? {} : { recentWindowMs: params.recent_days * DAY_MS }),
  })
  const { projects, sources } = await collectScan(events)
  const digests = await digestStore.list(scanId)
  const details: OnboardingSessionHistoryDetails = {
    scanId,
    digestsFile: join(run.stateDir, "onboarding", "scans", scanId, "digests.jsonl"),
    sources,
    projectCount: projects.length,
    digestCount: digests.length,
  }
  return { content: [{ type: "text", text: formatScan(details, projects, digests) }], details }
}

async function collectScan(events: AsyncIterable<SessionHistoryScanEvent>) {
  const projects: Array<ProjectCandidate> = []
  const sources: Partial<Record<SessionHistoryScanSource, SourceSummary>> = {}
  for await (const event of events) {
    if (event.kind === "item" && event.source === "projects" && event.item !== undefined && "path" in event.item) {
      projects.push(event.item)
    }
    if (event.kind === "source_done") sources[event.source] = event.counts === undefined ? {} : { counts: event.counts }
    if (event.kind === "source_failed") sources[event.source] = { error: event.error ?? "unknown error" }
  }
  return { projects, sources }
}

function formatSource(name: SessionHistoryScanSource, summary: SourceSummary | undefined): string {
  if (summary?.error !== undefined) return `${name}: failed (${summary.error})`
  const counts = summary?.counts
  return counts === undefined ? `${name}: no result` : `${name}: found ${counts.found}, read ${counts.read}, cap ${counts.cap}`
}

function formatScan(
  details: OnboardingSessionHistoryDetails,
  projects: ReadonlyArray<ProjectCandidate>,
  digests: ReadonlyArray<SessionDigest>,
): string {
  const lines = [
    `scan ${details.scanId}`,
    formatSource("projects", details.sources.projects),
    formatSource("sessions", details.sources.sessions),
    "",
    `projects (${projects.length}, newest first):`,
    ...projects.slice(0, SHOWN_PROJECTS).map((project) =>
      `- ${project.path} [${project.sources.join(",")}] threads=${project.threadCount} last=${project.lastActiveAt ?? "unknown"}`),
    ...(projects.length > SHOWN_PROJECTS ? [`- ... ${projects.length - SHOWN_PROJECTS} more`] : []),
    "",
    `session digests (${digests.length}; all in ${details.digestsFile}):`,
    ...digests.slice(0, SHOWN_DIGESTS).map((digest) => JSON.stringify(digest)),
  ]
  if (digests.length > SHOWN_DIGESTS) lines.push(`... ${digests.length - SHOWN_DIGESTS} more digests in the file above`)
  return lines.join("\n")
}

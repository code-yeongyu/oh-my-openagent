import { resolveAgentSessionsDirectory } from "../../agent-home/resolve-agent-home"
import { collectSourceCandidates, defaultAgentHomes } from "./agent-transcripts"
import { PROJECT_SCAN_CAP } from "./constants"
import { discoverOmoCliProjects } from "./omo-session-discovery"
import { buildProjectCandidates, type RawProjectEvidence } from "./project-candidates"
import { createProjectPathRules } from "./project-paths"
import { listRecentSessions, type RecentSessionsRun, type SourcedGroup } from "./recent-sessions"
import { nodeSessionHistoryFs } from "./session-history-fs"
import type { ProjectScanResult, RecentSessionsQuery, SessionHistoryOptions } from "./types"

export interface SessionHistoryScanner {
  /** Every directory the agent homes and omo CLI sessions ran in, newest-first. Read-only, best-effort. */
  scanProjects(): Promise<ProjectScanResult>
  recentSessions(query: RecentSessionsQuery): RecentSessionsRun
}

export function createSessionHistoryScanner(options: SessionHistoryOptions): SessionHistoryScanner {
  const fs = options.fs ?? nodeSessionHistoryFs
  const env = options.env ?? process.env
  const now = options.now ?? Date.now
  const rules = createProjectPathRules({ ...options, fs })
  const homes = options.homes ?? defaultAgentHomes(env, rules.homeDir)
  const omoRoots = options.omoSessionsRoots ?? [resolveAgentSessionsDirectory({ env, homeDir: rules.homeDir })]
  let cachedGroups: ReadonlyArray<SourcedGroup> | null = null

  const collectAgentGroups = async () => {
    const perSource = [
      await collectSourceCandidates({ fs, rules, homes, source: "claudeAgent" }),
      await collectSourceCandidates({ fs, rules, homes, source: "codex" }),
    ]
    cachedGroups = perSource.flatMap((result) => result.groups.map((group) => ({ ...group, source: result.source })))
    return { groups: cachedGroups, perSource }
  }

  const scanProjects = async (): Promise<ProjectScanResult> => {
    const { groups, perSource } = await collectAgentGroups()
    const omo = await discoverOmoCliProjects(fs, omoRoots)
    const raw: Array<RawProjectEvidence> = [
      ...groups.map((group) => ({
        cwd: group.cwd,
        source: group.source,
        threadCount: group.transcripts.length,
        lastActiveAtMs: group.lastActiveAtMs,
      })),
      ...omo.projects,
    ]
    const candidates = await buildProjectCandidates({ fs, rules, raw, importedProjects: options.importedProjects ?? [] })
    const truncated = omo.truncated || perSource.some((result) => result.truncated)
    return {
      candidates,
      scannedAt: new Date(now()).toISOString(),
      ...(truncated ? { truncated: true as const } : {}),
      counts: {
        found: omo.found + perSource.reduce((total, result) => total + result.found, 0),
        read: omo.read + perSource.reduce((total, result) => total + result.read, 0),
        cap: PROJECT_SCAN_CAP,
      },
    }
  }

  const recentSessions = (query: RecentSessionsQuery): RecentSessionsRun =>
    listRecentSessions({
      fs,
      rules,
      query,
      now,
      groups: async () => cachedGroups ?? (await collectAgentGroups()).groups,
    })

  return { scanProjects, recentSessions }
}

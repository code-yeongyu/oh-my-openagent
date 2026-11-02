import { basename } from "node:path"

import { readGitIdentity } from "./git-identity"
import { normalizeProjectPathForComparison, type ProjectPathRules } from "./project-paths"
import { realPathOr, statOrNull, type SessionHistoryFs } from "./session-history-fs"
import type { ImportedProject, ProjectCandidate, ProjectGit, ProjectSource } from "./types"

export interface RawProjectEvidence {
  readonly cwd: string
  readonly source: ProjectSource
  readonly threadCount: number
  readonly lastActiveAtMs: number | null
}

interface MergedEntry {
  path: string
  sources: Array<ProjectSource>
  threadCount: number
  lastActiveAtMs: number | null
  git: ProjectGit | null
}

const EXCLUDED = ""

async function resolveDirectoryKey(
  fs: SessionHistoryFs,
  rules: ProjectPathRules,
  resolved: string,
  gitIdentities: Map<string, ProjectGit | null>,
): Promise<string> {
  const stats = await statOrNull(fs, resolved)
  if (stats === null || stats.type !== "Directory") return EXCLUDED
  if (rules.isExcludedProjectPath(await realPathOr(fs, resolved))) return EXCLUDED
  const gitIdentity = await readGitIdentity(fs, resolved)
  if (gitIdentity._tag === "Worktree") return EXCLUDED
  const key = await rules.directoryIdentity(resolved, stats)
  gitIdentities.set(key, gitIdentity._tag === "Repository" ? gitIdentity.git : null)
  return key
}

/** Merge per-source evidence by filesystem identity, keeping the first spelling and any persisted project path. */
export async function buildProjectCandidates(input: {
  readonly fs: SessionHistoryFs
  readonly rules: ProjectPathRules
  readonly raw: ReadonlyArray<RawProjectEvidence>
  readonly importedProjects: ReadonlyArray<ImportedProject>
}): Promise<Array<ProjectCandidate>> {
  const { fs, rules } = input
  const merged = new Map<string, MergedEntry>()
  const directoryKeys = new Map<string, string>()
  const gitIdentities = new Map<string, ProjectGit | null>()
  for (const evidence of input.raw) {
    const resolved = rules.resolveRecordedPath(evidence.cwd)
    if (resolved === null || rules.isExcludedProjectPath(resolved)) continue
    let key = directoryKeys.get(resolved)
    if (key === undefined) {
      key = await resolveDirectoryKey(fs, rules, resolved, gitIdentities)
      directoryKeys.set(resolved, key)
    }
    if (key === EXCLUDED) continue
    const existing = merged.get(key)
    if (existing === undefined) {
      merged.set(key, {
        path: resolved,
        sources: [evidence.source],
        threadCount: evidence.threadCount,
        lastActiveAtMs: evidence.lastActiveAtMs,
        git: gitIdentities.get(key) ?? null,
      })
      continue
    }
    if (!existing.sources.includes(evidence.source)) existing.sources.push(evidence.source)
    existing.threadCount += evidence.threadCount
    existing.lastActiveAtMs =
      existing.lastActiveAtMs === null || evidence.lastActiveAtMs === null
        ? (existing.lastActiveAtMs ?? evidence.lastActiveAtMs)
        : Math.max(existing.lastActiveAtMs, evidence.lastActiveAtMs)
  }

  const importedByRoot = new Map<string, ImportedProject>()
  for (const project of input.importedProjects) {
    const root = rules.resolveRecordedPath(project.workspaceRoot) ?? project.workspaceRoot
    importedByRoot.set(normalizeProjectPathForComparison(root), project)
    importedByRoot.set(await rules.directoryIdentity(root), project)
  }

  const candidates: Array<ProjectCandidate> = []
  for (const [key, entry] of merged) {
    const imported = importedByRoot.get(normalizeProjectPathForComparison(entry.path)) ?? importedByRoot.get(key)
    const candidatePath = imported?.workspaceRoot ?? entry.path
    candidates.push({
      path: candidatePath,
      title: basename(candidatePath) || candidatePath,
      ...(imported === undefined ? {} : { projectId: imported.id }),
      sources: entry.sources,
      threadCount: entry.threadCount,
      lastActiveAt: entry.lastActiveAtMs === null ? null : new Date(entry.lastActiveAtMs).toISOString(),
      alreadyImported: imported !== undefined,
      git: entry.git,
    })
  }
  return candidates.sort((left, right) => {
    if (left.lastActiveAt === right.lastActiveAt) return left.path.localeCompare(right.path)
    if (left.lastActiveAt === null) return 1
    if (right.lastActiveAt === null) return -1
    return right.lastActiveAt.localeCompare(left.lastActiveAt)
  })
}

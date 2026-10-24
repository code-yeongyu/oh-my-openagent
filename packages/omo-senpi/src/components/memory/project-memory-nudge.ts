import {
  GitMemoryRepo,
  RecallCorpusCache,
  createProjectIdentityResolver,
  parseProjectMemoryPath,
  redactSecretLikeMaterial,
  type ProjectIdentity,
  type ProjectIdentityResolver,
  type ProjectScopeFs,
  type RecallDocument,
} from "@oh-my-opencode/memory-core"

import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"

import type { ComponentLogger, SenpiExtensionAPI } from "../../extension/types"
import type { MemoryIdentityContext } from "./context"
import { grantProjectMemoryRead, revokeProjectMemoryReads } from "./project-memory-grants"
import type { ProjectRecallCorpus } from "./project-recall-seats"
import { isRecord, sessionIdFrom } from "./wiring-context"

export const PROJECT_MEMORY_NUDGE_MAX_NOTES = 30
export const PROJECT_MEMORY_RECALL_MAX_PROJECTS = 3

const TOUCH_TOOL_NAMES = new Set(["read", "edit", "write"])
const PATH_ARGUMENT_NAMES = ["path", "file_path", "filePath"] as const

export interface ProjectMemorySwitches {
  readonly nudge: boolean
  readonly recall: boolean
}

export interface ProjectMemoryNudgeOptions {
  readonly resolveContext: (sessionId: string) => MemoryIdentityContext | undefined
  /** Read once per session: the tool-result path never reloads configuration. */
  readonly switches: () => ProjectMemorySwitches
  readonly fallbackCwd: () => string
  readonly corpusCache: RecallCorpusCache
  readonly env?: Record<string, string | undefined>
  readonly logger?: Pick<ComponentLogger, "warn">
  readonly fs?: ProjectScopeFs
}

interface SessionScope {
  readonly key: string
  readonly resolver: ProjectIdentityResolver
  readonly nudged: Map<string, symbol>
  readonly touched: ProjectIdentity[]
  readonly touchedPaths: Map<string, string>
  corpora?: { readonly key: string; readonly list: readonly ProjectRecallCorpus[] }
}

export interface ProjectMemoryScope {
  register(pi: SenpiExtensionAPI): void
  touchedMostRecentFirst(sessionId: string): readonly ProjectIdentity[]
  recallCorpora(sessionId: string): Promise<readonly ProjectRecallCorpus[]>
  sourceFor(sessionId: string, path: string): string | undefined
}

export function createProjectMemoryScope(options: ProjectMemoryNudgeOptions): ProjectMemoryScope {
  const sessions = new Map<string, SessionScope>()
  const switchesBySession = new Map<string, ProjectMemorySwitches>()

  function switchesFor(sessionId: string): ProjectMemorySwitches {
    let switches = switchesBySession.get(sessionId)
    if (switches === undefined) {
      switches = options.switches()
      switchesBySession.set(sessionId, switches)
    }
    return switches
  }

  function sessionCwd(eventCtx: unknown): string {
    return isRecord(eventCtx) && typeof eventCtx.cwd === "string" && eventCtx.cwd.length > 0 ? eventCtx.cwd : options.fallbackCwd()
  }

  function scopeFor(sessionId: string, cwd: string, context: MemoryIdentityContext): SessionScope {
    const bound = context.projectScope
    const key = [cwd, context.identity, bound?.memoryRoot ?? "", bound?.autoIdentity ?? "path"].join("\0")
    const existing = sessions.get(sessionId)
    if (existing?.key === key) return existing
    const created: SessionScope = {
      key,
      resolver: createProjectIdentityResolver({
        sessionCwd: cwd,
        boundId: context.identity,
        ...(bound === undefined ? {} : { memoryRoot: bound.memoryRoot, autoIdentity: bound.autoIdentity }),
        ...(options.env === undefined ? {} : { env: options.env }),
        ...(options.fs === undefined ? {} : { fs: options.fs }),
      }),
      nudged: new Map(),
      touched: [],
      touchedPaths: new Map(),
    }
    sessions.set(sessionId, created)
    return created
  }

  async function corpusOf(project: ProjectIdentity) {
    const dir = project.identity.paths.repo
    return await options.corpusCache.load(new GitMemoryRepo({ dir, agentId: project.identity.id }))
  }

  async function notesOf(project: ProjectIdentity): Promise<readonly RecallDocument[]> {
    return (await corpusOf(project)).documents
  }

  // Rank the original cached arrays: persistence seeds and observes terms on these exact documents.
  async function recallCorpora(sessionId: string): Promise<readonly ProjectRecallCorpus[]> {
    const scope = sessions.get(sessionId)
    if (scope === undefined || !switchesFor(sessionId).recall) return []
    const projects = scope.touched.slice(0, PROJECT_MEMORY_RECALL_MAX_PROJECTS)
    const list = await Promise.all(projects.map(async (project) => {
      const corpus = await corpusOf(project)
      const touchedPath = scope.touchedPaths.get(project.identity.id)
      return { identityId: project.identity.id, revision: corpus.revision, documents: corpus.documents, ...(touchedPath === undefined ? {} : { touchedPath }) }
    }))
    const key = projects.map((project, index) => `${project.identity.id}@${list[index]?.revision}:${list[index]?.touchedPath ?? ""}`).join("\0")
    if (scope.corpora?.key !== key) scope.corpora = { key, list: list.map(({ revision: _revision, ...corpus }) => corpus) }
    return scope.corpora.list
  }

  function sourceFor(sessionId: string, path: string): string | undefined {
    const parsed = parseProjectMemoryPath(path)
    if (parsed === undefined) return undefined
    const project = sessions.get(sessionId)?.touched.find((entry) => entry.identity.id === parsed.identityId)
    return project === undefined ? undefined : join(project.identity.paths.repo, parsed.path)
  }

  // Every await below is asynchronous filesystem or git work: the tool-result path never blocks.
  async function onToolResult(payload: unknown, eventCtx: unknown) {
    const touchedPath = touchedPathOf(payload)
    if (touchedPath === undefined) return undefined
    const sessionId = sessionIdFrom(eventCtx)
    if (sessionId === undefined) return undefined
    const context = options.resolveContext(sessionId)
    if (context === undefined) return undefined
    const switches = switchesFor(sessionId)
    if (!switches.nudge && !switches.recall) {
      revokeProjectMemoryReads(context)
      return undefined
    }

    const cwd = sessionCwd(eventCtx)
    const scope = scopeFor(sessionId, cwd, context)
    const project = await scope.resolver.forPath(touchedPath)
    if (project === undefined || project.identity.id === context.identity) return undefined
    const live = () => sessions.get(sessionId) === scope
    await grantProjectMemoryRead(context, project.identity.paths.repo, { realPath: scope.resolver.realPath, stillLive: live })
    if (!live()) return undefined
    const index = scope.touched.findIndex((entry) => entry.identity.id === project.identity.id)
    if (index >= 0) scope.touched.splice(index, 1)
    scope.touched.unshift(project)
    const within = await projectRelativePath(scope.resolver, project.projectDir, resolve(cwd, touchedPath))
    if (within !== undefined) scope.touchedPaths.set(project.identity.id, within)

    if (!switches.nudge || scope.nudged.has(project.identity.id)) return undefined
    // Reserve before I/O; the token distinguishes this read from one started after compaction.
    const reservation = Symbol()
    scope.nudged.set(project.identity.id, reservation)
    let notes: readonly RecallDocument[]
    try {
      notes = await notesOf(project)
    } catch (error) {
      if (scope.nudged.get(project.identity.id) === reservation) scope.nudged.delete(project.identity.id)
      // Advice only: a project repo that cannot be read leaves the tool result untouched and is retried on the next touch.
      options.logger?.warn("omo-senpi project memory nudge skipped", {
        project: project.projectDir,
        error: error instanceof Error ? error.message : String(error),
      })
      return undefined
    }
    if (!live() || scope.nudged.get(project.identity.id) !== reservation) return undefined
    if (notes.length === 0) return undefined
    const content = isRecord(payload) && Array.isArray(payload.content) ? payload.content : []
    return { content: [...content, { type: "text", text: formatProjectMemoryNudge(project, notes), audience: "model" }] }
  }

  function register(pi: SenpiExtensionAPI): void {
    pi.on("tool_result", onToolResult)

    pi.on("session_compact", (payload: unknown, eventCtx: unknown) => {
      if (isRecord(payload) && payload.accepted === false) return
      const sessionId = sessionIdFrom(eventCtx)
      if (sessionId !== undefined) sessions.get(sessionId)?.nudged.clear()
    })

    pi.on("session_shutdown", (_payload: unknown, eventCtx: unknown) => {
      const sessionId = sessionIdFrom(eventCtx)
      if (sessionId === undefined) return
      sessions.delete(sessionId)
      switchesBySession.delete(sessionId)
      const context = options.resolveContext(sessionId)
      if (context !== undefined) revokeProjectMemoryReads(context)
    })
  }

  return {
    register,
    touchedMostRecentFirst: (sessionId) => sessions.get(sessionId)?.touched ?? [],
    recallCorpora,
    sourceFor,
  }
}

export function formatProjectMemoryNudge(project: ProjectIdentity, notes: readonly RecallDocument[]): string {
  const shown = notes.slice(0, PROJECT_MEMORY_NUDGE_MAX_NOTES)
  const lines = [
    "",
    `[Project memory: ${project.projectDir}]`,
    "This project keeps its own memory from earlier sessions. Consult it actively: read any note below that bears on the work before relying on assumptions.",
    `Notes live under ${project.identity.paths.repo}; open one with the read tool at that directory plus the path shown.`,
    ...shown.map((note) => `- ${note.path}: ${redactSecretLikeMaterial(note.description)}`),
    ...(notes.length > shown.length ? [`- +${notes.length - shown.length} more`] : []),
  ]
  return lines.join("\n")
}

// The touched file named from its project's root, so a note about that file can match it. A path
// mapped onto a main checkout (git mode) does not sit under it lexically and keeps no relative form.
async function projectRelativePath(resolver: ProjectIdentityResolver, projectDir: string, filePath: string): Promise<string | undefined> {
  const realDir = await resolver.realPath(dirname(filePath))
  // A file whose directory vanished after the tool ran has no position to rank by.
  if (realDir === undefined) return undefined
  const rel = relative(projectDir, join(realDir, filePath.slice(dirname(filePath).length + 1)))
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined
  return rel
}

function touchedPathOf(payload: unknown): string | undefined {
  if (!isRecord(payload) || payload.isError === true || typeof payload.toolName !== "string") return undefined
  if (!TOUCH_TOOL_NAMES.has(payload.toolName.trim().toLowerCase())) return undefined
  const input = payload.input
  if (!isRecord(input)) return undefined
  for (const name of PATH_ARGUMENT_NAMES) {
    const value = input[name]
    if (typeof value === "string" && value.length > 0) return value
  }
  return undefined
}

const mergedCorpora = new WeakMap<readonly RecallDocument[], WeakMap<readonly RecallDocument[], readonly RecallDocument[]>>()

/** The session's own notes plus its touched projects', as one stable array per pair of inputs (the recall memos are keyed on it). */
export function withProjectDocuments(own: readonly RecallDocument[], projects: readonly RecallDocument[]): readonly RecallDocument[] {
  if (projects.length === 0) return own
  let byProjects = mergedCorpora.get(own)
  if (byProjects === undefined) {
    byProjects = new WeakMap()
    mergedCorpora.set(own, byProjects)
  }
  const cached = byProjects.get(projects)
  if (cached !== undefined) return cached
  const merged = [...own, ...projects]
  byProjects.set(projects, merged)
  return merged
}

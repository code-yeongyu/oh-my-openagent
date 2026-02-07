import { promises as fs } from "node:fs"
import { dirname, join } from "node:path"
import { getOmoOpenCodeCacheDir } from "../../shared/data-path"
import { parseFrontmatter } from "../../shared/frontmatter"
import type { LoadedSkill, LazyContentLoader, SkillMetadata, SkillScope } from "./types"
import { wrapSkillTemplate } from "./skill-template"
import {
  discoverOpencodeGlobalSkills,
  discoverOpencodeProjectSkills,
  discoverProjectClaudeSkills,
  discoverUserClaudeSkills,
} from "./loader"

const SKILL_INDEX_CACHE_FILE = "skills-index-v1.json"

export interface SkillIndexEntry {
  name: string
  scope: SkillScope
  description: string
  model?: string
  agent?: string
  subtask?: boolean
  argumentHint?: string
  path?: string
  resolvedPath?: string
  license?: string
  compatibility?: string
  metadata?: Record<string, string>
  allowedTools?: string[]
}

export interface SkillIndexCacheV1 {
  version: 1
  updatedAt: string
  skills: SkillIndexEntry[]
}

export interface CacheReadResult<T> {
  cache: T
  stale: boolean
}

function getCacheFilePath(): string {
  return join(getOmoOpenCodeCacheDir(), SKILL_INDEX_CACHE_FILE)
}

async function ensureCacheDir(): Promise<void> {
  const dir = getOmoOpenCodeCacheDir()
  await fs.mkdir(dir, { recursive: true }).catch(() => {})
}

function isStale(updatedAtIso: string, ttlMs: number): boolean {
  const updatedAt = Date.parse(updatedAtIso)
  if (!Number.isFinite(updatedAt)) return true
  return Date.now() - updatedAt > ttlMs
}

export async function readSkillIndexCache(options?: {
  ttlMs?: number
}): Promise<CacheReadResult<SkillIndexCacheV1> | null> {
  const cacheFile = getCacheFilePath()
  try {
    const content = await fs.readFile(cacheFile, "utf-8")
    const parsed = JSON.parse(content) as SkillIndexCacheV1
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.skills)) {
      return null
    }
    const ttlMs = options?.ttlMs
    const stale = ttlMs ? isStale(parsed.updatedAt, ttlMs) : false
    return { cache: parsed, stale }
  } catch {
    return null
  }
}

export async function writeSkillIndexCache(skills: LoadedSkill[]): Promise<void> {
  await ensureCacheDir()
  const cacheFile = getCacheFilePath()

  const entries: SkillIndexEntry[] = skills.map((s) => ({
    name: s.name,
    scope: s.scope,
    description: s.definition.description ?? "",
    model: s.definition.model,
    agent: s.definition.agent,
    subtask: s.definition.subtask,
    argumentHint: s.definition.argumentHint,
    path: s.path,
    resolvedPath: s.resolvedPath,
    license: s.license,
    compatibility: s.compatibility,
    metadata: s.metadata,
    allowedTools: s.allowedTools,
  }))

  const payload: SkillIndexCacheV1 = {
    version: 1,
    updatedAt: new Date().toISOString(),
    skills: entries,
  }

  await fs.writeFile(cacheFile, JSON.stringify(payload, null, 2), "utf-8").catch(
    () => {},
  )
}

function createSkillLazyContentLoader(entry: SkillIndexEntry): LazyContentLoader | undefined {
  if (!entry.path) return undefined

  const loader: LazyContentLoader = {
    loaded: false,
    content: undefined,
    load: async () => {
      if (loader.loaded && loader.content !== undefined) return loader.content
      try {
        const raw = await fs.readFile(entry.path!, "utf-8")
        const { body } = parseFrontmatter<SkillMetadata>(raw)
        const baseDir = entry.resolvedPath ?? dirname(entry.path!)
        const templateContent = wrapSkillTemplate(baseDir, body)

        loader.loaded = true
        loader.content = templateContent
        return templateContent
      } catch {
        loader.loaded = true
        loader.content = ""
        return ""
      }
    },
  }

  return loader
}

export function skillIndexToLoadedSkills(entries: SkillIndexEntry[]): LoadedSkill[] {
  return entries.map((entry) => ({
    name: entry.name,
    path: entry.path,
    resolvedPath: entry.resolvedPath,
    definition: {
      name: entry.name,
      description: entry.description,
      template: "",
      model: entry.model,
      agent: entry.agent,
      subtask: entry.subtask,
      argumentHint: entry.argumentHint,
    },
    scope: entry.scope,
    license: entry.license,
    compatibility: entry.compatibility,
    metadata: entry.metadata,
    allowedTools: entry.allowedTools,
    lazyContent: createSkillLazyContentLoader(entry),
  }))
}

let refreshPromise: Promise<void> | null = null

export function refreshSkillIndexCacheInBackground(options?: {
  ttlMs?: number
  delayMs?: number
}): void {
  if (refreshPromise) return
  const delayMs = options?.delayMs ?? 0

  refreshPromise = (async () => {
    if (delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs))
    }

    // Only refresh if cache is missing or stale.
    const existing = await readSkillIndexCache({ ttlMs: options?.ttlMs })
    if (existing && !existing.stale) return

    const [userSkills, globalSkills, projectSkills, opencodeProjectSkills] =
      await Promise.all([
        discoverUserClaudeSkills(),
        discoverOpencodeGlobalSkills(),
        discoverProjectClaudeSkills(),
        discoverOpencodeProjectSkills(),
      ])

    const all = [
      ...userSkills,
      ...globalSkills,
      ...projectSkills,
      ...opencodeProjectSkills,
    ]
    await writeSkillIndexCache(all)
  })()
    .catch(() => {})
    .finally(() => {
      refreshPromise = null
    })
}

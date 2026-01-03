import { createHash, randomUUID } from "crypto"
import { mkdir, readFile, writeFile, readdir, stat } from "fs/promises"
import { join, dirname } from "path"
import type {
  KnowledgeCommit,
  KnowledgeLayer,
  KnowledgeType,
  KnowledgeAuthor,
  KnowledgeManifest,
  ManifestEntry,
  KnowledgeQueryFilter,
  KnowledgeQueryResult,
  PromotionRequest,
  PromotionRecord,
  KnowledgeRepositoryConfig,
  RepositoryStats,
  Constraint,
  Severity,
  KnowledgeMetadata,
} from "./types"

const MANIFEST_VERSION = "1.0.0"
const MAX_SUMMARY_LENGTH = 100

export class KnowledgeRepository {
  private config: KnowledgeRepositoryConfig
  private commitsDir: string
  private manifestPath: string
  private promotionsDir: string

  constructor(config: KnowledgeRepositoryConfig) {
    this.config = config
    this.commitsDir = join(config.rootDir, "commits")
    this.manifestPath = join(config.rootDir, "manifest.json")
    this.promotionsDir = join(config.rootDir, "promotions")
  }

  async initialize(): Promise<void> {
    await mkdir(this.commitsDir, { recursive: true })
    await mkdir(this.promotionsDir, { recursive: true })

    const layerDirs = ["company", "org", "project"] as const
    for (const layer of layerDirs) {
      await mkdir(join(this.commitsDir, layer), { recursive: true })
    }

    try {
      await stat(this.manifestPath)
    } catch {
      await this.rebuildManifest()
    }
  }

  async createCommit(params: {
    type: KnowledgeType
    title: string
    content: string
    layer: KnowledgeLayer
    severity: Severity
    constraints?: Constraint[]
    metadata?: KnowledgeMetadata
    author: KnowledgeAuthor
    tags?: string[]
    triggerKeywords?: string[]
    parentId?: string
  }): Promise<KnowledgeCommit> {
    const summary = this.generateSummary(params.title, params.content)
    const id = this.generateCommitId(params.content, params.author.id)

    const commit: KnowledgeCommit = {
      id,
      type: params.type,
      title: params.title,
      summary,
      content: params.content,
      layer: params.layer,
      severity: params.severity,
      constraints: params.constraints ?? [],
      metadata: params.metadata,
      author: params.author,
      createdAt: new Date().toISOString(),
      parentId: params.parentId,
      tags: params.tags ?? [],
      triggerKeywords: params.triggerKeywords ?? [],
    }

    const commitPath = this.getCommitPath(commit.layer, commit.id)
    await mkdir(dirname(commitPath), { recursive: true })
    await writeFile(commitPath, JSON.stringify(commit, null, 2), "utf-8")

    await this.updateManifest(commit)

    return commit
  }

  async getCommit(
    layer: KnowledgeLayer,
    id: string
  ): Promise<KnowledgeCommit | null> {
    const commitPath = this.getCommitPath(layer, id)
    try {
      const data = await readFile(commitPath, "utf-8")
      return JSON.parse(data) as KnowledgeCommit
    } catch {
      return null
    }
  }

  async getCommitById(id: string): Promise<KnowledgeCommit | null> {
    const layers: KnowledgeLayer[] = ["project", "org", "company"]
    for (const layer of layers) {
      const commit = await this.getCommit(layer, id)
      if (commit) return commit
    }
    return null
  }

  async query(filter: KnowledgeQueryFilter): Promise<KnowledgeQueryResult> {
    const manifest = await this.getManifest()
    let allEntries: ManifestEntry[] = []

    const layers = filter.layer
      ? this.normalizeFilter(filter.layer)
      : (["company", "org", "project"] as KnowledgeLayer[])
    for (const layer of layers) {
      allEntries = allEntries.concat(manifest.entries[layer])
    }

    let filtered = allEntries

    if (filter.type) {
      const types = this.normalizeFilter(filter.type)
      filtered = filtered.filter((e) => types.includes(e.type))
    }

    if (filter.severity) {
      const severities = this.normalizeFilter(filter.severity)
      filtered = filtered.filter((e) => severities.includes(e.severity))
    }

    if (filter.keywords?.length) {
      filtered = filtered.filter((e) =>
        filter.keywords!.some((kw) =>
          e.keywords.some((ek) => ek.toLowerCase().includes(kw.toLowerCase()))
        )
      )
    }

    if (filter.search) {
      const searchLower = filter.search.toLowerCase()
      filtered = filtered.filter((e) =>
        e.summary.toLowerCase().includes(searchLower)
      )
    }

    const total = filtered.length
    const offset = filter.offset ?? 0
    const limit = filter.limit ?? 50
    const paginated = filtered.slice(offset, offset + limit)

    const items: KnowledgeCommit[] = []
    for (const entry of paginated) {
      const commit = await this.getCommitById(entry.id)
      if (commit) items.push(commit)
    }

    return {
      items,
      total,
      hasMore: offset + limit < total,
    }
  }

  async getManifest(): Promise<KnowledgeManifest> {
    try {
      const data = await readFile(this.manifestPath, "utf-8")
      return JSON.parse(data) as KnowledgeManifest
    } catch {
      return this.createEmptyManifest()
    }
  }

  async rebuildManifest(): Promise<KnowledgeManifest> {
    const manifest = this.createEmptyManifest()
    const layers: KnowledgeLayer[] = ["company", "org", "project"]

    for (const layer of layers) {
      const layerDir = join(this.commitsDir, layer)
      try {
        const files = await readdir(layerDir)
        for (const file of files) {
          if (!file.endsWith(".json")) continue
          const data = await readFile(join(layerDir, file), "utf-8")
          const commit = JSON.parse(data) as KnowledgeCommit
          const entry = this.commitToManifestEntry(commit)
          manifest.entries[layer].push(entry)
          manifest.totalCount++
          manifest.stats.byType[commit.type] =
            (manifest.stats.byType[commit.type] ?? 0) + 1
          manifest.stats.bySeverity[commit.severity] =
            (manifest.stats.bySeverity[commit.severity] ?? 0) + 1
        }
      } catch {
        /* intentionally empty */
      }
    }

    await writeFile(this.manifestPath, JSON.stringify(manifest, null, 2), "utf-8")
    return manifest
  }

  async promote(request: PromotionRequest): Promise<PromotionRecord> {
    const commit = await this.getCommitById(request.knowledgeId)
    if (!commit) {
      throw new Error(`Knowledge not found: ${request.knowledgeId}`)
    }

    const layerOrder: KnowledgeLayer[] = ["project", "org", "company"]
    const currentIndex = layerOrder.indexOf(commit.layer)
    const targetIndex = layerOrder.indexOf(request.targetLayer)

    if (targetIndex <= currentIndex) {
      throw new Error(
        `Cannot promote from ${commit.layer} to ${request.targetLayer}`
      )
    }

    const newCommit = await this.createCommit({
      ...commit,
      layer: request.targetLayer,
      parentId: commit.id,
      author: request.promoter,
    })

    const record: PromotionRecord = {
      id: randomUUID(),
      knowledgeId: request.knowledgeId,
      fromLayer: commit.layer,
      toLayer: request.targetLayer,
      promoter: request.promoter,
      justification: request.justification,
      promotedAt: new Date().toISOString(),
      newKnowledgeId: newCommit.id,
    }

    const recordPath = join(this.promotionsDir, `${record.id}.json`)
    await writeFile(recordPath, JSON.stringify(record, null, 2), "utf-8")

    return record
  }

  async getHistory(id: string): Promise<KnowledgeCommit[]> {
    const history: KnowledgeCommit[] = []
    let currentId: string | undefined = id

    while (currentId) {
      const commit = await this.getCommitById(currentId)
      if (!commit) break
      history.push(commit)
      currentId = commit.parentId
    }

    return history
  }

  async getStats(): Promise<RepositoryStats> {
    const manifest = await this.getManifest()

    const byLayer: Record<KnowledgeLayer, number> = {
      company: manifest.entries.company.length,
      org: manifest.entries.org.length,
      project: manifest.entries.project.length,
    }

    return {
      totalCommits: manifest.totalCount,
      byLayer,
      byType: manifest.stats.byType as Record<KnowledgeType, number>,
      bySeverity: manifest.stats.bySeverity as Record<Severity, number>,
      lastUpdated: manifest.generatedAt,
    }
  }

  async findByKeyword(keyword: string): Promise<KnowledgeCommit[]> {
    const result = await this.query({
      keywords: [keyword],
      limit: 100,
    })
    return result.items
  }

  async getMergedKnowledge(layer: KnowledgeLayer): Promise<KnowledgeCommit[]> {
    const layers: KnowledgeLayer[] =
      layer === "project"
        ? ["company", "org", "project"]
        : layer === "org"
          ? ["company", "org"]
          : ["company"]

    const result = await this.query({
      layer: layers,
      limit: 1000,
    })

    return result.items
  }

  private getCommitPath(layer: KnowledgeLayer, id: string): string {
    return join(this.commitsDir, layer, `${id}.json`)
  }

  private generateCommitId(content: string, authorId: string): string {
    const timestamp = Date.now().toString()
    const hash = createHash("sha256")
      .update(content + authorId + timestamp)
      .digest("hex")
    return hash.substring(0, 12)
  }

  private generateSummary(title: string, content: string): string {
    if (title.length <= MAX_SUMMARY_LENGTH) return title

    const firstLine = content.split("\n")[0] ?? ""
    const cleaned = firstLine.replace(/^#+ /, "").trim()

    if (cleaned.length <= MAX_SUMMARY_LENGTH) return cleaned

    return cleaned.substring(0, MAX_SUMMARY_LENGTH - 3) + "..."
  }

  private commitToManifestEntry(commit: KnowledgeCommit): ManifestEntry {
    return {
      id: commit.id,
      type: commit.type,
      layer: commit.layer,
      summary: commit.summary,
      severity: commit.severity,
      keywords: commit.triggerKeywords,
    }
  }

  private createEmptyManifest(): KnowledgeManifest {
    return {
      version: MANIFEST_VERSION,
      generatedAt: new Date().toISOString(),
      totalCount: 0,
      entries: {
        company: [],
        org: [],
        project: [],
      },
      stats: {
        byType: {} as Record<KnowledgeType, number>,
        bySeverity: {} as Record<Severity, number>,
      },
    }
  }

  private async updateManifest(commit: KnowledgeCommit): Promise<void> {
    const manifest = await this.getManifest()
    const entry = this.commitToManifestEntry(commit)

    manifest.entries[commit.layer].push(entry)
    manifest.totalCount++
    manifest.stats.byType[commit.type] =
      (manifest.stats.byType[commit.type] ?? 0) + 1
    manifest.stats.bySeverity[commit.severity] =
      (manifest.stats.bySeverity[commit.severity] ?? 0) + 1
    manifest.generatedAt = new Date().toISOString()

    await writeFile(this.manifestPath, JSON.stringify(manifest, null, 2), "utf-8")
  }

  private normalizeFilter<T>(
    value: T | T[] | undefined
  ): T[] {
    if (!value) return []
    return Array.isArray(value) ? value : [value]
  }
}

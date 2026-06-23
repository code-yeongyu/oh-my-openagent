import type { MemoryCoreService } from "../memory-core/service"
import type { CanonicalMemory } from "../memory-core/types"
import type { CuratorInvoker } from "./invoker"
import type { CuratorApplyResult, CuratorResponse } from "./types"
import { applyCuratorDecisions } from "./decision-applicator"

export interface CuratorLoopConfig {
  intervalMs: number
  batchSize: number
  lookbackHours: number
  minAgeMinutes: number
  projectId?: string
}

export const DEFAULT_CURATOR_LOOP_CONFIG: CuratorLoopConfig = {
  intervalMs: 30 * 60_000,
  batchSize: 20,
  lookbackHours: 6,
  minAgeMinutes: 5,
}

export interface CuratorLoopDeps {
  service: MemoryCoreService
  invoker: CuratorInvoker
  config?: Partial<CuratorLoopConfig>
  log?: (message: string, ...args: unknown[]) => void
}

export interface CuratorLoopState {
  isRunning: boolean
  tickCount: number
  lastTickAt?: string
  lastResult?: CuratorApplyResult
  lastError?: string
}

export class CuratorLoop {
  private readonly config: CuratorLoopConfig
  private timer: ReturnType<typeof setInterval> | undefined
  private isTicking = false
  private state: CuratorLoopState = {
    isRunning: false,
    tickCount: 0,
  }

  constructor(private readonly deps: CuratorLoopDeps) {
    this.config = { ...DEFAULT_CURATOR_LOOP_CONFIG, ...deps.config }
  }

  start(): void {
    if (this.state.isRunning) return
    this.state = { ...this.state, isRunning: true }
    this.deps.log?.("[curator-loop] starting", { config: this.config })
    this.timer = setInterval(() => {
      void this.safeTick()
    }, this.config.intervalMs)
    void this.safeTick()
  }

  stop(): void {
    if (!this.state.isRunning) return
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = undefined
    }
    this.state = { ...this.state, isRunning: false }
    this.deps.log?.("[curator-loop] stopped")
  }

  getState(): Readonly<CuratorLoopState> {
    return this.state
  }

  async tick(): Promise<CuratorApplyResult | undefined> {
    if (this.isTicking) {
      this.deps.log?.("[curator-loop] tick skipped: already in flight")
      return undefined
    }
    this.isTicking = true
    try {
      return await this.runTick()
    } finally {
      this.isTicking = false
    }
  }

  private async safeTick(): Promise<void> {
    try {
      await this.tick()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.state = { ...this.state, lastError: message }
      this.deps.log?.("[curator-loop] tick failed", { error: message })
    }
  }

  private async runTick(): Promise<CuratorApplyResult | undefined> {
    const recent = await this.fetchRecentMemories()
    if (recent.length === 0) {
      this.state = {
        ...this.state,
        tickCount: this.state.tickCount + 1,
        lastTickAt: new Date().toISOString(),
        lastError: undefined,
      }
      return undefined
    }

    const related = await this.fetchRelatedMemories(recent)

    const response = await this.deps.invoker.invoke({
      recent_memories: recent.map((m) => toInvokerMemory(m)),
      related_memories: related.map((m) => toInvokerMemory(m)),
      project_id: this.config.projectId ?? recent[0]?.project_id ?? "unknown",
      batch_size_hint: this.config.batchSize,
    })

    const applyResult = await applyCuratorDecisions(
      { service: this.deps.service, log: this.deps.log },
      response.decisions,
    )

    this.state = {
      ...this.state,
      tickCount: this.state.tickCount + 1,
      lastTickAt: new Date().toISOString(),
      lastResult: applyResult,
      lastError: undefined,
    }

    this.deps.log?.("[curator-loop] tick complete", {
      tickCount: this.state.tickCount,
      decisions: response.decisions.length,
      applied: applyResult.applied.length,
      skipped: applyResult.skipped.length,
      failed: applyResult.failed.length,
      warnings: response.warnings,
    })

    return applyResult
  }

  private async fetchRecentMemories(): Promise<CanonicalMemory[]> {
    const lookbackMs = this.config.lookbackHours * 60 * 60_000
    const minAgeMs = this.config.minAgeMinutes * 60_000
    const now = Date.now()
    const createdAfter = new Date(now - lookbackMs).toISOString()
    const createdBefore = new Date(now - minAgeMs).toISOString()

    const { memories } = await this.deps.service.search("", {
      project_id: this.config.projectId,
      status: "pending_review",
      created_after: createdAfter,
      created_before: createdBefore,
      limit: this.config.batchSize,
    })
    return memories
  }

  private async fetchRelatedMemories(
    recent: CanonicalMemory[],
  ): Promise<CanonicalMemory[]> {
    const projectId = this.config.projectId ?? recent[0]?.project_id
    if (!projectId) return []
    const { memories } = await this.deps.service.search("", {
      project_id: projectId,
      status: "active",
      limit: this.config.batchSize,
    })
    const recentIds = new Set(recent.map((m) => m.memory_id))
    return memories.filter((m) => !recentIds.has(m.memory_id))
  }
}

function toInvokerMemory(memory: CanonicalMemory): Record<string, unknown> {
  return {
    memory_id: memory.memory_id,
    memory_type: memory.memory_type,
    title: memory.title,
    summary: memory.summary,
    why_it_matters: memory.why_it_matters,
    scope: memory.scope,
    tags: memory.tags,
    status: memory.status,
    confidence: memory.confidence,
    source_kind: memory.source_kind,
    source_refs: memory.source_refs,
    created_at: memory.created_at,
    promotion_origin: memory.promotion_origin,
  }
}

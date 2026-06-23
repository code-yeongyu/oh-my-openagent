import type { MemoryCoreService } from "../memory-core/service"
import type { CanonicalMemory } from "../memory-core/types"
import type { CartographerInvoker } from "./cartographer-invoker"
import {
  DEFAULT_SIGNAL_DETECTOR_CONFIG,
  detectDistillationSignal,
  type MemoryCluster,
  type SignalThreshold,
} from "./signal-detector"
import { writeInboxDraft, type WriteInboxDraftDeps } from "./inbox-writer"
import { routeMemoryTypeToMoc } from "./types"

export interface CartographerLoopConfig {
  intervalMs: number
  lookbackHours: number
  minAgeMinutes: number
  maxDraftsPerTick: number
  signalThreshold: SignalThreshold
  minimumObservationsForCluster: number
  projectId?: string
}

export const DEFAULT_CARTOGRAPHER_LOOP_CONFIG: CartographerLoopConfig = {
  intervalMs: 2 * 60 * 60_000,
  lookbackHours: 6,
  minAgeMinutes: 5,
  maxDraftsPerTick: 3,
  signalThreshold: "high",
  minimumObservationsForCluster: 3,
}

export interface CartographerLoopDeps {
  service: MemoryCoreService
  invoker: CartographerInvoker
  inboxDeps: WriteInboxDraftDeps
  config?: Partial<CartographerLoopConfig>
  log?: (message: string, ...args: unknown[]) => void
}

export interface CartographerLoopState {
  isRunning: boolean
  tickCount: number
  lastTickAt?: string
  lastDraftsWritten: number
  lastError?: string
}

export interface TickResult {
  drafts_written: number
  clusters_considered: number
  clusters_skipped_null: number
  errors: number
}

export class CartographerLoop {
  private readonly config: CartographerLoopConfig
  private timer: ReturnType<typeof setInterval> | undefined
  private isTicking = false
  private state: CartographerLoopState = {
    isRunning: false,
    tickCount: 0,
    lastDraftsWritten: 0,
  }

  constructor(private readonly deps: CartographerLoopDeps) {
    this.config = { ...DEFAULT_CARTOGRAPHER_LOOP_CONFIG, ...deps.config }
  }

  start(): void {
    if (this.state.isRunning) return
    this.state = { ...this.state, isRunning: true }
    this.deps.log?.("[cartographer-loop] starting", { config: this.config })
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
    this.deps.log?.("[cartographer-loop] stopped")
  }

  getState(): Readonly<CartographerLoopState> {
    return this.state
  }

  async tick(): Promise<TickResult | undefined> {
    if (this.isTicking) {
      this.deps.log?.("[cartographer-loop] tick skipped: already in flight")
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
      this.deps.log?.("[cartographer-loop] tick failed", { error: message })
    }
  }

  private async runTick(): Promise<TickResult> {
    const result: TickResult = {
      drafts_written: 0,
      clusters_considered: 0,
      clusters_skipped_null: 0,
      errors: 0,
    }

    const recent = await this.fetchRecentMemories()
    const clusters = detectDistillationSignal(recent, {
      threshold: this.config.signalThreshold,
      minimumObservationsForCluster: this.config.minimumObservationsForCluster,
    })
    result.clusters_considered = clusters.length

    const toDraft = clusters.slice(0, this.config.maxDraftsPerTick)
    for (const cluster of toDraft) {
      try {
        const written = await this.distillCluster(cluster)
        if (written) result.drafts_written += 1
        else result.clusters_skipped_null += 1
      } catch (error) {
        result.errors += 1
        this.deps.log?.("[cartographer-loop] cluster distillation failed", {
          cluster_key: cluster.cluster_key,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    this.state = {
      ...this.state,
      tickCount: this.state.tickCount + 1,
      lastTickAt: new Date().toISOString(),
      lastDraftsWritten: result.drafts_written,
      lastError: undefined,
    }

    this.deps.log?.("[cartographer-loop] tick complete", result)
    return result
  }

  private async distillCluster(cluster: MemoryCluster): Promise<boolean> {
    const primaryType = cluster.memories[0]?.memory_type
    const targetMoc = primaryType ? routeMemoryTypeToMoc(primaryType) : undefined
    const response = await this.deps.invoker.invoke({
      source_memories: cluster.memories.map(toInvokerMemory),
      related_context: [],
      project_id: this.config.projectId ?? cluster.memories[0]?.project_id ?? "unknown",
      target_moc_hint: targetMoc,
      current_date: new Date().toISOString().slice(0, 10),
    })

    if (!response.draft) {
      this.deps.log?.("[cartographer-loop] cartographer returned null draft", {
        cluster_key: cluster.cluster_key,
        rationale: response.rationale,
      })
      return false
    }

    const memoryIds = cluster.memories.map((m) => m.memory_id)
    const file = await writeInboxDraft(this.deps.inboxDeps, {
      draft: response.draft,
      source_memory_ids: memoryIds,
      origin: "auto-draft",
    })

    this.deps.log?.("[cartographer-loop] draft written", {
      path: file.path,
      cluster_key: cluster.cluster_key,
      memory_ids: memoryIds,
    })
    return true
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
      limit: 100,
    })
    return memories
  }
}

function toInvokerMemory(memory: CanonicalMemory): Record<string, unknown> {
  return {
    memory_id: memory.memory_id,
    memory_type: memory.memory_type,
    title: memory.title,
    summary: memory.summary,
    why_it_matters: memory.why_it_matters,
    tags: memory.tags,
    scope: memory.scope,
    status: memory.status,
    confidence: memory.confidence,
    source_kind: memory.source_kind,
    source_refs: memory.source_refs,
    created_at: memory.created_at,
    promotion_origin: memory.promotion_origin,
  }
}

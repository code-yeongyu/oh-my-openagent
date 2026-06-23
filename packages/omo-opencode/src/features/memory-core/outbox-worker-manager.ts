import type { MemoryCoreService } from "./service"
import {
  DEFAULT_OUTBOX_WORKER_CONFIG,
  OutboxWorker,
  type OutboxDispatcher,
  type OutboxWorkerConfig,
  type OutboxWorkerDeps,
  type OutboxWorkerState,
} from "./outbox-worker"

export interface OutboxWorkerManagerDeps {
  service: MemoryCoreService
  dispatcher: OutboxDispatcher
  providerNames: string[]
  config?: Partial<OutboxWorkerConfig>
  log?: (message: string, ...args: unknown[]) => void
}

export class OutboxWorkerManager {
  private readonly workers: OutboxWorker[]

  constructor(private readonly deps: OutboxWorkerManagerDeps) {
    this.workers = deps.providerNames.map((providerName) =>
      new OutboxWorker(this.buildWorkerDeps(providerName), deps.config),
    )
  }

  start(): void {
    for (const worker of this.workers) {
      worker.start()
    }
    this.deps.log?.("[outbox-worker-manager] started", {
      providers: this.deps.providerNames,
    })
  }

  stop(): void {
    for (const worker of this.workers) {
      worker.stop()
    }
    this.deps.log?.("[outbox-worker-manager] stopped")
  }

  getStates(): Readonly<Record<string, OutboxWorkerState>> {
    const result: Record<string, OutboxWorkerState> = {}
    for (let i = 0; i < this.deps.providerNames.length; i++) {
      const name = this.deps.providerNames[i]
      const worker = this.workers[i]
      if (name && worker) result[name] = worker.getState()
    }
    return result
  }

  private buildWorkerDeps(providerName: string): OutboxWorkerDeps {
    const service = this.deps.service
    const retryCountsCache = new Map<string, number>()
    return {
      fetchPending: async (limit) => service.getPendingOutbox(providerName, limit),
      claimEntry: async () => true,
      markSynced: async (outboxId) => {
        retryCountsCache.delete(outboxId)
        await service.markOutboxSynced(outboxId)
      },
      markFailed: async (outboxId, error) => {
        await service.markOutboxFailed(outboxId, error)
      },
      incrementRetry: async (outboxId) => {
        const current = (retryCountsCache.get(outboxId) ?? 0) + 1
        retryCountsCache.set(outboxId, current)
        return current
      },
      dispatch: this.deps.dispatcher,
    }
  }
}

export const DEFAULT_OUTBOX_MANAGER_CONFIG = DEFAULT_OUTBOX_WORKER_CONFIG

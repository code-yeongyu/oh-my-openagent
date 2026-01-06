import type { BackgroundTaskConfig } from "../../config/schema"

export class ConcurrencyManager {
  private config?: BackgroundTaskConfig
  private counts: Map<string, number> = new Map()
  private queues: Map<string, Array<() => void>> = new Map()

  constructor(config?: BackgroundTaskConfig) {
    this.config = config
  }

  getConcurrencyLimit(model: string): number {
    const modelLimit = this.config?.modelConcurrency?.[model]
    if (modelLimit !== undefined) {
      return modelLimit === 0 ? Infinity : modelLimit
    }
    const provider = model.split('/')[0]
    const providerLimit = this.config?.providerConcurrency?.[provider]
    if (providerLimit !== undefined) {
      return providerLimit === 0 ? Infinity : providerLimit
    }
    const defaultLimit = this.config?.defaultConcurrency
    if (defaultLimit !== undefined) {
      return defaultLimit === 0 ? Infinity : defaultLimit
    }
    return 5
  }

  async acquire(model: string): Promise<void> {
    const limit = this.getConcurrencyLimit(model)
    if (limit === Infinity) {
      return
    }

    const current = this.counts.get(model) ?? 0
    if (current < limit) {
      this.counts.set(model, current + 1)
      return
    }

    return new Promise<void>((resolve) => {
      const queue = this.queues.get(model) ?? []
      queue.push(resolve)
      this.queues.set(model, queue)
    })
  }

  release(model: string): void {
    const limit = this.getConcurrencyLimit(model)
    if (limit === Infinity) {
      return
    }

    const queue = this.queues.get(model)
    if (queue && queue.length > 0) {
      const next = queue.shift()!
      this.counts.set(model, this.counts.get(model) ?? 0)
      next()
    } else {
      const current = this.counts.get(model) ?? 0
      if (current > 0) {
        this.counts.set(model, current - 1)
      }
    }
  }
}

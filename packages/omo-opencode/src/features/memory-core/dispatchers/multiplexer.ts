import type { OutboxDispatcher } from "../outbox-worker"
import type { OutboxEntry } from "../types"

export interface DispatcherMultiplexer extends OutboxDispatcher {
  register(providerName: string, dispatcher: OutboxDispatcher): void
  has(providerName: string): boolean
}

export function createDispatcherMultiplexer(): DispatcherMultiplexer {
  const registry = new Map<string, OutboxDispatcher>()

  return {
    register(providerName: string, dispatcher: OutboxDispatcher) {
      registry.set(providerName, dispatcher)
    },
    has(providerName: string) {
      return registry.has(providerName)
    },
    async dispatch(entry: OutboxEntry): Promise<void> {
      const dispatcher = registry.get(entry.provider_name)
      if (!dispatcher) {
        throw new Error(`no dispatcher registered for provider: ${entry.provider_name}`)
      }
      await dispatcher.dispatch(entry)
    },
  }
}

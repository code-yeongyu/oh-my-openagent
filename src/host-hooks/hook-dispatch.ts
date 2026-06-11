import type { HostHookTier, TargetHookEventName } from "./event-map"

export type TargetHookEvent = {
  tier: HostHookTier
  name: TargetHookEventName
  payload: unknown
  context: unknown
}

export type TargetHookListener = (event: TargetHookEvent) => unknown | Promise<unknown>

export class TargetHookDispatcher {
  readonly #listeners = new Map<HostHookTier, TargetHookListener[]>()

  on(tier: HostHookTier, listener: TargetHookListener): void {
    const listeners = this.#listeners.get(tier) ?? []
    listeners.push(listener)
    this.#listeners.set(tier, listeners)
  }

  async dispatch(event: TargetHookEvent): Promise<unknown> {
    let result: unknown
    for (const listener of this.#listeners.get(event.tier) ?? []) {
      const candidate = await listener(event)
      if (candidate !== undefined) result = candidate
    }
    return result
  }
}

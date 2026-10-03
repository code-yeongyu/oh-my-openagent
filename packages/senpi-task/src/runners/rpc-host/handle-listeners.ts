import type { ChildEventListener } from "../types"
import { createChildExtensionEvents } from "../child-extension-events"
import type { HostSessionParked } from "./session-client"

type ChildEvent = Parameters<ChildEventListener>[0]

export interface HandleListeners {
  readonly extensionEvents: ReturnType<typeof createChildExtensionEvents>
  subscribe(listener: ChildEventListener): () => boolean
  onParked(listener: (event: HostSessionParked) => void): () => boolean
  onTurnResumed(listener: () => void): () => boolean
  onSelfResumed(listener: () => void): () => boolean
  emitEvent(event: ChildEvent): void
  emitParked(event: HostSessionParked): void
  emitTurnResumed(): void
  emitSelfResumed(): void
  clearActive(): void
}

/** Listener registries that survive a transport replacement and retire with the active handle. */
export function createHandleListeners(): HandleListeners {
  const extensionEvents = createChildExtensionEvents()
  const eventListeners = new Set<ChildEventListener>()
  const parkedListeners = new Set<(event: HostSessionParked) => void>()
  const turnResumedListeners = new Set<() => void>()
  const resumedListeners = new Set<() => void>()

  return {
    extensionEvents,
    subscribe: (listener) => {
      eventListeners.add(listener)
      return () => eventListeners.delete(listener)
    },
    onParked: (listener) => {
      parkedListeners.add(listener)
      return () => parkedListeners.delete(listener)
    },
    onTurnResumed: (listener) => {
      turnResumedListeners.add(listener)
      return () => turnResumedListeners.delete(listener)
    },
    onSelfResumed: (listener) => {
      resumedListeners.add(listener)
      return () => resumedListeners.delete(listener)
    },
    emitEvent: (event) => {
      for (const listener of eventListeners) listener(event)
    },
    emitParked: (event) => {
      for (const listener of parkedListeners) listener(event)
    },
    emitTurnResumed: () => {
      for (const listener of turnResumedListeners) listener()
    },
    emitSelfResumed: () => {
      for (const listener of resumedListeners) listener()
    },
    clearActive: () => {
      extensionEvents.clear()
      eventListeners.clear()
      turnResumedListeners.clear()
      resumedListeners.clear()
    },
  }
}

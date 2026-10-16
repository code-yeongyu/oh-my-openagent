import type { ChildEventListener } from "../types"
import { type ChildExtensionListener, createChildExtensionEvents } from "../child-extension-events"
import type { HostSessionParked } from "./session-client"

type ChildEvent = Parameters<ChildEventListener>[0]

/** The handle's listener-registration surface, spread 1:1 onto the returned handle. */
export interface ListenerRegistrations {
  subscribe(listener: ChildEventListener): () => boolean
  subscribeExtensionEvents(listener: ChildExtensionListener): () => void
  onParked(listener: (event: HostSessionParked) => void): () => boolean
  onTurnResumed(listener: () => void): () => boolean
  onSelfResumed(listener: () => void): () => boolean
}

export interface HandleListeners {
  readonly extensionEvents: ReturnType<typeof createChildExtensionEvents>
  readonly registrations: ListenerRegistrations
  emitEvent(event: ChildEvent): void
  emitParked(event: HostSessionParked): void
  emitTurnResumed(): void
  emitSelfResumed(): void
  clearActive(): void
}

/**
 * Events a warm host delivers before the manager subscribes. The manager attaches its observers only
 * after `start` returns, and a warm host can run a whole first turn (a fallback hop included) in that
 * window (#9512). Every one of them is kept until the first observer attaches - a partial history
 * would bring the record gap back - then replayed to each observer attached in that same tick and
 * released.
 *
 * Until the release, the buffer is the single ordered log: an event that arrives meanwhile (even one a
 * listener causes during its own replay) is appended to it, reaches an observer still replaying through
 * its read cursor, and goes live only to observers that already finished replaying. Every observer
 * therefore sees each event exactly once, in emission order. A listener that throws during replay is
 * reported through `onListenerError` instead of escaping `subscribe`, which runs after the child is
 * already live.
 */

export interface HandleListenersOptions {
  onListenerError?(error: unknown): void
}

/** Listener registries that survive a transport replacement and retire with the active handle. */
export function createHandleListeners(options: HandleListenersOptions = {}): HandleListeners {
  const extensionEvents = createChildExtensionEvents()
  const eventListeners = new Set<ChildEventListener>()
  let earlyEvents: ChildEvent[] | undefined = []
  const replayed = new Set<ChildEventListener>()
  const releaseEarlyEvents = (): void => {
    earlyEvents = undefined
    replayed.clear()
  }
  const replayEarlyEvents = (listener: ChildEventListener): void => {
    if (earlyEvents === undefined) return
    if (eventListeners.size === 1) queueMicrotask(releaseEarlyEvents)
    for (let index = 0; earlyEvents !== undefined && index < earlyEvents.length; index++) {
      try {
        listener(earlyEvents[index] as ChildEvent)
      } catch (error) {
        options.onListenerError?.(error)
      }
    }
    if (earlyEvents !== undefined) replayed.add(listener)
  }
  const parkedListeners = new Set<(event: HostSessionParked) => void>()
  const turnResumedListeners = new Set<() => void>()
  const resumedListeners = new Set<() => void>()

  const registrations: ListenerRegistrations = {
    subscribe: (listener) => {
      eventListeners.add(listener)
      replayEarlyEvents(listener)
      return () => eventListeners.delete(listener)
    },
    subscribeExtensionEvents: extensionEvents.subscribe,
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
  }

  return {
    extensionEvents,
    registrations,
    emitEvent: (event) => {
      if (earlyEvents !== undefined) {
        earlyEvents.push(event)
        for (const listener of [...replayed]) if (eventListeners.has(listener)) listener(event)
        return
      }
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
      releaseEarlyEvents()
      extensionEvents.clear()
      eventListeners.clear()
      turnResumedListeners.clear()
      resumedListeners.clear()
    },
  }
}

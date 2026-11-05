/// <reference types="bun-types" />

// config-watch on the hand side of a split session (brain/hand plan row O11a). A hand opens one loopless runtime, with
// its own event bus, per execution scope and never emits `session_shutdown`; its scope's close is delivered through a
// lifecycle source instead. The registration of each scope must live exactly as long as that scope.

import { describe, expect, it } from "bun:test"

import type { ComponentContext, SenpiExtensionAPI } from "../../extension/types"
import type { ConfigWatchLifecycleSource } from "./hand-lifetime"
import { createConfigWatchComponent } from "./index"

type EventHandler = (payload: unknown) => void

class ScopeBus {
  readonly registerEmits: unknown[] = []
  private readonly listeners = new Map<string, Set<EventHandler>>()

  emit(name: string, payload: unknown): void {
    if (name === "config-watch:register") this.registerEmits.push(payload)
    for (const handler of this.listeners.get(name) ?? []) handler(payload)
  }

  on(name: string, handler: EventHandler): () => void {
    const handlers = this.listeners.get(name) ?? new Set<EventHandler>()
    handlers.add(handler)
    this.listeners.set(name, handlers)
    return () => {
      handlers.delete(handler)
    }
  }

  listenerCount(): number {
    return [...this.listeners.values()].reduce((count, handlers) => count + handlers.size, 0)
  }
}

class HandScope {
  readonly bus = new ScopeBus()
  private readonly closers: Array<() => void> = []
  private readonly loopHandlers = new Map<string, Array<() => void>>()
  readonly lifecycle: ConfigWatchLifecycleSource = { onClose: (listener) => void this.closers.push(listener) }
  readonly pi = {
    events: this.bus,
    on: (event: string, handler: () => void) => {
      this.loopHandlers.set(event, [...(this.loopHandlers.get(event) ?? []), handler])
    },
  } as unknown as SenpiExtensionAPI

  close(): void {
    for (const closer of this.closers.splice(0)) closer()
  }

  emitLoopEvent(event: string): void {
    for (const handler of this.loopHandlers.get(event) ?? []) handler()
  }
}

const ctx: ComponentContext = { logger: { info() {}, warn() {}, error() {} }, config: { getFlag: () => undefined } }

function handComponent(scopes: Map<SenpiExtensionAPI, HandScope>) {
  return createConfigWatchComponent({
    resolveCwd: () => "/project",
    resolveTargets: () => [{ path: "/project/.omo", kind: "dir", filterGlobs: ["omo.json", "omo.jsonc"] }],
    createValidator: () => ({ validate: () => ({ ok: true }) }),
    lifecycle: (pi) => scopes.get(pi)?.lifecycle,
  })
}

describe("config-watch on the hand side of a split session", () => {
  it("#given a hand scope's registration #when the scope closes #then every config-watch listener is released once", () => {
    // given
    const scope = new HandScope()
    handComponent(new Map([[scope.pi, scope]])).register(scope.pi, ctx)
    expect(scope.bus.listenerCount()).toBe(4)

    // when
    scope.close()

    // then
    expect(scope.bus.listenerCount()).toBe(0)
  })

  it("#given a hand scope's registration #when only loop events arrive #then the registration stays until the scope closes", () => {
    // given
    const scope = new HandScope()
    handComponent(new Map([[scope.pi, scope]])).register(scope.pi, ctx)

    // when
    scope.emitLoopEvent("session_shutdown")

    // then
    expect(scope.bus.listenerCount()).toBe(4)
  })

  it("#given two hand scopes served by one component #when the second registers and the first closes #then each keeps exactly its own registration", () => {
    // given
    const first = new HandScope()
    const second = new HandScope()
    const component = handComponent(new Map([[first.pi, first], [second.pi, second]]))
    component.register(first.pi, ctx)

    // when
    component.register(second.pi, ctx)
    const firstAfterSecondRegistered = first.bus.listenerCount()
    first.close()

    // then
    expect(firstAfterSecondRegistered).toBe(4)
    expect(first.bus.listenerCount()).toBe(0)
    expect(second.bus.listenerCount()).toBe(4)
    expect(second.bus.registerEmits).toHaveLength(1)
  })
})

/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import type { ComponentContext, SenpiExtensionAPI } from "../../extension/types"
import { createConfigWatchComponent } from "./index"

type EventHandler = (payload: unknown) => void

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
}

type Registration = {
  readonly id: string
  readonly displayName: string
  readonly targets: readonly { readonly path: string; readonly kind: "dir"; readonly filterGlobs: readonly string[] }[]
  readonly validate: (paths: readonly string[]) => { ok: true } | { ok: false; errors: string[] }
}

function isRegistration(value: unknown): value is Registration {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === "string" &&
    typeof record.displayName === "string" &&
    Array.isArray(record.targets) &&
    record.targets.every(
      (target) =>
        typeof target === "object" &&
        target !== null &&
        !Array.isArray(target) &&
        (() => {
          const targetRecord = target as Record<string, unknown>
          return (
            typeof targetRecord.path === "string" &&
            targetRecord.kind === "dir" &&
            isStringArray(targetRecord.filterGlobs)
          )
        })(),
    ) &&
    typeof record.validate === "function"
  )
}

class FakeEvents {
  readonly registrations = new Map<string, Registration>()
  private readonly listeners = new Map<string, Set<EventHandler>>()

  emit(name: string, payload: unknown): void {
    if (name === "config-watch:register" && isRegistration(payload)) this.registrations.set(payload.id, payload)
    for (const handler of this.listeners.get(name) ?? []) handler(payload)
  }

  on(name: string, handler: EventHandler): () => void {
    const handlers = this.listeners.get(name) ?? new Set<EventHandler>()
    handlers.add(handler)
    this.listeners.set(name, handlers)
    return () => {
      handlers.delete(handler)
      if (handlers.size === 0) this.listeners.delete(name)
    }
  }

  listenerCount(): number {
    return [...this.listeners.values()].reduce((count, handlers) => count + handlers.size, 0)
  }
}

function createPi(events?: FakeEvents): SenpiExtensionAPI & { dispatch(name: string, payload?: unknown): void } {
  const handlers = new Map<string, EventHandler[]>()
  return {
    ...(events === undefined ? {} : { events }),
    on(name, handler) {
      const registered = handlers.get(name) ?? []
      registered.push((payload) => void handler(payload))
      handlers.set(name, registered)
    },
    registerTool() {},
    registerCommand() {},
    registerFlag() {},
    getFlag() {
      return undefined
    },
    sendMessage() {},
    sendUserMessage() {},
    dispatch(name, payload) {
      for (const handler of handlers.get(name) ?? []) handler(payload)
    },
  }
}

function createContext(logs: Array<{ level: string; message: string; details?: unknown }>): ComponentContext {
  return {
    config: { getFlag: () => undefined },
    logger: {
      info(message, details) {
        logs.push({ level: "info", message, details })
      },
      warn(message, details) {
        logs.push({ level: "warn", message, details })
      },
      error() {},
    },
  }
}

function createComponent() {
  return createConfigWatchComponent({
    resolveCwd: () => "/project",
    resolveTargets: () => [{ path: "/project/.omo", kind: "dir", filterGlobs: ["omo.jsonc", "omo.json"] }],
    createValidator: () => ({ validate: () => ({ ok: true }) }),
  })
}

describe("createConfigWatchComponent", () => {
  it("emits one wire-valid omo registration immediately", () => {
    const events = new FakeEvents()
    const pi = createPi(events)

    createComponent().register(pi, createContext([]))

    expect(events.registrations.size).toBe(1)
    expect(events.registrations.get("omo")).toSatisfy(isRegistration)
  })

  it("skips without the optional events capability", () => {
    const logs: Array<{ level: string; message: string; details?: unknown }> = []

    createComponent().register(createPi(), createContext(logs))

    expect(logs).toEqual([{ level: "warn", message: "config-watch skipped: events capability missing", details: undefined }])
  })

  it("warns that creating user config later requires a reload when its directory and parent are absent", () => {
    const events = new FakeEvents()
    const logs: Array<{ level: string; message: string; details?: unknown }> = []
    createConfigWatchComponent({
      resolveCwd: () => "/project",
      resolveTargetResolution: () => ({
        targets: [],
        userConfigCreationWatched: false,
        userConfigCreationDiscovery: "reload_required" as const,
      }),
      createValidator: () => ({ validate: () => ({ ok: true }) }),
    }).register(createPi(events), createContext(logs))

    expect(logs).toEqual([
      {
        level: "warn",
        message: "config-watch user config discovery requires reload",
        details: { userConfigCreationDiscovery: "reload_required" },
      },
    ])
  })

  it("logs omo reload and rejection outcomes with paths and errors", () => {
    const events = new FakeEvents()
    const logs: Array<{ level: string; message: string; details?: unknown }> = []
    createComponent().register(createPi(events), createContext(logs))

    events.emit("config-watch:reloaded", { registrationId: "omo", paths: ["/project/.omo/omo.jsonc"] })
    events.emit("config-watch:rejected", {
      registrationId: "omo",
      paths: ["/project/.omo/omo.jsonc"],
      errors: ["invalid config"],
    })

    expect(logs).toEqual([
      { level: "info", message: "omo config hot-reloaded", details: { paths: ["/project/.omo/omo.jsonc"], pathCount: 1 } },
      {
        level: "warn",
        message: "omo config hot-reload rejected",
        details: { paths: ["/project/.omo/omo.jsonc"], pathCount: 1, errors: ["invalid config"], errorCount: 1 },
      },
    ])
  })

  it("refreshes targets after rejection without replacing the sticky validator", () => {
    const events = new FakeEvents()
    const pi = createPi(events)
    const validate = () => ({ ok: false as const, errors: ["still invalid"] })
    let targetPass = 0
    createConfigWatchComponent({
      resolveCwd: () => "/project",
      resolveTargets: () => {
        targetPass += 1
        return targetPass === 1
          ? [{ path: "/project", kind: "dir", filterGlobs: [".omo"] }]
          : [
              { path: "/project", kind: "dir", filterGlobs: [".omo"] },
              { path: "/project/.omo", kind: "dir", filterGlobs: ["omo.jsonc", "omo.json"] },
            ]
      },
      createValidator: () => ({ validate }),
    }).register(pi, createContext([]))

    const before = events.registrations.get("omo")
    events.emit("config-watch:rejected", { registrationId: "omo", paths: ["/project/.omo"], errors: ["invalid config"] })
    const after = events.registrations.get("omo")

    expect(after?.targets).toHaveLength(2)
    expect(after?.validate).toBe(before?.validate)
  })

  it("releases event subscriptions on shutdown and replaces subscriptions on repeated register", () => {
    const events = new FakeEvents()
    const pi = createPi(events)
    const component = createComponent()

    component.register(pi, createContext([]))
    expect(events.listenerCount()).toBe(3)
    component.register(pi, createContext([]))
    expect(events.listenerCount()).toBe(3)

    pi.dispatch("session_shutdown")
    expect(events.listenerCount()).toBe(0)
  })

  it("keeps one active registration when ready is emitted repeatedly", () => {
    const events = new FakeEvents()
    const pi = createPi(events)
    createComponent().register(pi, createContext([]))

    events.emit("config-watch:ready", undefined)
    events.emit("config-watch:ready", undefined)

    expect(events.registrations.size).toBe(1)
    expect(events.registrations.get("omo")?.id).toBe("omo")
  })
})

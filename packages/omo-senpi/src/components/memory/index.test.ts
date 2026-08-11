import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { MEMORY_BINDING_CUSTOM_TYPE, createMemoryComponent, memoryModuleSupervisor, resolveMemoryConfig } from "./index"
import { componentContext, loadedMemoryConfig, memorySettings, MemoryFakeExtensionAPI, sessionContext } from "./memory.test-support"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(): { cwd: string; memoryHome: string } {
  const root = mkdtempSync(join(tmpdir(), "omo-memory-component-"))
  roots.push(root)
  return { cwd: join(root, "project"), memoryHome: join(root, "memory") }
}

function eventBus(): {
  emit(name: string, payload: unknown): void
  on(name: string, handler: (payload: unknown) => void): () => void
} {
  const handlers = new Map<string, Set<(payload: unknown) => void>>()
  return {
    emit(name, payload) { for (const handler of handlers.get(name) ?? []) handler(payload) },
    on(name, handler) {
      const listeners = handlers.get(name) ?? new Set<(payload: unknown) => void>()
      listeners.add(handler)
      handlers.set(name, listeners)
      return () => listeners.delete(handler)
    },
  }
}

describe("createMemoryComponent", () => {
  test("#given missing custom-entry capabilities #when registered #then it warns once and registers nothing", () => {
    const pi = new FakeExtensionAPI()
    const ctx = componentContext()

    createMemoryComponent({ loadConfig: () => loadedMemoryConfig(memorySettings()) }).register(pi, ctx)

    expect(ctx.logs.filter((entry) => entry.level === "warn")).toHaveLength(1)
    expect(pi.handlers).toEqual([])
    expect(pi.tools).toEqual([])
    expect(pi.commands).toEqual([])
  })

  test("#given no memory section #when config resolves #then memory defaults enabled with the auto identity", () => {
    expect(resolveMemoryConfig({ config: {}, diagnostics: [], layers: [], sources: [] })).toEqual(memorySettings())
  })

  test("#given disabled config or a global/component disable flag #when registered #then the host registration surface is byte-identical", () => {
    for (const scenario of [
      { memory: memorySettings({ enabled: false }), flags: {} },
      { memory: memorySettings(), flags: { "omo-senpi-disabled": true } },
      { memory: memorySettings(), flags: { "omo-senpi-memory-disabled": true } },
    ]) {
      const pi = new MemoryFakeExtensionAPI()
      const ctx = componentContext(scenario.flags)

      createMemoryComponent({ loadConfig: () => loadedMemoryConfig(scenario.memory) }).register(pi, ctx)

      expect({ handlers: pi.handlers, tools: pi.tools, commands: pi.commands, renderers: pi.entryRenderers }).toEqual({
        handlers: [], tools: [], commands: [], renderers: [],
      })
    }
  })

  test("#given enabled memory #when session_start binds an auto identity #then it appends a hidden binding and performs no filesystem writes", async () => {
    const { cwd, memoryHome } = fixture()
    const pi = new MemoryFakeExtensionAPI()
    const ctx = componentContext()
    const notifications: Array<{ message: string; level: string }> = []
    createMemoryComponent({
      env: { OMO_MEMORY_HOME: memoryHome },
      loadConfig: () => loadedMemoryConfig(memorySettings()),
      now: () => 123,
      resolveCwd: () => cwd,
    }).register(pi, ctx)

    await pi.dispatch("session_start", {}, sessionContext({ notifications }))

    expect(pi.entryRenderers.map((entry) => entry.customType)).toEqual([
      "senpi-memory.reflection-completion",
      MEMORY_BINDING_CUSTOM_TYPE,
    ])
    // Direct registration is the default surface so memory always works; the exposure-search MCP
    // variant is an explicit opt-in asserted in tool-surface.test.ts.
    expect(pi.tools.map((tool) => tool.name)).toEqual(["memory", "memory_apply_patch"])
    expect(pi.mcpServers.map((server) => server.name)).toEqual([])
    expect(pi.entries).toEqual([{
      customType: MEMORY_BINDING_CUSTOM_TYPE,
      data: expect.objectContaining({ identity: expect.stringMatching(/^project-[a-f0-9]{8}$/), boundAt: 123 }),
    }])
    expect(existsSync(memoryHome)).toBe(false)
    expect(notifications).toEqual([])
    await pi.dispatch("session_shutdown", {}, sessionContext())
  })

  test("#given a resumed session bound to another identity #when session_start resolves fresh config #then it notifies an error and fails closed without rebinding", async () => {
    const { cwd, memoryHome } = fixture()
    const pi = new MemoryFakeExtensionAPI()
    const notifications: Array<{ message: string; level: string }> = []
    createMemoryComponent({
      env: { OMO_MEMORY_HOME: memoryHome },
      loadConfig: () => loadedMemoryConfig(memorySettings({ agent: "fresh" })),
      resolveCwd: () => cwd,
    }).register(pi, componentContext())

    await pi.dispatch("session_start", {}, sessionContext({
      entries: [{
        type: "custom",
        customType: MEMORY_BINDING_CUSTOM_TYPE,
        data: { identity: "different-identity", repoPathHash: "hash", boundAt: 1 },
      }],
      notifications,
    }))

    expect(pi.entries).toEqual([])
    expect(existsSync(memoryHome)).toBe(false)
    expect(notifications).toEqual([{
      message: expect.stringContaining("memory identity conflict"),
      level: "error",
    }])
  })

  test("#given enablement latched false or true at session_start #when config reload flips it #then registration stays fixed and restart notice appears once", async () => {
    for (const latchedEnabled of [false, true]) {
      const { cwd, memoryHome } = fixture()
      const pi = new MemoryFakeExtensionAPI()
      pi.events = eventBus()
      const notifications: Array<{ message: string; level: string }> = []
      let reads = 0
      const states = [true, latchedEnabled, !latchedEnabled, !latchedEnabled]
      createMemoryComponent({
        env: { OMO_MEMORY_HOME: memoryHome },
        loadConfig: () => loadedMemoryConfig(memorySettings({ enabled: states[Math.min(reads++, states.length - 1)] })),
        resolveCwd: () => cwd,
      }).register(pi, componentContext())
      await pi.dispatch("session_start", {}, sessionContext({ notifications }))
      const registrations = { handlers: pi.handlers.length, renderers: pi.entryRenderers.length, entries: pi.entries.length }

      pi.events.emit("config-watch:reloaded", { registrationId: "omo", paths: ["omo.jsonc"] })
      pi.events.emit("config-watch:reloaded", { registrationId: "omo", paths: ["omo.jsonc"] })

      expect({ handlers: pi.handlers.length, renderers: pi.entryRenderers.length, entries: pi.entries.length }).toEqual(registrations)
      expect(notifications).toEqual([{
        message: "restart required to apply memory config change",
        level: "warning",
      }])
      await pi.dispatch("session_shutdown", {}, sessionContext())
    }
  })

  test("#given per-instance module state #when session_shutdown fires #then the identity context and supervisor reference are released", async () => {
    const { cwd, memoryHome } = fixture()
    const pi = new MemoryFakeExtensionAPI()
    const before = memoryModuleSupervisor.refCount
    createMemoryComponent({
      env: { OMO_MEMORY_HOME: memoryHome },
      loadConfig: () => loadedMemoryConfig(memorySettings()),
      resolveCwd: () => cwd,
    }).register(pi, componentContext())
    const live = sessionContext({ sessionId: "cleanup-session" })
    await pi.dispatch("session_start", {}, live)
    expect(memoryModuleSupervisor.refCount).toBe(before + 1)

    await pi.dispatch("session_shutdown", {}, live)

    expect(memoryModuleSupervisor.refCount).toBe(before)
  })

  test("#given a stale footer #when session start exits disabled or conflicted #then the status is cleared first", async () => {
    for (const scenario of ["disabled", "conflicted"] as const) {
      const { cwd, memoryHome } = fixture()
      const pi = new MemoryFakeExtensionAPI()
      const statusCalls: Array<{ key: string; text: string | undefined }> = []
      let reads = 0
      createMemoryComponent({
        env: { OMO_MEMORY_HOME: memoryHome },
        loadConfig: () => loadedMemoryConfig(memorySettings({
          enabled: scenario === "disabled" ? reads++ === 0 : true,
          ...(scenario === "conflicted" ? { agent: "fresh" } : {}),
        })),
        resolveCwd: () => cwd,
      }).register(pi, componentContext())

      await pi.dispatch("session_start", {}, {
        sessionManager: {
          getEntries: () => scenario === "conflicted"
            ? [{
                type: "custom",
                customType: MEMORY_BINDING_CUSTOM_TYPE,
                data: { identity: "different-identity", repoPathHash: "hash", boundAt: 1 },
              }]
            : [],
          getSessionId: () => `session-${scenario}`,
        },
        ui: {
          notify: () => {},
          setStatus: (key: string, text: string | undefined) => statusCalls.push({ key, text }),
        },
      })

      expect(statusCalls).toEqual([{ key: "memory", text: undefined }])
    }
  })
})

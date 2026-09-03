import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rmSyncEfaultTolerant } from "./teardown.test-support"

import { OmoMemorySettingsSchema } from "@oh-my-opencode/omo-config-core"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import {
  MEMORY_BINDING_CUSTOM_TYPE,
  createMemoryComponent,
  isMemoryChildProcess,
  memoryModuleSupervisor,
  resolveMemoryConfig,
} from "./index"
import { componentContext, loadedMemoryConfig, memorySettings, MemoryFakeExtensionAPI, sessionContext } from "./memory.test-support"
import { MEMORY_WRITE_UPDATED_ENTRY_TYPE } from "./memory-notice-wiring"
import { GATE_ENTRY_TYPE, NUDGED_ENTRY_TYPE } from "./memorian-notice"
import { RECALL_CUSTOM_TYPE } from "./recall-wiring"
import { SOUL_UPDATED_ENTRY_TYPE } from "./soul-notice"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSyncEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
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

  test("#given no memory key in config #when resolved through adapter fallback #then it matches parsing {} through the schema", () => {
    // given
    const emptyConfigResult = { config: {}, diagnostics: [] as const, layers: [] as const, sources: [] as const }
    const schemaParsed = OmoMemorySettingsSchema.parse({})

    // when
    const fallbackResolved = resolveMemoryConfig(emptyConfigResult)

    // then
    expect(fallbackResolved).toEqual(schemaParsed)
    expect(fallbackResolved).toEqual(memorySettings())
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

  test("#given a memory child sentinel in env #when registered #then memory registers nothing so a forked child cannot recurse", () => {
    // A fork-mode child loads extensions (the request prefix must match its parent for the provider
    // cache to hit), so --no-extensions no longer protects against recursion. The sentinel that the
    // child already carries must therefore act as a hard disable.
    for (const sentinel of ["SENPI_MEMORY_REFLECTION", "SENPI_MEMORY_FACTS", "SENPI_MEMORY_MEMORIAN"]) {
      const pi = new MemoryFakeExtensionAPI()
      const ctx = componentContext()

      createMemoryComponent({
        loadConfig: () => loadedMemoryConfig(memorySettings()),
        env: { [sentinel]: "1" },
      }).register(pi, ctx)

      expect({ sentinel, handlers: pi.handlers, tools: pi.tools, commands: pi.commands, renderers: pi.entryRenderers }).toEqual({
        sentinel, handlers: [], tools: [], commands: [], renderers: [],
      })
      expect({ sentinel, child: isMemoryChildProcess({ [sentinel]: "1" }) }).toEqual({ sentinel, child: true })
    }
  })

  test("#given the sentinel is absent or not exactly 1 #when registered #then memory stays enabled", () => {
    for (const env of [{}, { SENPI_MEMORY_REFLECTION: "0" }, { SENPI_MEMORY_REFLECTION: "" }]) {
      const pi = new MemoryFakeExtensionAPI()
      const ctx = componentContext()

      createMemoryComponent({ loadConfig: () => loadedMemoryConfig(memorySettings()), env }).register(pi, ctx)

      expect(pi.handlers.length).toBeGreaterThan(0)
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
      createRuntime: () => {
        throw new Error("bind-only test does not create an identity runtime")
      },
    }).register(pi, ctx)

    await pi.dispatch("session_start", {}, sessionContext({ notifications }))

    expect(pi.entryRenderers.map((entry) => entry.customType)).toEqual([
      "senpi-memory.reflection-completion",
      "senpi-memory.reflection-launched",
      "senpi-memory.reflection-summary",
      "senpi-memory.health",
      SOUL_UPDATED_ENTRY_TYPE,
      MEMORY_WRITE_UPDATED_ENTRY_TYPE,
      RECALL_CUSTOM_TYPE,
      NUDGED_ENTRY_TYPE,
      GATE_ENTRY_TYPE,
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
    memoryModuleSupervisor.release()
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

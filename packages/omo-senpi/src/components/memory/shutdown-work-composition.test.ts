// Composition half of the shutdown-reads table (shutdown-work-settled.test.ts): the real memory component registers
// every hook through the tracked API, and its session_shutdown drain waits on that tracked work (#11135).

import { afterEach, describe, expect, it } from "bun:test"
import { join } from "node:path"

import { createMemoryComponent } from "./index"
import { MemoryFakeExtensionAPI, componentContext, loadedMemoryConfig, memorySettings } from "./memory.test-support"
import {
  EMPTY_SWEEP,
  gate,
  gatedStep,
  idleSyncRunner,
  launchlessRuntime,
  removeTempRoots,
  sessionEventContext,
  tempRoot,
} from "./shutdown-work.test-support"

afterEach(removeTempRoots)

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

describe("memory component shutdown composition", () => {
  it("#given the real memory component #when it registers #then every hook but session_shutdown, and every tool execute, is tracked", () => {
    // given
    const pi = new MemoryFakeExtensionAPI()

    // when
    createMemoryComponent({
      env: { OMO_MEMORY_HOME: join("unused-memory-root", "memory") },
      loadConfig: () => loadedMemoryConfig(memorySettings()),
      resolveCwd: () => "unused-project",
      sweepTransientRuns: async () => EMPTY_SWEEP,
      syncRunner: idleSyncRunner,
      createRuntime: launchlessRuntime,
    }).register(pi, componentContext())

    // then
    const tracked = (event: string): boolean => event !== "session_shutdown"
    const misrouted = pi.handlers
      .filter((registration) => (registration.handler.name === "trackedMemoryHook") !== tracked(registration.event))
      .map((registration) => registration.event)
    const untrackedTools = pi.tools
      .filter((tool) => typeof tool.execute !== "function" || tool.execute.name !== "trackedMemoryTool")
      .map((tool) => String(tool.name))
    expect(pi.handlers.length).toBeGreaterThan(0)
    expect(pi.tools.length).toBeGreaterThan(0)
    expect(misrouted).toEqual([])
    expect(untrackedTools).toEqual([])
  })

  it("#given memory work still running #when the session shuts down #then the drain waits on it and reports it detached by step when its budget runs out", async () => {
    // given
    const held = gate()
    const { step, finished } = gatedStep(held)
    const root = await tempRoot("omo-shutdown-work-component-")
    const ctx = componentContext()
    const pi = new MemoryFakeExtensionAPI()
    createMemoryComponent({
      env: { OMO_MEMORY_HOME: join(root, "memory") },
      loadConfig: () => loadedMemoryConfig(memorySettings()),
      resolveCwd: () => join(root, "project"),
      sweepTransientRuns: async () => (await step(), EMPTY_SWEEP),
      syncRunner: idleSyncRunner,
      createRuntime: launchlessRuntime,
    }).register(pi, ctx)
    await held.entered

    // when
    await pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, sessionEventContext("session-shutdown"))

    // then
    const detached = ctx.logs.filter((log) => isRecord(log.details) && log.details.step === "memory-work-settle" && "remainingMs" in log.details)
    held.open()
    await finished
    expect(detached).toHaveLength(1)
  }, process.platform === "win32" ? 20_000 : 5_000)
})

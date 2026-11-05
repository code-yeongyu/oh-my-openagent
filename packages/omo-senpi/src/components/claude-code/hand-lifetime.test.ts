/// <reference types="bun-types" />

// claude-code on the hand side of a split session (brain/hand plan row O11h). The Claude Code executable is fetched
// for the provider's turns, which run on the loop side; a hand (tools, no agent loop) never emits `input` or
// `before_agent_start`. The component is loaded through senpi's own loader, so the side filter under test is the host's.

import { afterAll, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import type { ComponentContext, SenpiExtensionAPI } from "../../extension/types"
import { CLAUDE_CODE_PIN_FILE, createClaudeCodeComponent } from "./index"

type ExtensionSide = "brain" | "hand"

interface LoadedExtension {
  readonly handlers: Map<string, unknown[]>
}

interface SenpiLoader {
  loadExtensionFromFactory(
    factory: (pi: unknown) => Promise<void>,
    cwd: string,
    eventBus: unknown,
    runtime: unknown,
    extensionPath: string,
    session: { sessionKind: "interactive"; sessionContext: Record<string, string>; side?: ExtensionSide },
  ): Promise<LoadedExtension>
  createExtensionRuntime(): unknown
}

const senpiDistDir = dirname(fileURLToPath(import.meta.resolve("@code-yeongyu/senpi")))
const loader = (await import(pathToFileURL(join(senpiDistDir, "core", "extensions", "loader.js")).href)) as SenpiLoader
const eventBus = (await import(pathToFileURL(join(senpiDistDir, "core", "event-bus.js")).href)) as { createEventBus(): unknown }

const ctx: ComponentContext = { logger: { info() {}, warn() {}, error() {} }, config: { getFlag: () => undefined } }

function loadFor(register: (pi: SenpiExtensionAPI) => void, side: ExtensionSide | undefined): Promise<LoadedExtension> {
  const factory = async (pi: unknown): Promise<void> => register(pi as SenpiExtensionAPI)
  return loader.loadExtensionFromFactory(factory, process.cwd(), eventBus.createEventBus(), loader.createExtensionRuntime(), "<claude-code>", {
    sessionKind: "interactive",
    sessionContext: {},
    ...(side === undefined ? {} : { side }),
  })
}

function handlerCounts(loaded: LoadedExtension, events: readonly string[]): Record<string, number> {
  return Object.fromEntries(events.map((event) => [event, (loaded.handlers.get(event) ?? []).length]))
}

const TURN_EVENTS = ["input", "before_agent_start"] as const
const runtimeDir = mkdtempSync(join(tmpdir(), "omo-claude-code-hand-"))
writeFileSync(join(runtimeDir, CLAUDE_CODE_PIN_FILE), JSON.stringify({ name: "@anthropic-ai/claude-code", version: "1.0.0", integrity: "sha512-test" }))

afterAll(() => rmSync(runtimeDir, { recursive: true, force: true }))

function loadClaudeCode(side: ExtensionSide | undefined): Promise<LoadedExtension> {
  return loadFor((pi) => createClaudeCodeComponent({ env: { OMO_PACKAGE_DIR: runtimeDir }, which: () => null }).register(pi, ctx), side)
}

describe("claude-code on the hand side of a split session", () => {
  it("#given a pinned install #when the host loads the component for the hand #then no acquisition handler is registered there", async () => {
    // when
    const hand = await loadClaudeCode("hand")

    // then
    expect(handlerCounts(hand, TURN_EVENTS)).toEqual({ input: 0, before_agent_start: 0 })
  })

  it("#given a pinned install #when the host loads the component for the brain #then both acquisition handlers stay on the loop side", async () => {
    // when
    const brain = await loadClaudeCode("brain")

    // then
    expect(handlerCounts(brain, TURN_EVENTS)).toEqual({ input: 1, before_agent_start: 1 })
  })

  it("#given a pinned install on a fused session #then both acquisition handlers are registered exactly as today", async () => {
    // when
    const fused = await loadClaudeCode(undefined)

    // then
    expect(handlerCounts(fused, TURN_EVENTS)).toEqual({ input: 1, before_agent_start: 1 })
  })
})

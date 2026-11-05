/// <reference types="bun-types" />

// Plan row O6 (onboarding on a split session). The onboarding flow is loop and UI work: its prompt claim, turn
// tracking, welcome and release must exist only where the loop runs. The hand of a split session executes the
// component's tools and nothing else. A fused session registers exactly what it registers today.

import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { composeOmoSenpiExtension } from "../../extension/compose"
import { createOnboardingComponent } from "./component"
import { hermeticScanEnvironment } from "./test-harness"

type ExtensionSide = "brain" | "hand"

interface LoadedExtension {
  readonly handlers: Map<string, unknown[]>
  readonly tools: Map<string, { readonly definition: { readonly name: string; readonly parameters: unknown } }>
  readonly flags: Map<string, unknown>
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

const LOOP_EVENTS = [
  "session_start",
  "before_agent_start",
  "agent_start",
  "agent_end",
  "agent_settled",
  "input_disposition",
  "session_abort",
  "session_shutdown",
] as const

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function onboardingExtension(withOnboarding = true): (pi: unknown) => Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "omo-onboarding-split-"))
  dirs.push(dir)
  const component = createOnboardingComponent({
    claimOnboarding: () => false,
    isOnboardingComplete: () => true,
    releaseOnboarding: () => undefined,
    scan: async () => undefined,
    stateDir: dir,
    scanEnvironment: hermeticScanEnvironment(dir),
  })
  return composeOmoSenpiExtension(withOnboarding ? [component] : []) as (pi: unknown) => Promise<void>
}

function load(side: ExtensionSide | undefined, withOnboarding = true): Promise<LoadedExtension> {
  return loader.loadExtensionFromFactory(onboardingExtension(withOnboarding), process.cwd(), eventBus.createEventBus(), loader.createExtensionRuntime(), "<omo-senpi>", {
    sessionKind: "interactive",
    sessionContext: {},
    ...(side === undefined ? {} : { side }),
  })
}

function handlerCounts(loaded: LoadedExtension): Record<string, number> {
  return Object.fromEntries(LOOP_EVENTS.map((event) => [event, loaded.handlers.get(event)?.length ?? 0]))
}

function catalog(loaded: LoadedExtension): { tools: Array<{ name: string; parameters: unknown }>; flags: string[] } {
  return {
    tools: [...loaded.tools.values()].map(({ definition }) => ({ name: definition.name, parameters: definition.parameters })).sort((a, b) => a.name.localeCompare(b.name)),
    flags: [...loaded.flags.keys()].sort(),
  }
}

describe("onboarding on a split session (O6)", () => {
  test("#given the onboarding component #when the host loads it for the hand #then it registers none of the flow's loop handlers beyond what composition itself registers", async () => {
    // given
    const compositionOnly = await load("hand", false)

    // when
    const hand = await load("hand")

    // then
    expect(handlerCounts(hand)).toEqual(handlerCounts(compositionOnly))
  })

  test("#given the onboarding component #when the host loads it for the brain #then every loop handler is registered exactly as on a fused session", async () => {
    // when
    const fused = await load(undefined)
    const brain = await load("brain")

    // then
    expect(handlerCounts(fused).before_agent_start).toBeGreaterThan(0)
    expect(handlerCounts(brain)).toEqual(handlerCounts(fused))
  })

  test("#given the onboarding component #when the host loads it for the hand #then the hand serves the same tools, schemas and flags as a fused session", async () => {
    // when
    const fused = await load(undefined)
    const hand = await load("hand")

    // then
    expect(catalog(fused).tools.map((tool) => tool.name)).toContain("onboarding_session_history")
    expect(catalog(hand)).toEqual(catalog(fused))
  })
})

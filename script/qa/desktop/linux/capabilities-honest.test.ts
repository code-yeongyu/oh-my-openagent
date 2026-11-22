import { describe, expect, test } from "bun:test"

import type { EngineMethod } from "@oh-my-opencode/senpi-desktop-protocol"

import { type Json } from "./engine.ts"
import type { Context, Result } from "./scenario.ts"
import { capabilitiesHonest, type ScenarioEngine } from "./wayland.ts"
import { A11Y_NAME } from "./wayland-env.ts"

type Observe = Parameters<typeof capabilitiesHonest>[2]

const CAPS = {
  backend: "wayland",
  displayServer: "wayland",
  deliveryModes: ["background"],
  capture: false,
  capturePermission: "unavailable",
  axPermission: "toolkits-silent",
  stopPath: "portal",
  inputPermission: "unavailable",
}

/** The bus observation flips to present once the engine has answered its own capabilities probe. */
function registeringBusObserver() {
  let engineAnswered = false
  const observe = {
    socketPresent: () => true,
    busNames: async () => [] as string[],
    busName: async (name: string) =>
      name === A11Y_NAME && engineAnswered ? { present: true, exit: 0 } : { present: false, exit: 1 },
  }
  const spawn = (): ScenarioEngine => ({
    activate: async () => ({}),
    result: async (method: EngineMethod): Promise<Json> => {
      if (method === "capabilities") {
        engineAnswered = true
        return CAPS
      }
      return { globalLive: false }
    },
    close: async () => "",
  })
  return { observe, spawn }
}

const STAGE = { socket: "/run/xdg/wayland-0", env: { WAYLAND_DISPLAY: "wayland-0" } }
const runScenario = (observe: Observe, spawn: () => ScenarioEngine): Promise<Result> =>
  capabilitiesHonest({} as Context, STAGE, observe, () => spawn())

const axCheckOf = (outcome: Result): boolean => {
  const checks = outcome.facts.checks
  if (checks === null || typeof checks !== "object" || Array.isArray(checks)) throw new Error("no checks recorded")
  return checks.ax_permission_matches_a11y_bus === true
}

describe("wayland-capabilities-honest a11y bus check", () => {
  test("an a11y bus that registers between the probes does not fail the check", async () => {
    const { observe, spawn } = registeringBusObserver()
    const outcome = await runScenario(observe, spawn)
    expect(axCheckOf(outcome)).toBe(true)
    expect(outcome.pass).toBe(true)
  })

  test("a real mismatch still fails: the engine claims a reachable bus that stays absent", async () => {
    const observe = {
      socketPresent: () => true,
      busNames: async () => [] as string[],
      busName: async () => ({ present: false, exit: 1 }),
    }
    const outcome = await runScenario(observe, registeringBusObserver().spawn)
    expect(axCheckOf(outcome)).toBe(false)
    expect(outcome.pass).toBe(false)
  })

  test("the reverse mismatch fails too: the bus is present while the engine reports bus-unreachable", async () => {
    const observe = {
      socketPresent: () => true,
      busNames: async () => [] as string[],
      busName: async () => ({ present: true, exit: 0 }),
    }
    const spawn = (): ScenarioEngine => ({
      activate: async () => ({}),
      result: async (method: EngineMethod): Promise<Json> =>
        method === "capabilities" ? { ...CAPS, axPermission: "bus-unreachable" } : { globalLive: false },
      close: async () => "",
    })
    const outcome = await runScenario(observe, spawn)
    expect(axCheckOf(outcome)).toBe(false)
    expect(outcome.pass).toBe(false)
  })
})

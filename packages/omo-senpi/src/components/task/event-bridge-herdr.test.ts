import { describe, expect, it } from "bun:test"

import type { SessionShutdownEvent } from "@code-yeongyu/senpi"

import { wireHarness } from "./event-bridge.test-harness"
import type { HerdrTaskProjection } from "./herdr-task-projection"

function projectionHarness(calls: string[] = []) {
  const projection: HerdrTaskProjection = {
    scheduleSync: () => calls.push("schedule"),
    syncNow: async () => {},
    flush: async () => {},
    resume: () => calls.push("resume"),
    clear: async () => {
      calls.push("herdr:clear")
    },
    dispose: async () => {
      calls.push("herdr:dispose")
    },
  }
  return { calls, projection }
}

describe("event-bridge Herdr lifecycle", () => {
  it("resumes on session start and schedules after store mutation", async () => {
    const herdr = projectionHarness()
    const harness = wireHarness("parent-session", { herdrProjection: herdr.projection })

    await harness.pi.dispatch("session_start", {}, {})
    harness.emitStoreMutation()

    expect(herdr.calls).toEqual(["resume", "schedule"])
  })

  it("clears before a session switch and disposes on shutdown", async () => {
    const herdr = projectionHarness()
    const harness = wireHarness("parent-session", { herdrProjection: herdr.projection })

    await harness.pi.dispatch("session_before_switch", {}, {})
    await harness.pi.dispatch(
      "session_shutdown",
      { type: "session_shutdown", reason: "quit" } as unknown as SessionShutdownEvent,
      {},
    )

    expect(herdr.calls).toEqual(["herdr:clear", "herdr:dispose"])
  })

  it("marks core transitions before awaited Herdr cleanup", async () => {
    const order: string[] = []
    const herdr = projectionHarness(order)
    const harness = wireHarness("parent-session", {
      herdrProjection: herdr.projection,
      order,
    })

    await harness.pi.dispatch("session_before_switch", {}, {})
    await harness.pi.dispatch(
      "session_shutdown",
      { type: "session_shutdown", reason: "quit" } as unknown as SessionShutdownEvent,
      {},
    )

    expect(order.indexOf("beforeSwitch")).toBeLessThan(order.indexOf("herdr:clear"))
    expect(order.indexOf("suspend")).toBeLessThan(order.indexOf("herdr:dispose"))
  })

  it("still disposes Herdr resources when durable suspension fails", async () => {
    const order: string[] = []
    const herdr = projectionHarness(order)
    const harness = wireHarness("parent-session", {
      herdrProjection: herdr.projection,
      order,
      suspendError: new Error("suspend failed"),
    })

    await expect(harness.pi.dispatch(
      "session_shutdown",
      { type: "session_shutdown", reason: "quit" } as unknown as SessionShutdownEvent,
      {},
    )).rejects.toThrow("suspend failed")

    expect(order).toContain("herdr:dispose")
  })

  it("still suspends and disposes when resumption shutdown emission fails", async () => {
    const order: string[] = []
    const herdr = projectionHarness(order)
    const harness = wireHarness("parent-session", {
      herdrProjection: herdr.projection,
      order,
      resumptionShutdownError: new Error("resumption shutdown failed"),
    })

    await expect(harness.pi.dispatch(
      "session_shutdown",
      { type: "session_shutdown", reason: "quit" } as unknown as SessionShutdownEvent,
      {},
    )).rejects.toThrow("resumption shutdown failed")

    expect(order).toContain("suspend")
    expect(order).toContain("herdr:dispose")
  })

  it("still suspends and disposes when lead poller shutdown fails", async () => {
    const order: string[] = []
    const herdr = projectionHarness(order)
    const harness = wireHarness("parent-session", {
      herdrProjection: herdr.projection,
      order,
      leadShutdownError: new Error("lead shutdown failed"),
    })

    await expect(harness.pi.dispatch(
      "session_shutdown",
      { type: "session_shutdown", reason: "quit" } as unknown as SessionShutdownEvent,
      {},
    )).rejects.toThrow("lead shutdown failed")

    expect(order).toContain("suspend")
    expect(order).toContain("herdr:dispose")
  })
})

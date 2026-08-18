import { describe, expect, test } from "bun:test"
import { createShutdownDrain } from "./shutdown-drain"
import { DREAM_VOLUME_GATE_BYTES, evaluateDreamGates, resolveDreamTriggerSettings } from "./dream-trigger"
import { memorySettings } from "./memory.test-support"
import { CONVERSATION, NOW_MS, fireTimer, fixture, gateProbe, noopSteps, settle, triggerSettings } from "./dream-trigger.test-support"

describe("resolveDreamTriggerSettings", () => {
  test("#given base dream settings #when no agent override exists #then the base values resolve", () => {
    const resolved = resolveDreamTriggerSettings(memorySettings(), "agent-test")
    expect(resolved).toEqual({
      enabled: true,
      idleMinutes: 30,
      minHoursBetween: 24,
      shutdownLaunch: true,
      autoSelectMax: 5,
      autoSelectMaxChars: 150000,
    })
  })

  test("#given a per-agent dream override #when resolving #then overridden fields win and the rest inherit", () => {
    const settings = memorySettings()
    settings.agents["agent-test"] = { dream: { enabled: false, idle_minutes: 5 } }
    const resolved = resolveDreamTriggerSettings(settings, "agent-test")
    expect(resolved.enabled).toBe(false)
    expect(resolved.idleMinutes).toBe(5)
    expect(resolved.minHoursBetween).toBe(24)
    expect(resolved.shutdownLaunch).toBe(true)
    expect(resolved.autoSelectMax).toBe(5)
    expect(resolved.autoSelectMaxChars).toBe(150000)
  })
})

describe("evaluateDreamGates", () => {
  test("#given every gate failing #when the origin is manual #then the gates are bypassed without probing", async () => {
    const { probe, calls } = gateProbe({ lastDreamAtMs: NOW_MS, unreflectedBytes: 0 })
    const decision = await evaluateDreamGates("manual", triggerSettings({ enabled: false, shutdownLaunch: false }), probe)
    expect(decision).toEqual({ allowed: true })
    expect(calls).toEqual({ lastDreamAt: 0, unreflectedBytes: 0 })
  })

  test("#given dream disabled #when an idle origin evaluates #then it is rejected before probing", async () => {
    const { probe, calls } = gateProbe()
    const decision = await evaluateDreamGates("idle", triggerSettings({ enabled: false }), probe)
    expect(decision).toEqual({ allowed: false, rejection: "disabled" })
    expect(calls).toEqual({ lastDreamAt: 0, unreflectedBytes: 0 })
  })

  test("#given dream disabled #when a pressure origin evaluates #then it is rejected before probing", async () => {
    const { probe, calls } = gateProbe()
    const decision = await evaluateDreamGates("pressure", triggerSettings({ enabled: false }), probe)
    expect(decision).toEqual({ allowed: false, rejection: "disabled" })
    expect(calls).toEqual({ lastDreamAt: 0, unreflectedBytes: 0 })
  })

  test("#given shutdown_launch disabled #when a shutdown origin evaluates #then it is rejected before probing", async () => {
    const { probe, calls } = gateProbe()
    const decision = await evaluateDreamGates("shutdown", triggerSettings({ shutdownLaunch: false }), probe)
    expect(decision).toEqual({ allowed: false, rejection: "shutdown_disabled" })
    expect(calls).toEqual({ lastDreamAt: 0, unreflectedBytes: 0 })
  })

  test("#given the last dream exactly min_hours_between ago #when an idle origin evaluates #then the spacing gate rejects without a volume probe", async () => {
    const { probe, calls } = gateProbe({ lastDreamAtMs: NOW_MS - 24 * 3_600_000 })
    const decision = await evaluateDreamGates("idle", triggerSettings(), probe)
    expect(decision).toEqual({ allowed: false, rejection: "too_soon" })
    expect(calls).toEqual({ lastDreamAt: 1, unreflectedBytes: 0 })
  })

  test("#given the last dream one millisecond past min_hours_between #when an idle origin evaluates #then it is allowed", async () => {
    const { probe } = gateProbe({ lastDreamAtMs: NOW_MS - 24 * 3_600_000 - 1 })
    const decision = await evaluateDreamGates("idle", triggerSettings(), probe)
    expect(decision).toEqual({ allowed: true })
  })

  test("#given the last dream exactly min_hours_between ago #when pressure evaluates #then spacing rejects without probing volume", async () => {
    const { probe, calls } = gateProbe({ lastDreamAtMs: NOW_MS - 24 * 3_600_000, unreflectedBytes: 0 })
    const decision = await evaluateDreamGates("pressure", triggerSettings(), probe)
    expect(decision).toEqual({ allowed: false, rejection: "too_soon" })
    expect(calls).toEqual({ lastDreamAt: 1, unreflectedBytes: 0 })
  })

  test("#given pressure is past dream spacing #when unreflected volume is zero #then it is allowed without probing volume", async () => {
    const { probe, calls } = gateProbe({ lastDreamAtMs: NOW_MS - 24 * 3_600_000 - 1, unreflectedBytes: 0 })
    const decision = await evaluateDreamGates("pressure", triggerSettings(), probe)
    expect(decision).toEqual({ allowed: true })
    expect(calls).toEqual({ lastDreamAt: 1, unreflectedBytes: 0 })
  })

  test("#given no recorded dream #when an idle origin evaluates #then the spacing gate passes", async () => {
    const { probe } = gateProbe({ lastDreamAtMs: null })
    const decision = await evaluateDreamGates("idle", triggerSettings(), probe)
    expect(decision).toEqual({ allowed: true })
  })

  test("#given unreflected volume exactly at the floor #when an idle origin evaluates #then the volume gate rejects", async () => {
    const { probe } = gateProbe({ unreflectedBytes: DREAM_VOLUME_GATE_BYTES })
    const decision = await evaluateDreamGates("idle", triggerSettings(), probe)
    expect(decision).toEqual({ allowed: false, rejection: "insufficient_volume" })
  })

  test("#given unreflected volume one byte above the floor #when a shutdown origin evaluates #then it is allowed", async () => {
    const { probe } = gateProbe({ unreflectedBytes: DREAM_VOLUME_GATE_BYTES + 1 })
    const decision = await evaluateDreamGates("shutdown", triggerSettings(), probe)
    expect(decision).toEqual({ allowed: true })
  })
})

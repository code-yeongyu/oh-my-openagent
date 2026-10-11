import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createOnboardingHarness } from "./test-harness"
import { claimOnboarding, isOnboardingComplete } from "./state"

const dirs: string[] = []
function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-onboarding-entry-"))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("onboarding entry", () => {
  test("#given background RPC sessions #when opened without prompts #then no claim or turn", async () => {
    const dir = freshDir()
    for (const name of ["probe", "auth", "prewarm"]) {
      const h = createOnboardingHarness(dir, name)
      await h.start()
      expect(isOnboardingComplete(dir)).toBe(false)
      expect(h.pi.messages).toEqual([])
      expect(h.widgets.size).toBe(0)
    }
  })

  test("#given a fresh TUI #when launched #then only a static widget appears", async () => {
    const dir = freshDir()
    const h = createOnboardingHarness(dir, "tui", "tui")
    await h.start()
    expect(h.widgets.has("omo-onboarding")).toBe(true)
    expect(h.pi.messages).toEqual([])
    expect(isOnboardingComplete(dir)).toBe(false)
  })

  test("#given the first real prompt #when dispatched #then context rides once on that turn", async () => {
    const dir = freshDir()
    const h = createOnboardingHarness(dir, "first", "tui")
    await h.start()
    expect(await h.prompt()).toEqual([{
      message: { customType: "omo-onboarding:context", content: expect.any(String), display: false },
    }])
    expect(isOnboardingComplete(dir)).toBe(true)
    expect(h.pi.messages).toEqual([])
    expect(h.widgets.has("omo-onboarding")).toBe(false)
    expect(await h.prompt()).toEqual([undefined])
  })

  test("#given two sessions on one install #when both prompt #then only one claims", async () => {
    const dir = freshDir()
    const first = createOnboardingHarness(dir, "first")
    const second = createOnboardingHarness(dir, "second")
    const results = await Promise.all([first.prompt(), second.prompt()])
    expect(results.flat().filter(Boolean)).toHaveLength(1)
    expect(isOnboardingComplete(dir)).toBe(true)
  })

  test("#given an existing marker #when a new session prompts #then no onboarding", async () => {
    const dir = freshDir()
    claimOnboarding(dir)
    const h = createOnboardingHarness(dir)
    expect(await h.prompt()).toEqual([undefined])
    expect(h.pi.messages).toEqual([])
  })

  test("#given an externally created marker and sidecar #when normal lifecycle events fire #then both stay untouched", async () => {
    const dir = freshDir()
    const marker = join(dir, "onboarding-completed")
    const sidecar = join(dir, "opaque-desktop-sidecar")
    writeFileSync(marker, "")
    writeFileSync(sidecar, "opaque fixture; not interpreted by onboarding")
    for (const mode of ["rpc", "tui"]) {
      const h = createOnboardingHarness(dir, mode, mode)
      await h.start()
      expect(await h.prompt()).toEqual([undefined])
      await h.agentStart()
      await h.end("error")
      await h.settle()
      await h.pi.dispatch("session_abort", {}, h.ctx)
      await h.pi.dispatch("session_shutdown", {}, h.ctx)
      expect(h.pi.messages).toEqual([])
      expect(h.widgets.size).toBe(0)
      expect(readFileSync(marker, "utf8")).toBe("")
      expect(readFileSync(sidecar, "utf8")).toBe("opaque fixture; not interpreted by onboarding")
    }
  })

  for (const trigger of ["extension", "delivery"]) {
    test(`#given a ${trigger} turn #when starting #then the user retains onboarding`, async () => {
      const dir = freshDir()
      const h = createOnboardingHarness(dir)
      expect(await h.prompt({ trigger })).toEqual([undefined])
      expect(isOnboardingComplete(dir)).toBe(false)
    })
  }

  test("#given a preview pass #when dispatched directly #then it cannot consume state", async () => {
    const dir = freshDir()
    const h = createOnboardingHarness(dir)
    expect(await h.prompt({ preview: true })).toEqual([undefined])
    expect(isOnboardingComplete(dir)).toBe(false)
    expect(h.pi.handlers.find((entry) => entry.event === "before_agent_start")?.options?.previewSafe).not.toBe(true)
    expect((await h.prompt()).filter(Boolean)).toHaveLength(1)
  })

  for (const excluded of ["headless", "worker", "disabled"]) {
    test(`#given ${excluded} #when startup and prompt fire #then neither claims nor sends`, async () => {
      const dir = freshDir()
      const h = createOnboardingHarness(dir)
      if (excluded === "headless") h.ctx.hasUI = false
      if (excluded === "worker") h.pi.sessionKind = "worker"
      if (excluded === "disabled") h.pi.setFlag("omo-senpi-onboarding-disabled", true)
      await h.start()
      expect(await h.prompt()).toEqual([undefined])
      expect(isOnboardingComplete(dir)).toBe(false)
      expect(h.pi.messages).toEqual([])
    })
  }

  test("#given forced TUI onboarding #when startup repeats #then one immediate guided tour", async () => {
    const dir = freshDir()
    claimOnboarding(dir)
    const h = createOnboardingHarness(dir, "forced", "tui")
    h.pi.setFlag("onboard", true)
    await h.start()
    await h.start()
    expect(h.pi.messages).toEqual([{
      message: { customType: "omo-onboarding:bootstrap", content: expect.any(String), display: false },
      options: { triggerTurn: true, deliverAs: "followUp" },
    }])
    expect(await h.prompt()).toEqual([undefined])
    await h.agentStart()
    await h.end()
    await h.settle()
    expect(await h.prompt()).toEqual([undefined])
  })

  test("#given forced RPC onboarding #when opened #then it waits for the first prompt", async () => {
    const dir = freshDir()
    claimOnboarding(dir)
    const h = createOnboardingHarness(dir)
    h.pi.setFlag("onboard", true)
    await h.start()
    expect(h.pi.messages).toEqual([])
    expect((await h.prompt()).filter(Boolean)).toHaveLength(1)
  })
})

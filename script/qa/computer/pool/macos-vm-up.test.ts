import { describe, expect, test } from "bun:test"
import { type GuestListing, type GuestPlan, guestRunArgv } from "./macos-vm-plan.ts"
import { type Hypervisor, sweepGuests } from "./macos-vm-ops.ts"
import { bringUp, guestProcessPattern, type UpSteps } from "./macos-vm-up.ts"

const plan: GuestPlan = {
  kind: "plan",
  major: "15",
  baseImage: "base-macos15",
  guestName: "omo-cu-macos15-5",
  consoleHost: null,
  labels: ["computer-live-macos", "macos-15"],
}

function poolHost(options: { readonly cloneFails?: boolean; readonly neverRuns?: boolean } = {}) {
  const guests = new Map<string, boolean>()
  const holds = new Set<string>()
  const removed: string[] = []
  const processCount = (name: string) => (holds.has(name) ? 1 : 0) + (guests.get(name) === true ? 1 : 0)
  const hypervisor: Hypervisor = {
    list: (): GuestListing[] => [...guests].map(([name, running]) => ({ name, running })),
    stop: (name) => {
      if (guests.has(name)) guests.set(name, false)
    },
    remove: (name) => {
      removed.push(name)
      guests.delete(name)
      return { code: 0, stderr: "" }
    },
  }
  const sweepsInGap: string[][] = []
  const steps: UpSteps = {
    hold: (name) => {
      holds.add(name)
      return () => holds.delete(name)
    },
    clone: (_base, name) => {
      if (options.cloneFails) return { code: 1, stderr: "no such base image" }
      guests.set(name, false)
      return { code: 0, stderr: "" }
    },
    startRun: (name) => {
      // A concurrent --sweep lands after the clone exited and before the run process exists.
      sweepsInGap.push([...sweepGuests(hypervisor, processCount).lines])
      if (!options.neverRuns) guests.set(name, true)
      return 4242
    },
  }
  return { hypervisor, steps, holds, removed, sweepsInGap }
}

const instantClock = () => {
  let at = 0
  return { now: () => at, sleep: async (ms: number) => void (at += ms) }
}

describe("up holds its guest from before the clone until the wait ends", () => {
  test("a sweep between the clone exiting and the run starting keeps the guest", async () => {
    const host = poolHost()
    const result = await bringUp(host.hypervisor, host.steps, instantClock(), plan, 120_000)
    expect(host.sweepsInGap).toEqual([
      [
        "guest KEPT omo-cu-macos15-5 (1 hypervisor process live: a run may be starting it)",
        "sweep: 0 deleted, 0 not deleted, 1 kept",
      ],
    ])
    expect(host.removed).toEqual([])
    expect(result).toEqual({
      lines: [
        "console host none: headless no-clipboard guest",
        "GUEST omo-cu-macos15-5 macos=15 labels=computer-live-macos,macos-15 running pid=4242",
      ],
      errors: [],
      exitCode: 0,
    })
    expect(host.holds.size).toBe(0)
  })

  test("a guest that never runs is deleted with its receipt and the hold is released", async () => {
    const host = poolHost({ neverRuns: true })
    const result = await bringUp(host.hypervisor, host.steps, instantClock(), plan, 120_000)
    expect(result).toEqual({
      lines: ["console host none: headless no-clipboard guest", "guest DELETED omo-cu-macos15-5"],
      errors: ["macos-vm: guest omo-cu-macos15-5 is not-running after 120 s"],
      exitCode: 1,
    })
    expect(host.holds.size).toBe(0)
  })

  test("a failed clone exits 1 with its reason and releases the hold", async () => {
    const host = poolHost({ cloneFails: true })
    const result = await bringUp(host.hypervisor, host.steps, instantClock(), plan, 120_000)
    expect(result).toEqual({
      lines: ["console host none: headless no-clipboard guest"],
      errors: ["macos-vm: clone failed: no such base image"],
      exitCode: 1,
    })
    expect(host.holds.size).toBe(0)
  })
})

describe("up on a host with a signed-in console user (R-S4-1)", () => {
  test("the receipt names the console user beside the headless no-clipboard guest", async () => {
    const host = poolHost()
    const result = await bringUp(host.hypervisor, host.steps, instantClock(), { ...plan, consoleHost: "someone" }, 1)
    expect(result.lines[0]).toBe("console host someone: headless no-clipboard guest")
  })
})

describe("guest process pattern", () => {
  test("matches the command line of the run the --up spawns, and no other guest's", () => {
    const pattern = new RegExp(guestProcessPattern("omo-cu-macos15-5"))
    expect(pattern.test(["/opt/hv/bin/vmctl", ...guestRunArgv("omo-cu-macos15-5")].join(" "))).toBe(true)
    expect(pattern.test(["/opt/hv/bin/vmctl", ...guestRunArgv("omo-cu-macos15-50")].join(" "))).toBe(false)
    expect(pattern.test("/opt/hv/bin/vmctl run --no-graphics omo-cu-macos15-5")).toBe(true)
  })
})

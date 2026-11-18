import { describe, expect, test } from "bun:test"
import type { GuestListing } from "./macos-vm-plan.ts"
import { deleteGuest, type Hypervisor, sweepGuests, teardown, upStatus, waitUntilRunning } from "./macos-vm-ops.ts"

type FakeOptions = { readonly listThrows?: boolean; readonly removeFails?: boolean }

function fakeHypervisor(listings: GuestListing[][], options: FakeOptions = {}): Hypervisor & { removed: string[] } {
  let call = 0
  const removed: string[] = []
  return {
    removed,
    list: () => {
      if (options.listThrows) throw new Error("hypervisor list exited 1")
      const at = Math.min(call, listings.length - 1)
      call += 1
      return listings[at] ?? []
    },
    stop: () => undefined,
    remove: (name) => {
      removed.push(name)
      return options.removeFails ? { code: 1, stderr: "delete refused" } : { code: 0, stderr: "" }
    },
  }
}

const instantClock = () => {
  let at = 0
  return { now: () => at, sleep: async (ms: number) => void (at += ms) }
}

describe("teardown receipts are measured, never printed blind", () => {
  test("a guest process still running fails the teardown with its count", () => {
    const result = teardown(fakeHypervisor([[]]), "omo-cu-macos15-1", () => 1)
    expect(result.lines[0]).toBe("procs 1")
    expect(result.exitCode).toBe(1)
  })

  test("an unreadable process count reads UNREAD and fails, never clean", () => {
    const result = teardown(fakeHypervisor([[]]), "omo-cu-macos15-1", () => null)
    expect(result.lines[0]).toBe("procs UNREAD")
    expect(result.exitCode).toBe(1)
  })

  test("a deleted guest with no process left passes, and no directory line is claimed", () => {
    const result = teardown(fakeHypervisor([[]]), "omo-cu-macos15-1", () => 0)
    expect(result.lines).toEqual(["procs 0", "guest DELETED omo-cu-macos15-1"])
    expect(result.exitCode).toBe(0)
  })

  test("a list failure during delete still prints the NOT DELETED receipt", () => {
    expect(deleteGuest(fakeHypervisor([], { listThrows: true }), "omo-cu-macos15-1")).toBe(
      "guest NOT DELETED omo-cu-macos15-1 (list failed: hypervisor list exited 1)",
    )
  })
})

describe("up waits for the guest to be listed running", () => {
  test("a guest that never shows as running is a failed up", () => {
    expect(upStatus([{ name: "omo-cu-macos26-9", running: false }], "omo-cu-macos26-9")).toBe("not-running")
    expect(upStatus([], "omo-cu-macos26-9")).toBe("not-listed")
  })

  test("a listed running guest is a successful up", () => {
    expect(upStatus([{ name: "omo-cu-macos26-9", running: true }], "omo-cu-macos26-9")).toBe("running")
  })

  test("the wait returns running once the guest is listed running", async () => {
    const hypervisor = fakeHypervisor([[], [{ name: "omo-cu-macos26-9", running: true }]])
    expect(await waitUntilRunning(hypervisor, "omo-cu-macos26-9", 120_000, instantClock())).toEqual({
      status: "running",
    })
  })

  test("the wait gives up at the deadline with the last status", async () => {
    const hypervisor = fakeHypervisor([[{ name: "omo-cu-macos26-9", running: false }]])
    expect(await waitUntilRunning(hypervisor, "omo-cu-macos26-9", 120_000, instantClock())).toEqual({
      status: "not-running",
    })
  })

  test("a list failure during the wait is a failed up with its reason, never an escaped rejection", async () => {
    const hypervisor = fakeHypervisor([], { listThrows: true })
    expect(await waitUntilRunning(hypervisor, "omo-cu-macos26-9", 120_000, instantClock())).toEqual({
      status: "list-failed",
      detail: "hypervisor list exited 1",
    })
  })
})

describe("sweep deletes only pool guests nothing is using", () => {
  test("running pool guests are kept, stopped idle ones deleted, foreign guests untouched", () => {
    const hypervisor = fakeHypervisor([
      [
        { name: "omo-cu-macos15-1", running: false },
        { name: "omo-cu-macos26-2", running: true },
        { name: "base-macos15", running: false },
      ],
      [{ name: "omo-cu-macos26-2", running: true }],
    ])
    expect(sweepGuests(hypervisor, () => 0)).toEqual({
      lines: [
        "guest DELETED omo-cu-macos15-1",
        "guest KEPT omo-cu-macos26-2 (running)",
        "sweep: 1 deleted, 0 not deleted, 1 kept",
      ],
      exitCode: 0,
    })
    expect(hypervisor.removed).toEqual(["omo-cu-macos15-1"])
  })

  test("a guest a concurrent up is cloning or starting (live hypervisor process, not yet listed running) is kept", () => {
    const hypervisor = fakeHypervisor([[{ name: "omo-cu-macos15-7", running: false }]])
    const result = sweepGuests(hypervisor, (name) => (name === "omo-cu-macos15-7" ? 1 : 0))
    expect(result.lines).toEqual([
      "guest KEPT omo-cu-macos15-7 (1 hypervisor process live: a run may be starting it)",
      "sweep: 0 deleted, 0 not deleted, 1 kept",
    ])
    expect(hypervisor.removed).toEqual([])
  })

  test("a guest whose process count cannot be read is kept, never deleted blind", () => {
    const hypervisor = fakeHypervisor([[{ name: "omo-cu-macos15-7", running: false }]])
    const result = sweepGuests(hypervisor, () => null)
    expect(result.lines[0]).toBe("guest KEPT omo-cu-macos15-7 (process count unreadable)")
    expect(hypervisor.removed).toEqual([])
  })

  test("a guest list that cannot be read fails the sweep with its reason, never an uncaught error", () => {
    expect(sweepGuests(fakeHypervisor([], { listThrows: true }), () => 0)).toEqual({
      lines: ["sweep: list failed: hypervisor list exited 1"],
      exitCode: 1,
    })
  })

  test("the summary counts a failed delete as not deleted and fails the sweep", () => {
    const listing = [{ name: "omo-cu-macos15-1", running: false }]
    const hypervisor = fakeHypervisor([listing, listing], { removeFails: true })
    expect(sweepGuests(hypervisor, () => 0)).toEqual({
      lines: ["guest NOT DELETED omo-cu-macos15-1 (delete refused)", "sweep: 0 deleted, 1 not deleted, 0 kept"],
      exitCode: 1,
    })
  })
})

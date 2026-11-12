import { describe, expect, test } from "bun:test"
import type { GuestListing } from "./macos-vm-plan.ts"
import { deleteGuest, type Hypervisor, sweepGuests, teardown, upStatus } from "./macos-vm-ops.ts"

function fakeHypervisor(listings: GuestListing[][], options: { readonly listThrows?: boolean } = {}): Hypervisor {
  let call = 0
  return {
    list: () => {
      if (options.listThrows) throw new Error("hypervisor list exited 1")
      const at = Math.min(call, listings.length - 1)
      call += 1
      return listings[at] ?? []
    },
    stop: () => undefined,
    remove: () => ({ code: 0, stderr: "" }),
  }
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
})

describe("sweep never deletes a guest a live run is using", () => {
  test("running pool guests are kept and only stopped ones are deleted", () => {
    const hypervisor = fakeHypervisor([
      [
        { name: "omo-cu-macos15-1", running: false },
        { name: "omo-cu-macos26-2", running: true },
        { name: "base-macos15", running: false },
      ],
      [{ name: "omo-cu-macos26-2", running: true }],
    ])
    expect(sweepGuests(hypervisor)).toEqual({
      deleted: ["guest DELETED omo-cu-macos15-1"],
      kept: ["omo-cu-macos26-2"],
    })
  })
})

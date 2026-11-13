import { describe, expect, test } from "bun:test"
import { IsolationUnavailableError, resolveCandidates } from "./backend"

describe("candidate resolution", () => {
  test.each([
    ["darwin", ["apfs", "zfs", "rcopy"]],
    ["linux", ["btrfs", "zfs", "reflink", "overlayfs", "rcopy"]],
    ["win32", ["block-clone", "rcopy"]],
    ["freebsd", ["rcopy"]],
  ] as const)("orders candidates on %s", (platform, candidates) => {
    expect(resolveCandidates(platform).candidates).toEqual([...candidates])
    expect(resolveCandidates(platform, "auto").candidates).toEqual([...candidates])
  })
  test("puts preferred first without duplicating it", () => {
    expect(resolveCandidates("linux", "zfs").candidates).toEqual(["zfs", "btrfs", "reflink", "overlayfs", "rcopy"])
    expect(resolveCandidates("darwin", "block-clone").candidates).toEqual(["block-clone", "apfs", "zfs", "rcopy"])
  })
  test("distinguishes unavailable from other failures", () => {
    expect(new IsolationUnavailableError("not supported").code).toBe("isolation_unavailable")
    expect(new Error("I/O failure") instanceof IsolationUnavailableError).toBe(false)
  })
})

import { describe, expect, test } from "bun:test"
import { constants } from "node:os"

import { classifyFlockFailure, tryLockExclusive, tryLockShared } from "./os-file-lock"

const errno = constants.errno

// omo #10604 review M1: only a conflicting holder is "busy". A filesystem without flock falls back to
// the behavior without the lock, and any other failure is a real error that is never read as busy or
// idle, so the stranded-lock sweep fails closed and git never waits 10 s on a lock it cannot take.
describe("flock failures are classified by errno (omo #10604)", () => {
  test.each([
    ["EWOULDBLOCK", errno.EWOULDBLOCK, "busy"],
    ["EAGAIN", errno.EAGAIN, "busy"],
    ["EINTR", errno.EINTR, "busy"],
    ["ENOLCK", errno.ENOLCK, "unavailable"],
    ["EOPNOTSUPP", errno.EOPNOTSUPP, "unavailable"],
    ["ENOTSUP", errno.ENOTSUP, "unavailable"],
    ["ENOSYS", errno.ENOSYS, "unavailable"],
    ["EBADF", errno.EBADF, "failed"],
    ["EINVAL", errno.EINVAL, "failed"],
  ] as const)("#given flock fails with %s #then the attempt is %s", (_name, code, kind) => {
    expect(classifyFlockFailure(code ?? -1).kind).toBe(kind)
  })

  test.skipIf(process.platform === "win32")("#given a descriptor that is not open #when a lock is attempted #then it fails with EBADF instead of reading as busy", async () => {
    // #given
    const closedFd = 1_000_000

    // #when
    const exclusive = await tryLockExclusive(closedFd)
    const shared = await tryLockShared(closedFd)

    // #then
    expect(exclusive).toEqual({ kind: "failed", errno: errno.EBADF ?? -1 })
    expect(shared).toEqual({ kind: "failed", errno: errno.EBADF ?? -1 })
  })
})

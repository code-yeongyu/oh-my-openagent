import { expect, test } from "bun:test"
import * as isolationCore from "./index"

test("public surface exposes the whole isolation lifecycle from the package root", () => {
  for (const name of [
    "ensureIsolation", "cleanupIsolation", "retainIsolation",
    "sweepStaleIsolations", "readOwnerLiveness", "writeOwnerMarker",
    "chooseBaseDir", "resolveCandidates",
  ] as const) {
    expect(typeof isolationCore[name]).toBe("function")
  }
  expect(isolationCore.resolveCandidates("darwin").candidates).toEqual(["apfs", "zfs", "rcopy"])
  expect(new isolationCore.IsolationUnavailableError("unsupported").code).toBe("isolation_unavailable")
})

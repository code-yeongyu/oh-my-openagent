import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"

import { recordsOn } from "./sentinel.ts"

// A consumer (the conformance runner) writes not_observed instead of none for every OS this answers false, so a
// claimed OS must have a recorder in the tree; an unclaimed one must not be silently reported as recorded.
const CANDIDATES = ["macos", "windows", "x11", "wayland", "linux"] as const
const recorderIn = (os: string): boolean =>
  existsSync(join(import.meta.dir, os, "recorder.swift")) || existsSync(join(import.meta.dir, os, "recorder.ts"))

describe("sentinel recordsOn", () => {
  test("claims exactly the OSes that have a recorder in the tree", () => {
    for (const os of CANDIDATES) expect(recordsOn(os), os).toBe(recorderIn(os))
  })

  test("records macOS and refuses an unknown OS name", () => {
    expect(recordsOn("macos")).toBe(true)
    expect(recordsOn("plan9")).toBe(false)
  })
})

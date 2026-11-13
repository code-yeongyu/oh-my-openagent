import { describe, expect, test } from "bun:test"
import { mkdtempSync, realpathSync, rmSync } from "node:fs"
import { join } from "node:path"

import { altRootOf } from "./task-host-e2e-shards-handoff-successors-alt.mjs"

// The alternate socket root is a fixed POSIX `/tmp/omo-rpc-*` directory (the sun_path fallback); the host
// runner that uses it never runs on win32 (rpc-host-sharding plan U6), so neither does this sweep.
describe.skipIf(process.platform === "win32")("altRootOf", () => {
  test("a /tmp/omo-rpc-* root is found whether the socket is recorded under /tmp or /private/tmp", () => {
    const root = mkdtempSync("/tmp/omo-rpc-t14test-")
    try {
      const real = realpathSync(root)
      expect(altRootOf(join(root, "p-0000000000000000.sock"))).toBe(real)
      expect(altRootOf(join(real, "p-0000000000000000.sock"))).toBe(real)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("a socket outside a /tmp/omo-rpc-* root is never swept", () => {
    const root = mkdtempSync("/tmp/dh41-t14test-")
    try {
      expect(altRootOf(join(root, "rpc", "p-0000000000000000.sock"))).toBeUndefined()
      expect(altRootOf(join(root, "p-0000000000000000.sock"))).toBeUndefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

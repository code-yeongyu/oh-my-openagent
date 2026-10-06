import { describe, expect, test } from "bun:test"
import { join } from "node:path"

describe("root permission registry ownership", () => {
  for (const scenario of [
    "preseed", "delete", "incompatible", "future", "unfrozen", "throwing-claim", "throwing-shape", "call-property", "reload",
  ]) {
    test(`preserves the native denial and one root event after ${scenario}`, async () => {
      // given: a process owns a non-configurable global latch for its entire lifetime.
      const fixture = join(import.meta.dir, "permission-registry.test-fixture.ts")
      // when
      const child = Bun.spawn([process.execPath, fixture, scenario], {
        stdout: "pipe", stderr: "pipe", timeout: 60_000,
      })
      const [stdout, stderr, exit] = await Promise.all([
        new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
      ])
      // then
      expect({ exit, stderr }).toEqual({ exit: 0, stderr: "" })
      const result = JSON.parse(stdout)
      expect(result.setupError).toBeUndefined()
      expect(result.preserved).toEqual([true, true])
      expect(result.events).toEqual([{
        name: "omo.computer.permission_required",
        data: { session_id: result.root, permission: "screen_recording", app: "Test App" },
      }])
      if (scenario === "delete") expect(result.deleted).toBe(false)
    }, 120_000)
  }
})

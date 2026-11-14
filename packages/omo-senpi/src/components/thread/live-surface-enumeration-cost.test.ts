// Every thread tool call awaits one host view. The view's endpoint enumeration used to spawn the engine's
// `host status --all --include-workers --json`, a full diagnostic pass (a /proc walk per endpoint, crash records,
// stale-engine checks) that took 8.4-8.7 s on a host with 49 endpoints, so a local-only thread_list took 9.3 s.
// The enumeration now reads the endpoint registry on disk and never starts a process.
import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createLiveThreadSurface } from "./live-surface"

// A local view lists sockets on this machine only; it has no network leg, so it fits well inside Q's 300 ms bar.
const LOCAL_VIEW_BUDGET_MS = 300
// The stand-in engine holds its answer far past the budget, so a view that waits on it cannot pass by luck.
const ENGINE_HOLD_S = 5

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function slowEngine(): { readonly bin: string; readonly started: string } {
  const dir = mkdtempSync(join(tmpdir(), "omo-enum-cost-"))
  dirs.push(dir)
  const started = join(dir, "engine-started")
  const bin = join(dir, "senpi")
  writeFileSync(bin, `#!/bin/sh\n: > '${started}'\nexec sleep ${ENGINE_HOLD_S}\n`)
  chmodSync(bin, 0o755)
  return { bin, started }
}

describe("live thread surface enumeration cost", () => {
  test.skipIf(process.platform === "win32")(
    "#given an engine CLI that takes seconds to answer #when a view is listed #then it answers within the local budget without starting the engine",
    async () => {
      // given
      const engine = slowEngine()
      const surface = createLiveThreadSurface({} as never, {
        env: { ...process.env, SENPI_BIN: engine.bin, SENPI_RPC_SOCKET: "/tmp/omo-enum-cost-missing.sock" },
        exists: () => false,
        registry: async () => [],
      })

      // when
      const started = performance.now()
      const view = await Promise.race([
        surface.listView({ offline: true }).then(() => "answered" as const),
        new Promise<"over_budget">((done) => setTimeout(() => done("over_budget"), LOCAL_VIEW_BUDGET_MS)),
      ])
      const elapsed = performance.now() - started

      // then
      expect(view).toBe("answered")
      expect(elapsed).toBeLessThan(LOCAL_VIEW_BUDGET_MS)
      expect(existsSync(engine.started)).toBe(false)
    },
  )
})

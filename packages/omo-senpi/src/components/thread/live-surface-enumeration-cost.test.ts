// Every thread tool call awaits one host view. The view's endpoint enumeration used to spawn the engine's
// `host status --all --include-workers --json`, a full diagnostic pass (a /proc walk per endpoint, crash records,
// stale-engine checks) that took 8.4-8.7 s on a host with 49 endpoints, so a local-only thread_list took 9.3 s.
// The enumeration now reads the endpoint registry on disk and never starts a process. The test counts what the
// view does instead of timing it: a stand-in engine that leaves a marker when it is started, and a registry spy.
import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createLiveThreadSurface } from "./live-surface"

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function engineStandIn(): { readonly bin: string; readonly started: string } {
  const dir = mkdtempSync(join(tmpdir(), "omo-enum-cost-"))
  dirs.push(dir)
  const started = join(dir, "engine-started")
  const bin = join(dir, "senpi")
  writeFileSync(bin, `#!/bin/sh\n: > '${started}'\n`)
  chmodSync(bin, 0o755)
  return { bin, started }
}

describe("live thread surface enumeration cost", () => {
  test.skipIf(process.platform === "win32")(
    "#given an engine CLI on the launch path #when a view is listed #then the registry is read once and the engine is never started",
    async () => {
      // given
      const engine = engineStandIn()
      let registryReads = 0
      const surface = createLiveThreadSurface({} as never, {
        env: { ...process.env, SENPI_BIN: engine.bin, SENPI_RPC_SOCKET: "/tmp/omo-enum-cost-missing.sock" },
        exists: () => false,
        registry: async () => {
          registryReads += 1
          return []
        },
      })

      // when
      await surface.listView({ offline: true })

      // then
      expect(existsSync(engine.started)).toBe(false)
      expect(registryReads).toBe(1)
    },
  )
})

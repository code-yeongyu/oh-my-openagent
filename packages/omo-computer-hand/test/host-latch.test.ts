import { chmodSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { DaemonLauncher, effectiveLatch, readHostLatch, writeHostLatch } from "../src/index.ts"
import { tempDirs } from "./support/tmp.ts"

const temp = tempDirs("omo-hand-latch-")

function latchPath(root: string): string {
  return join(root, "computer", "host-latch")
}

describe("host latch file", () => {
  it("is written 0600 in a 0700 computer dir, in the shape the engine reads", () => {
    // Given a host that latched at stop epoch 7.
    const path = latchPath(temp())
    writeHostLatch(path, { suspended: true, stopEpoch: 7 })

    // Then the file and its directory are owner-only and the JSON carries both members.
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(statSync(join(path, "..")).mode & 0o777).toBe(0o700)
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ suspended: true, stopEpoch: 7 })
  })

  it("an absent file is unlatched; nothing about it lifts a latch", () => {
    expect(effectiveLatch(readHostLatch(latchPath(temp())))).toEqual({ suspended: false, stopEpoch: 0 })
  })

  it("unreadable_host_latch_starts_stopped", () => {
    // Given three latch files a host cannot trust: unparseable, group-readable, a symlink.
    const garbled = latchPath(temp())
    mkdirSync(join(garbled, ".."), { recursive: true, mode: 0o700 })
    writeFileSync(garbled, "{", { mode: 0o600 })
    const loose = latchPath(temp())
    writeHostLatch(loose, { suspended: false, stopEpoch: 2 })
    chmodSync(loose, 0o644)
    const linked = latchPath(temp())
    const real = latchPath(temp())
    writeHostLatch(real, { suspended: false, stopEpoch: 1 })
    mkdirSync(join(linked, ".."), { recursive: true, mode: 0o700 })
    symlinkSync(real, linked)

    // When each is read at host start.
    // Then every one reads as stopped.
    for (const path of [garbled, loose, linked]) {
      expect(readHostLatch(path).kind).toBe("unreadable")
      expect(effectiveLatch(readHostLatch(path)).suspended).toBe(true)
    }
  })

  it("host_restart_reloads_host_latch_and_starts_stopped", async () => {
    // Given a host that latched, then restarted: only the file survives.
    const root = temp()
    writeHostLatch(latchPath(root), { suspended: true, stopEpoch: 4 })
    const spawned: string[][] = []

    // When the restarted host reloads the latch and spawns its daemon.
    const launcher = new DaemonLauncher({
      engine: "/opt/omo-computer-engine",
      endpoint: join(root, "engine.sock"),
      lock: join(root, "engine.lock"),
      env: {},
      latch: () => effectiveLatch(readHostLatch(latchPath(root))),
      spawnDaemon: (_command, args) => {
        spawned.push([...args])
        throw new Error("spawn recorded")
      },
    })
    await expect(launcher.ensure()).rejects.toThrow("spawn recorded")

    // Then the daemon was asked to start stopped.
    expect(spawned).toEqual([
      [
        "--enable-daemon",
        "--serve",
        "--endpoint",
        join(root, "engine.sock"),
        "--lock",
        join(root, "engine.lock"),
        "--start-stopped",
      ],
    ])
  })

  it("reads the latch only through owner-only, non-link directories, exactly like the engine's host/files.rs", () => {
    // Given a clear latch reached through a symlinked computer/ dir.
    const elsewhere = temp()
    writeHostLatch(latchPath(elsewhere), { suspended: false, stopEpoch: 4 })
    const linkedRoot = temp()
    symlinkSync(join(elsewhere, "computer"), join(linkedRoot, "computer"))

    // Given a clear latch in a computer/ dir its group can write.
    const groupRoot = temp()
    writeHostLatch(latchPath(groupRoot), { suspended: false, stopEpoch: 4 })
    chmodSync(join(groupRoot, "computer"), 0o770)

    // Given a clear latch under a config root others can enter.
    const openRoot = temp()
    writeHostLatch(latchPath(openRoot), { suspended: false, stopEpoch: 4 })
    chmodSync(openRoot, 0o755)

    // Then each is unreadable, i.e. STOPPED, never the clear latch it holds.
    for (const root of [linkedRoot, groupRoot, openRoot]) {
      expect(readHostLatch(latchPath(root)).kind).toBe("unreadable")
      expect(effectiveLatch(readHostLatch(latchPath(root)))).toMatchObject({ suspended: true })
    }
  })
})

import { existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { DaemonLauncher, type DaemonLink } from "../src/index.ts"
import { fakeAuthority, fakeChild, type FakeChild } from "./support/fakes.ts"
import { tempDirs } from "./support/tmp.ts"

const temp = tempDirs("omo-hand-launcher-")

function launcherIn(
  root: string,
  children: FakeChild[],
  dialed: Array<{ endpoint: string; capability: Buffer }>,
  listening = () => false,
) {
  return new DaemonLauncher({
    engine: "/opt/omo-computer-engine",
    endpoint: join(root, "engine.sock"),
    lock: join(root, "engine.lock"),
    env: { OMO_COMPUTER_BACKEND: "fake" },
    latch: () => ({ suspended: false, stopEpoch: 0 }),
    isListening: async () => listening(),
    spawnDaemon: (_command, _args, _env) => {
      const child = fakeChild(100 + children.length)
      children.push(child)
      return child
    },
    connectAuthority: async (endpoint, capability): Promise<DaemonLink> => {
      dialed.push({ endpoint, capability })
      return fakeAuthority()
    },
  })
}

describe("daemon launcher (spawning profile)", () => {
  it("mints a fresh 32-byte capability per generation, carried on the daemon's stdin only, and dials with it", async () => {
    // Given a launcher with no daemon serving.
    const root = temp()
    const children: FakeChild[] = []
    const dialed: Array<{ endpoint: string; capability: Buffer }> = []
    const args: string[][] = []
    const envs: Array<Record<string, string>> = []
    const launcher = new DaemonLauncher({
      engine: "/opt/omo-computer-engine",
      endpoint: join(root, "engine.sock"),
      lock: join(root, "engine.lock"),
      env: { OMO_COMPUTER_BACKEND: "fake" },
      latch: () => ({ suspended: false, stopEpoch: 0 }),
      isListening: async () => false,
      spawnDaemon: (_command, spawnArgs, env) => {
        args.push([...spawnArgs])
        envs.push({ ...env })
        const child = fakeChild()
        children.push(child)
        return child
      },
      connectAuthority: async (endpoint, capability) => {
        dialed.push({ endpoint, capability })
        return fakeAuthority()
      },
    })

    // When it ensures the daemon.
    const generation = await launcher.ensure()

    // Then the first stdin line is 64 hex digits, the same 32 bytes it dialed with, never argv or env.
    const line = children[0]?.written() ?? ""
    expect(line).toMatch(/^[0-9a-f]{64}\n$/)
    expect(dialed[0]?.capability.toString("hex")).toBe(line.trim())
    expect(args[0]?.join(" ")).not.toContain(line.trim())
    expect(Object.values(envs[0] ?? {}).join(" ")).not.toContain(line.trim())
    expect(generation).toMatchObject({ generation: 1, endpoint: join(root, "engine.sock") })
    expect(children[0]?.killed()).toBe(false)
  })

  it("concurrent ensures spawn one daemon and share its generation", async () => {
    const children: FakeChild[] = []
    const launcher = launcherIn(temp(), children, [])
    const [a, b] = await Promise.all([launcher.ensure(), launcher.ensure()])
    expect(children).toHaveLength(1)
    expect(a.generation).toBe(b.generation)
  })

  it("after the watchdog kills the daemon the next ensure spawns the next generation with a new capability", async () => {
    // Given a serving generation 1.
    const children: FakeChild[] = []
    const dialed: Array<{ endpoint: string; capability: Buffer }> = []
    const launcher = launcherIn(temp(), children, dialed)
    await launcher.ensure()

    // When it is killed and ensured again.
    launcher.kill()
    const next = await launcher.ensure()

    // Then the old child was killed and generation 2 runs on a different capability.
    expect(children[0]?.killed()).toBe(true)
    expect(next.generation).toBe(2)
    expect(dialed[1]?.capability.equals(dialed[0]?.capability ?? Buffer.alloc(0))).toBe(false)
  })

  it("a stale lock left by a dead daemon is cleared; a lock with a live listener is another host's daemon and is refused", async () => {
    // Given a lock file and socket left behind, nobody listening.
    const root = temp()
    writeFileSync(join(root, "engine.lock"), "")
    writeFileSync(join(root, "engine.sock"), "")
    const children: FakeChild[] = []
    await launcherIn(root, children, []).ensure()
    expect(children).toHaveLength(1)

    // Given a lock whose socket answers: a daemon this host did not start.
    const owned = temp()
    writeFileSync(join(owned, "engine.lock"), "")
    const strangers: FakeChild[] = []
    await expect(launcherIn(owned, strangers, [], () => true).ensure()).rejects.toMatchObject({
      reason: "daemon_owned_elsewhere",
    })
    expect(strangers).toEqual([])
    expect(existsSync(join(owned, "engine.lock"))).toBe(true)
  })
})
